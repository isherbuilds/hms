import { beforeAll, expect, mock, test } from "bun:test";

// Replaced before the routers import it. package.json runs this file in a fresh
// Bun process so the destructive mock cannot reach real storage tests.
mock.module("@hms/storage", () => ({
  createUploadUrl: async () => "http://storage.invalid/upload",
  createReadUrl: async () => "http://storage.invalid/read",
  deleteObject: async () => {
    throw new Error("storage unavailable");
  },
  maxUploadBytes: () => 100,
}));

const { drainAuditWrites } = await import("@hms/api/audit");

const { db } = await import("@hms/db");

const { auditLog } = await import("@hms/db/schema/audit");

const { file } = await import("@hms/db/schema/file");

const { eq } = await import("drizzle-orm");

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("a delete audits out-of-scope keys as a digest and still succeeds when object cleanup fails", async () => {
  const owner = await createTestUser("resilient-owner");
  const org = await createOrganization(owner, "resilient");
  const api = clientFor(owner);
  const key = `${org.id}/${Bun.randomUUIDv7()}/notes.txt`;

  // A presigned URL passed as the key must never be persisted verbatim.
  const hostile = `${Bun.randomUUIDv7()}/x.txt`;
  await expectORPCCode(api.file.delete({ orgSlug: org.slug, key: hostile }), "FORBIDDEN");

  await db.insert(file).values({
    id: key,
    orgId: org.id,
    userId: owner.user.id,
    name: "notes.txt",
    size: 1,
    status: "ready",
  });

  const result = await api.file.delete({ orgSlug: org.slug, key });
  expect(result).toEqual({ success: true });

  const [remaining] = await db.select().from(file).where(eq(file.id, key));
  expect(remaining).toBeUndefined();

  // The audit row commits with the row delete, not after object cleanup.
  await drainAuditWrites();

  const records = await db
    .select({ target: auditLog.target, denied: auditLog.denied, action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.orgId, org.id));

  const denied = records.find((record) => record.denied);
  expect(denied?.action).toBe("file.delete");
  expect(denied?.target).toMatch(/^file:[0-9a-f]{16}$/);
  expect(records.filter((record) => !record.denied)).toEqual([
    { action: "file.delete", denied: false, target: `file:${key}` },
  ]);
});
