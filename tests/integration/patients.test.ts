import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { ConflictReason } from "@hms/api/lib/conflict";
import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";
import { and, asc, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

function registration(orgSlug: string, name: string, phone: string) {
  return {
    orgSlug,
    name,
    phone,
    sex: "other" as const,
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: "",
  };
}

function updateInput(orgSlug: string, patientId: string, updatedAt: string, name: string) {
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
  };
}

type RejectedCall = {
  code?: string;
  data?: { reason?: ConflictReason };
  message?: string;
};

async function rejected(call: Promise<unknown>): Promise<RejectedCall> {
  try {
    await call;
  } catch (error) {
    // SAFETY: the caller awaits a patient procedure, whose rejection is always an
    // ORPCError carrying the RejectedCall fields; the throw below covers a resolve.
    return error as RejectedCall;
  }

  throw new Error("Expected patient call to reject");
}

test("MRNs count per organization and matching demographics never block registration", async () => {
  const owner = await createTestUser("patient-mrn");
  const one = await createOrganization(owner, "patient-mrn-one");
  const two = await createOrganization(owner, "patient-mrn-two");
  const api = clientFor(owner);
  const phone = "5550001";

  const first = await api.patient.register(registration(one.slug, "Shared Identity", phone));
  const duplicate = await api.patient.register(registration(one.slug, "Shared Identity", phone));
  const family = await api.patient.register(registration(one.slug, "Family Child", phone));
  const caseOnly = await api.patient.register(registration(one.slug, "shared identity", phone));
  const foreign = await api.patient.register(registration(two.slug, "Shared Identity", phone));

  expect(new Set([first.id, duplicate.id, family.id, caseOnly.id]).size).toBe(4);
  expect([first.mrn, duplicate.mrn, family.mrn, caseOnly.mrn]).toEqual([
    "000001",
    "000002",
    "000003",
    "000004",
  ]);
  expect(first.orgId).toBe(one.id);
  expect(foreign).toMatchObject({ orgId: two.id, mrn: "000001" });

  const matches = await api.patient.search({ orgSlug: one.slug, phone });
  expect(matches.items.map((patient) => patient.id).sort()).toEqual(
    [first.id, duplicate.id, family.id, caseOnly.id].sort(),
  );
  expect(matches.items.every((patient) => !("orgId" in patient))).toBe(true);
  expect(matches.items.every((patient) => !("medicalHistory" in patient))).toBe(true);
});

test("search matches name and MRN substrings", async () => {
  const owner = await createTestUser("patient-search");
  const organization = await createOrganization(owner, "patient-search");
  const api = clientFor(owner);

  const alice = await api.patient.register(
    registration(organization.slug, "Alice Patient", "5550300"),
  );

  const byName = await api.patient.search({ orgSlug: organization.slug, query: "liCe" });
  expect(byName.items.map((patient) => patient.id)).toEqual([alice.id]);

  const byMrn = await api.patient.search({ orgSlug: organization.slug, query: "000001" });
  expect(byMrn.items.map((patient) => patient.id)).toEqual([alice.id]);
});

test("an update keeps identity, refuses a stale token, and audits only successes", async () => {
  const owner = await createTestUser("patient-update");
  const organization = await createOrganization(owner, "patient-update");
  const api = clientFor(owner);

  const original = await api.patient.register(
    registration(organization.slug, "Before Update", "5550400"),
  );

  const originalToken = original.updatedAt.toISOString();

  const updated = await api.patient.update({
    orgSlug: organization.slug,
    patientId: original.id,
    updatedAt: originalToken,
    name: "After Update",
    phone: "5550401",
    sex: "female",
    dateOfBirth: "1990-04-05",
    dobEstimated: false,
    address: "Updated address",
  });

  expect(updated).toMatchObject({
    id: original.id,
    orgId: original.orgId,
    mrn: original.mrn,
    name: "after update",
    phone: "5550401",
    sex: "female",
    dateOfBirth: "1990-04-05",
    dobEstimated: false,
    address: "Updated address",
    createdBy: original.createdBy,
    createdAt: original.createdAt,
  });
  expect(Date.parse(updated.updatedAt)).toBeGreaterThan(original.updatedAt.getTime());

  const stale = await rejected(
    api.patient.update(updateInput(organization.slug, original.id, originalToken, "Stale Update")),
  );

  expect(stale.code).toBe("CONFLICT");
  expect(stale.data?.reason).toBe("stale_record");

  expect((await api.patient.get({ orgSlug: organization.slug, patientId: original.id })).name).toBe(
    "after update",
  );

  await drainAuditWrites();

  const audits = await db
    .select({ action: auditLog.action, actorId: auditLog.actorId })
    .from(auditLog)
    .where(and(eq(auditLog.orgId, organization.id), eq(auditLog.target, `patient:${original.id}`)))
    .orderBy(asc(auditLog.action));

  expect(audits).toEqual([
    { action: "patient.register", actorId: owner.user.id },
    { action: "patient.update", actorId: owner.user.id },
  ]);
});

test("patient sponsor round-trips, can be removed, and rejects a foreign payer", async () => {
  const owner = await createTestUser("patient-sponsor");
  const organization = await createOrganization(owner, "patient-sponsor");
  const otherOrganization = await createOrganization(owner, "patient-sponsor-foreign");
  const api = clientFor(owner);

  const sponsor = await api.payer.create({
    orgSlug: organization.slug,
    name: "Acme Health",
    type: "insurer",
  });

  const foreignSponsor = await api.payer.create({
    orgSlug: otherOrganization.slug,
    name: "Foreign Employer",
    type: "corporate",
  });

  const registered = await api.patient.register({
    ...registration(organization.slug, "Sponsored Patient", "5550450"),
    sponsor: {
      payerId: sponsor.id,
      policyNumber: "POL-42",
      employeeNumber: "EMP-7",
    },
  });

  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });

  expect(loaded.sponsor).toEqual({
    payerId: sponsor.id,
    payerName: "Acme Health",
    payerType: "insurer",
    policyNumber: "POL-42",
    employeeNumber: "EMP-7",
  });

  const updated = await api.patient.update({
    ...updateInput(organization.slug, registered.id, loaded.updatedAt, "Sponsored Patient"),
    sponsor: {
      payerId: sponsor.id,
      policyNumber: "POL-43",
      employeeNumber: "EMP-8",
    },
  });

  expect(
    await api.patient.get({ orgSlug: organization.slug, patientId: registered.id }),
  ).toMatchObject({
    sponsor: {
      payerId: sponsor.id,
      policyNumber: "POL-43",
      employeeNumber: "EMP-8",
    },
  });

  const removed = await api.patient.update({
    ...updateInput(organization.slug, registered.id, updated.updatedAt, "Sponsored Patient"),
    sponsor: null,
  });

  expect(
    await api.patient.get({ orgSlug: organization.slug, patientId: registered.id }),
  ).toMatchObject({ sponsor: null });

  await expectORPCCode(
    api.patient.update({
      ...updateInput(organization.slug, registered.id, removed.updatedAt, "Sponsored Patient"),
      sponsor: { payerId: foreignSponsor.id },
    }),
    "NOT_FOUND",
  );
});

test("patient fields round-trip and a missing date of birth is refused", async () => {
  const owner = await createTestUser("patient-master-fields");
  const organization = await createOrganization(owner, "patient-master-fields");
  const api = clientFor(owner);

  const registered = await api.patient.register({
    ...registration(organization.slug, "patient MASTER fields", "5550550"),
    sex: "unknown",
    email: "patient@example.com",
    bloodGroup: "AB-",
    allergies: "Penicillin",
    medicalHistory: "Hypertension",
    uid: "  NATIONAL-123  ",
    guardian: { relation: "W/o", name: "gurmeet SINGH", phone: "5550554" },
    emergencyContact: { name: "harpreet kaur", phone: "5550551" },
  });

  const patient = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });

  expect(patient).toMatchObject({
    name: "patient master fields",
    sex: "unknown",
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    email: "patient@example.com",
    bloodGroup: "AB-",
    allergies: "Penicillin",
    medicalHistory: "Hypertension",
    uid: "NATIONAL-123",
    guardianRelation: "W/o",
    guardianName: "gurmeet singh",
    guardianPhone: "5550554",
    emergencyContactName: "harpreet kaur",
    emergencyContactPhone: "5550551",
    emergencyContactRelation: null,
  });

  await expectORPCCode(
    api.patient.register({
      ...registration(organization.slug, "Missing Date of Birth", "5550500"),
      dateOfBirth: "",
    }),
    "BAD_REQUEST",
  );
});
