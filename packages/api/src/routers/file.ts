import { db } from "@hms/db";
import { attachments } from "@hms/db/schema/attachments";
import { file as fileTable } from "@hms/db/schema/file";
import { createReadUrl, createUploadUrl, deleteObject, maxUploadBytes } from "@hms/storage";
import { ORPCError } from "@orpc/server";
import { createHash } from "node:crypto";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure, type Scope } from "../lib/procedures/factory";
import { likePattern, pageLimit, searchQuery } from "../lib/schemas";

const keyInput = orgInput.extend({ key: z.string().min(1) });

// Never audit the key verbatim: a caller could hand a presigned URL as the key and
// get a live bearer credential persisted.
function keyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// Every key begins with its owning org, so a foreign key is rejected before any
// database work — and recorded, because probing for one is what audit is for.
function assertKeyInScope(key: string, scope: Scope, action: string): void {
  if (key.startsWith(`${scope.orgId}/`)) {
    return;
  }
  audit({
    action,
    denied: true,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `file:${keyDigest(key)}`,
  });
  throw new ORPCError("FORBIDDEN", {
    message: "You do not have access to this file",
  });
}

// Letters, digits, dots, underscores and hyphens only, so a name can never produce
// nested keys, path traversal, or break URL building.
export function sanitizeKeyName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .replace(/[.-]+$/g, "")
    .slice(0, 255);
  return sanitized || "file";
}

export const fileRouter = {
  // Keyset on (createdAt, id): the pair is unique, so a page boundary cannot skip or
  // repeat. The cursor stays a text literal — `created_at` holds microseconds a JS
  // Date would truncate, silently dropping rows on the boundary millisecond.
  list: orgProcedure(
    { file: ["read"] },
    orgInput.extend({
      query: searchQuery,
      cursor: z
        .object({
          createdAt: z
            .string()
            .max(64)
            .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid cursor timestamp"),
          id: z.string(),
        })
        .optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const search = input.query ? likePattern(input.query) : undefined;
    const scoped = and(
      eq(fileTable.orgId, context.scope.orgId),
      eq(fileTable.status, "ready"),
      search ? ilike(fileTable.name, search) : undefined,
    );

    const cursorTimestamp = input.cursor ? sql`${input.cursor.createdAt}::timestamptz` : undefined;
    const items = await db
      .select({
        id: fileTable.id,
        name: fileTable.name,
        mimeType: fileTable.mimeType,
        size: fileTable.size,
        createdAt: fileTable.createdAt,
        createdAtCursor: sql<string>`${fileTable.createdAt}::text`,
      })
      .from(fileTable)
      .where(
        input.cursor && cursorTimestamp
          ? and(
              scoped,
              or(
                lt(fileTable.createdAt, cursorTimestamp),
                and(eq(fileTable.createdAt, cursorTimestamp), lt(fileTable.id, input.cursor.id)),
              ),
            )
          : scoped,
      )
      .orderBy(desc(fileTable.createdAt), desc(fileTable.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;
    if (hasNextPage) {
      items.pop();
    }
    const last = items.at(-1);
    return {
      items: items.map(({ createdAtCursor: _cursor, ...item }) => item),
      nextCursor: hasNextPage && last ? { createdAt: last.createdAtCursor, id: last.id } : null,
    };
  }),

  // The browser streams straight to storage; the app server never buffers the
  // payload. The row is `pending` until `finalizeUpload`, so an abandoned upload
  // never becomes readable.
  createUpload: orgProcedure(
    { file: ["upload"] },
    orgInput.extend({
      name: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(255).optional(),
      size: z.number().int().positive(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const max = maxUploadBytes();
    if (input.size > max) {
      throw new ORPCError("BAD_REQUEST", {
        message: `File too large. Maximum allowed size is ${max} bytes.`,
      });
    }

    const key = `${scope.orgId}/${Bun.randomUUIDv7()}/${sanitizeKeyName(input.name)}`;
    const uploadUrl = await createUploadUrl(key, {
      contentType: input.mimeType,
      size: input.size,
    });

    await db.insert(fileTable).values({
      id: key,
      userId: scope.userId,
      orgId: scope.orgId,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      status: "pending",
    });

    return { key, uploadUrl };
  }),

  // Scoped `UPDATE ... RETURNING`: no window between the check and the write.
  finalizeUpload: orgProcedure({ file: ["upload"] }, keyInput).handler(
    async ({ context, input }) => {
      assertKeyInScope(input.key, context.scope, "file.upload");

      const [row] = await db
        .update(fileTable)
        .set({ status: "ready" })
        .where(
          and(
            eq(fileTable.id, input.key),
            eq(fileTable.orgId, context.scope.orgId),
            eq(fileTable.status, "pending"),
          ),
        )
        .returning();

      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: "No pending upload found for this key",
        });
      }
      return row;
    },
  ),

  getReadUrl: orgProcedure({ file: ["read"] }, keyInput).handler(async ({ context, input }) => {
    assertKeyInScope(input.key, context.scope, "file.read");

    const [row] = await db
      .select({ status: fileTable.status })
      .from(fileTable)
      .where(and(eq(fileTable.id, input.key), eq(fileTable.orgId, context.scope.orgId)))
      .limit(1);

    if (!row || row.status !== "ready") {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    return { url: await createReadUrl(input.key) };
  }),

  // Row first, then the object: the reverse could leave a `ready` row pointing at
  // nothing. A surviving object is an orphan no key resolves, so it is logged rather
  // than retried — the caller is never told a committed delete failed.
  delete: orgProcedure({ file: ["delete"] }, keyInput).handler(async ({ context, input }) => {
    assertKeyInScope(input.key, context.scope, "file.delete");

    // `attachPrescription` takes a compatible key-share lock before inserting the FK,
    // so attach and delete serialize instead of raising a constraint error.
    await db.transaction(async (tx) => {
      const [lockedFile] = await tx
        .select({ id: fileTable.id })
        .from(fileTable)
        .where(and(eq(fileTable.id, input.key), eq(fileTable.orgId, context.scope.orgId)))
        .limit(1)
        .for("update");

      if (!lockedFile) {
        throw new ORPCError("NOT_FOUND", { message: "File not found" });
      }

      const [attached] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.orgId, context.scope.orgId), eq(attachments.fileId, input.key)))
        .limit(1);

      if (attached) {
        throw new ORPCError("CONFLICT", {
          message: "This file is attached to a record. Detach it there before deleting it.",
        });
      }

      const [deleted] = await tx
        .delete(fileTable)
        .where(and(eq(fileTable.id, input.key), eq(fileTable.orgId, context.scope.orgId)))
        .returning({ id: fileTable.id });

      if (!deleted) {
        throw new ORPCError("NOT_FOUND", { message: "File not found" });
      }
    });

    // Issued right after the committed delete, so no storage failure can sit between
    // the delete and its record (D004).
    audit({
      action: "file.delete",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `file:${input.key}`,
    });

    try {
      await deleteObject(input.key);
    } catch (error) {
      console.error(`[orphan] failed to delete object ${input.key}`, error);
    }

    return { success: true as const };
  }),
};
