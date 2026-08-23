import { beforeAll, expect, mock, test } from "bun:test";

// Storage is replaced *before* the routers import it, so `deleteObject` throws
// like it would during a SeaweedFS outage. Bun runs each test file in its own
// process. package.json runs this file in a fresh Bun process after the normal
// suite, so the destructive module mock cannot contaminate real storage tests.
mock.module("@hms/storage", () => ({
  createUploadUrl: async () => "http://storage.invalid/upload",
  createReadUrl: async () => "http://storage.invalid/read",
  deleteObject: async () => {
    throw new Error("storage unavailable");
  },
  maxUploadBytes: () => 100,
  uploadExpiresIn: 900,
}));

const { drainAuditWrites } = await import("@hms/api/audit");
const { db } = await import("@hms/db");
const { auditLog } = await import("@hms/db/schema/audit");
const { file } = await import("@hms/db/schema/file");
const { eq } = await import("drizzle-orm");

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
/**
 * Pins the deletion contract: the audit row commits with the row delete, not
 * after object cleanup, so an unreachable store can neither swallow the record
 * nor turn a committed delete into a reported failure.
 */
beforeAll(async () => {
  await resetTestDatabase();
});

test("a delete still audits and succeeds when object cleanup fails", async () => {
  const owner = await createTestUser("resilient-owner");
  const org = await createOrganization(owner, "resilient");
  const api = clientFor(owner);
  const key = `${org.id}/${Bun.randomUUIDv7()}/notes.txt`;

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

  await drainAuditWrites();
  const [record] = await db
    .select({ target: auditLog.target, denied: auditLog.denied, action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.orgId, org.id));
  expect(record?.action).toBe("file.delete");
  expect(record?.denied).toBe(false);
  expect(record?.target).toBe(`file:${key}`);
});

test("an out-of-scope key is denied and recorded as a digest, not the raw key", async () => {
  const owner = await createTestUser("digest-owner");
  const org = await createOrganization(owner, "digest");
  const api = clientFor(owner);

  // A foreign tenant's key — or a presigned URL passed as the key — must never
  // be persisted verbatim in the audit trail.
  const hostile = `${Bun.randomUUIDv7()}/x.txt`;
  await expectORPCCode(api.file.delete({ orgSlug: org.slug, key: hostile }), "FORBIDDEN");

  await drainAuditWrites();
  const [record] = await db
    .select({ target: auditLog.target, denied: auditLog.denied, action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.orgId, org.id));
  expect(record?.action).toBe("file.delete");
  expect(record?.denied).toBe(true);
  expect(record?.target).toMatch(/^file:[0-9a-f]{16}$/);
  expect(record?.target).not.toContain(hostile);
});
