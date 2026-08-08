import { db } from "@better-stack/db";
import { attachments } from "@better-stack/db/schema/attachments";
import { file as fileTable } from "@better-stack/db/schema/file";
import {
  createReadUrl,
  createUploadUrl,
  deleteObject,
  maxUploadBytes,
  uploadExpiresIn,
} from "@better-stack/storage";
import { ORPCError } from "@orpc/server";
import { createHash } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure, type Scope } from "../lib/procedures/factory";

const keyInput = orgInput.extend({ key: z.string().min(1) });

/**
 * The `key` is caller-controlled and rejected before any database work. It is
 * also written to the audit trail — but never verbatim: a caller could hand a
 * presigned URL as the key and get a live bearer credential persisted. Only a
 * short digest goes into the record; the key itself authorizes nothing.
 */
function keyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Every key begins with its owning org (`<orgId>/<uuid>/<name>`), so a key from
 * another tenant is rejected before any database work — and recorded, because a
 * probe for a foreign tenant's key is exactly what an audit trail is for. The
 * queries below still carry the org predicate as defence in depth.
 */
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

/**
 * Sanitizes a user-supplied name into a safe object-key segment. Keeps only
 * letters, digits, dots, underscores and hyphens so the key can never produce
 * nested keys (`/`), path traversal (`..`), or break URL building (`%`, `#`).
 */
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

export const filesRouter = {
  /**
   * The org's ready files, newest first. Keyset pagination on `createdAt` +
   * `id`: no OFFSET scan as the table grows, and the pair is unique so a
   * page boundary can never skip or repeat a row.
   */
  list: orgProcedure(
    { storage: ["read"] },
    orgInput.extend({
      cursor: z.object({ createdAt: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  ).handler(async ({ context, input }) => {
    const scoped = and(eq(fileTable.orgId, context.scope.orgId), eq(fileTable.status, "ready"));

    const items = await db
      .select({
        id: fileTable.id,
        name: fileTable.name,
        mimeType: fileTable.mimeType,
        size: fileTable.size,
        userId: fileTable.userId,
        createdAt: fileTable.createdAt,
      })
      .from(fileTable)
      .where(
        input.cursor
          ? and(
              scoped,
              or(
                lt(fileTable.createdAt, input.cursor.createdAt),
                and(
                  eq(fileTable.createdAt, input.cursor.createdAt),
                  lt(fileTable.id, input.cursor.id),
                ),
              ),
            )
          : scoped,
      )
      .orderBy(desc(fileTable.createdAt), desc(fileTable.id))
      .limit(input.limit);

    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        items.length === input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }),

  /**
   * Issues a presigned PUT URL so the browser streams the file straight to
   * SeaweedFS. The app server never buffers the payload. The metadata row is
   * created as `pending`; `finalizeUpload` marks it `ready`, so an abandoned
   * upload never surfaces as readable.
   */
  createUpload: orgProcedure(
    { storage: ["upload"] },
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

    const key = `${scope.orgId}/${crypto.randomUUID()}/${sanitizeKeyName(input.name)}`;
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

    return { key, uploadUrl, expiresIn: uploadExpiresIn };
  }),

  /**
   * Flips the metadata row to `ready`, making it readable. Scoped
   * `UPDATE ... RETURNING`: one round trip, and no window between the
   * authorization check and the write.
   */
  finalizeUpload: orgProcedure({ storage: ["upload"] }, keyInput).handler(
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

  /**
   * Resolves a short-lived presigned read URL. Every object is private; there
   * is no unsigned path (see `@better-stack/storage`). Pending uploads are not
   * readable.
   */
  getReadUrl: orgProcedure({ storage: ["read"] }, keyInput).handler(async ({ context, input }) => {
    assertKeyInScope(input.key, context.scope, "file.read");

    const [row] = await db
      .select({ status: fileTable.status })
      .from(fileTable)
      .where(and(eq(fileTable.id, input.key), eq(fileTable.orgId, context.scope.orgId)))
      .limit(1);

    if (!row || row.status !== "ready") {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    return {
      url: await createReadUrl(input.key),
      expiresIn: uploadExpiresIn,
    };
  }),

  /**
   * Deletes the metadata row first, then drops the object. Ordering matters:
   * dropping the object first could leave a `ready` row pointing at nothing.
   * The reverse failure — deleted row, surviving object — is an orphan with no
   * key anyone can resolve, so it is logged, not retried: the audit row
   * commits regardless of storage availability, and the caller is never told
   * a deletion failed when it committed.
   */
  delete: orgProcedure({ storage: ["delete"] }, keyInput).handler(async ({ context, input }) => {
    assertKeyInScope(input.key, context.scope, "file.delete");

    // Lock the file before checking dependants. `visit.attachPrescription`
    // takes a compatible key-share lock before inserting the FK, so attach and
    // delete serialize without a raw constraint error escaping to the caller.
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

      return deleted;
    });

    // Fire-and-forget (ADR 0005) and issued right after the committed
    // delete, so no storage failure can sit between the delete and its
    // record.
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
