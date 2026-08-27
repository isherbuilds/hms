import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";
import { counter } from "@hms/db/schema/counter";
import { patients } from "@hms/db/schema/patients";
import { and, eq, sql } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

function registration(orgSlug: string, name: string, phone: string, uid?: string) {
  return {
    orgSlug,
    name,
    phone,
    sex: "other" as const,
    dateOfBirth: "1990-01-01",
    dobEstimated: false,
    address: "",
    ...(uid ? { uid } : {}),
  };
}

function updateInput(
  orgSlug: string,
  patientId: string,
  updatedAt: string,
  name: string,
  uid?: string,
) {
  return {
    orgSlug,
    patientId,
    updatedAt,
    name,
    phone: "555-2200",
    sex: "female" as const,
    dateOfBirth: "1991-02-03",
    dobEstimated: false,
    address: "Updated address",
    ...(uid ? { uid } : {}),
  };
}

async function rejected(call: Promise<unknown>): Promise<{
  code?: string;
  data?: { code?: string };
  message?: string;
}> {
  try {
    await call;
  } catch (error) {
    return error as { code?: string; data?: { code?: string }; message?: string };
  }
  throw new Error("Expected patient call to reject");
}

test("fresh CAS succeeds while stale and missing updates emit no success audit", async () => {
  const owner = await createTestUser("patient-cas");
  const organization = await createOrganization(owner, "patient-cas");
  const api = clientFor(owner);
  const registered = await api.patient.register(
    registration(organization.slug, "Before CAS", "555-2100"),
  );
  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });

  const updated = await api.patient.update(
    updateInput(organization.slug, registered.id, loaded.updatedAt, "Winning Update"),
  );
  expect(updated.name).toBe("Winning Update");
  expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(updated.updatedAt).not.toBe(loaded.updatedAt);

  const stale = await rejected(
    api.patient.update(
      updateInput(organization.slug, registered.id, loaded.updatedAt, "Stale Update"),
    ),
  );
  expect(stale.code).toBe("CONFLICT");
  expect(stale.message).toBe("This patient changed after you opened it.");
  expect(stale.data?.code).toBe("STALE_RECORD");

  const missing = await rejected(
    api.patient.update(
      updateInput(
        organization.slug,
        Bun.randomUUIDv7(),
        "2026-08-27T00:00:00.000Z",
        "Missing Update",
      ),
    ),
  );
  expect(missing.code).toBe("NOT_FOUND");

  const winner = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });
  expect(winner.name).toBe("Winning Update");

  await drainAuditWrites();
  const updateAudits = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, organization.id),
        eq(auditLog.action, "patient.update"),
        eq(auditLog.target, `patient:${registered.id}`),
      ),
    );
  expect(updateAudits).toHaveLength(1);
});

test("the millisecond floor gives consecutive successful writes distinct tokens", async () => {
  const owner = await createTestUser("patient-cas-floor");
  const organization = await createOrganization(owner, "patient-cas-floor");
  const api = clientFor(owner);
  const registered = await api.patient.register(
    registration(organization.slug, "Token Floor", "555-2300"),
  );

  const futureToken = "2099-01-01T00:00:00.000Z";
  await db
    .update(patients)
    .set({ updatedAt: new Date(futureToken) })
    .where(and(eq(patients.orgId, organization.id), eq(patients.id, registered.id)));

  const first = await api.patient.update(
    updateInput(organization.slug, registered.id, futureToken, "First Floor Update"),
  );
  const second = await api.patient.update(
    updateInput(organization.slug, registered.id, first.updatedAt, "Second Floor Update"),
  );

  expect(first.updatedAt).toBe("2099-01-01T00:00:00.001Z");
  expect(second.updatedAt).toBe("2099-01-01T00:00:00.002Z");
});

test("a legacy microsecond timestamp is exposed and compared as a millisecond token", async () => {
  const owner = await createTestUser("patient-cas-legacy-token");
  const organization = await createOrganization(owner, "patient-cas-legacy-token");
  const api = clientFor(owner);
  const registered = await api.patient.register(
    registration(organization.slug, "Legacy Token", "555-2400"),
  );

  await db.execute(sql`
    update ${patients}
    set updated_at = '2026-08-27T10:11:12.123456Z'::timestamptz
    where ${patients.orgId} = ${organization.id} and ${patients.id} = ${registered.id}
  `);
  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });
  expect(loaded.updatedAt).toBe("2026-08-27T10:11:12.123Z");

  const updated = await api.patient.update(
    updateInput(organization.slug, registered.id, loaded.updatedAt, "Normalized Token Update"),
  );
  expect(updated.name).toBe("Normalized Token Update");
  expect(updated.updatedAt).toMatch(/\.\d{3}Z$/);
});

test("only the patient UID constraint receives the UID_TAKEN discriminator", async () => {
  const owner = await createTestUser("patient-uid-conflict");
  const organization = await createOrganization(owner, "patient-uid-conflict");
  const api = clientFor(owner);
  const first = await api.patient.register(
    registration(organization.slug, "First UID", "555-2500", "SHARED-UID"),
  );

  const createConflict = await rejected(
    api.patient.register(registration(organization.slug, "Second UID", "555-2501", "SHARED-UID")),
  );
  expect(createConflict.code).toBe("CONFLICT");
  expect(createConflict.message).toBe("A patient with this UID already exists.");
  expect(createConflict.data?.code).toBe("UID_TAKEN");

  await db
    .update(counter)
    .set({ value: 0 })
    .where(and(eq(counter.orgId, organization.id), eq(counter.key, "mrn")));
  const otherConstraint = await rejected(
    api.patient.register(
      registration(organization.slug, "MRN Collision", "555-2503", "UNIQUE-UID"),
    ),
  );
  expect(otherConstraint.code).toBe("CONFLICT");
  expect(otherConstraint.data?.code).toBeUndefined();
  await db
    .update(counter)
    .set({ value: 1 })
    .where(and(eq(counter.orgId, organization.id), eq(counter.key, "mrn")));

  const second = await api.patient.register(
    registration(organization.slug, "Update UID", "555-2502", "OTHER-UID"),
  );
  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: second.id,
  });
  const updateConflict = await rejected(
    api.patient.update(
      updateInput(organization.slug, second.id, loaded.updatedAt, "Update UID", "SHARED-UID"),
    ),
  );
  expect(updateConflict.code).toBe("CONFLICT");
  expect(updateConflict.message).toBe("A patient with this UID already exists.");
  expect(updateConflict.data?.code).toBe("UID_TAKEN");

  const unchanged = await api.patient.get({
    orgSlug: organization.slug,
    patientId: first.id,
  });
  expect(unchanged.uid).toBe("SHARED-UID");
});
