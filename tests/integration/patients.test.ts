import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { ConflictReason } from "@hms/api/lib/conflict";
import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";
import { counter } from "@hms/db/schema/counter";
import { file } from "@hms/db/schema/file";
import { patients } from "@hms/db/schema/patients";
import { and, eq, sql } from "drizzle-orm";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
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
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: "",
    ...(uid ? { uid } : {}),
  };
}

test("MRNs increment within an organization and start independently per organization", async () => {
  const owner = await createTestUser("patient-mrn");
  const one = await createOrganization(owner, "patient-mrn-one");
  const two = await createOrganization(owner, "patient-mrn-two");
  const api = clientFor(owner);

  const first = await api.patient.register(registration(one.slug, "First Patient", "5550001"));
  const second = await api.patient.register(registration(one.slug, "Second Patient", "5550002"));
  const otherOrg = await api.patient.register(registration(two.slug, "Other Patient", "5550003"));

  expect(first.mrn).toBe("000001");
  expect(second.mrn).toBe("000002");
  expect(otherOrg.mrn).toBe("000001");
  expect(first.orgId).toBe(one.id);
  expect(otherOrg.orgId).toBe(two.id);
});

test("registration uses the organization's configured MRN prefix", async () => {
  const owner = await createTestUser("patient-prefix-owner");
  const organization = await createOrganization(owner, "patient-prefix");
  const admin = await createTestUser("patient-prefix-admin");
  await joinOrganization(admin, organization.id, "admin");
  const api = clientFor(admin);
  const settings = await api.settings.get({ orgSlug: organization.slug });

  await api.settings.update({
    orgSlug: organization.slug,
    ...settings,
    mrnPrefix: "HMS-",
  });

  const patient = await api.patient.register(
    registration(organization.slug, "Prefixed Patient", "5550100"),
  );
  expect(patient.mrn).toBe("HMS-000001");
});

test("register permits the same demographics after surfacing candidate matches", async () => {
  const owner = await createTestUser("patient-identity-duplicate");
  const organization = await createOrganization(owner, "patient-identity-duplicate");
  const api = clientFor(owner);
  const input = registration(organization.slug, "Duplicate Patient", "5550150");

  const first = await api.patient.register(input);
  const second = await api.patient.register(input);
  expect(second.id).not.toBe(first.id);
});

test("register allows family members with the same phone and different names", async () => {
  const owner = await createTestUser("patient-identity-family");
  const organization = await createOrganization(owner, "patient-identity-family");
  const api = clientFor(owner);

  const parent = await api.patient.register(
    registration(organization.slug, "Family Parent", "5550151"),
  );
  const child = await api.patient.register(
    registration(organization.slug, "Family Child", "5550151"),
  );

  expect(child.id).not.toBe(parent.id);
});

test("register allows the same name and phone in different organizations", async () => {
  const owner = await createTestUser("patient-identity-tenancy");
  const one = await createOrganization(owner, "patient-identity-tenancy-one");
  const two = await createOrganization(owner, "patient-identity-tenancy-two");
  const api = clientFor(owner);

  const first = await api.patient.register(registration(one.slug, "Shared Identity", "5550152"));
  const second = await api.patient.register(registration(two.slug, "Shared Identity", "5550152"));

  expect(first.orgId).toBe(one.id);
  expect(second.orgId).toBe(two.id);
});

test("register permits case-only name differences with the same phone", async () => {
  const owner = await createTestUser("patient-identity-case");
  const organization = await createOrganization(owner, "patient-identity-case");
  const api = clientFor(owner);

  const first = await api.patient.register(
    registration(organization.slug, "Case Patient", "5550153"),
  );
  const second = await api.patient.register(
    registration(organization.slug, "case patient", "5550153"),
  );
  expect(second.id).not.toBe(first.id);
});

test("exact-phone dedupe returns every match in the caller's organization only", async () => {
  const owner = await createTestUser("patient-dedupe");
  const one = await createOrganization(owner, "patient-dedupe-one");
  const two = await createOrganization(owner, "patient-dedupe-two");
  const api = clientFor(owner);
  const phone = "5550200";

  const first = await api.patient.register(registration(one.slug, "Phone Match One", phone));
  const second = await api.patient.register(registration(one.slug, "Phone Match Two", phone));
  await api.patient.register(registration(two.slug, "Foreign Phone Match", phone));

  const matches = await api.patient.search({ orgSlug: one.slug, phone });
  expect(matches.items.map((patient) => patient.id).sort()).toEqual([first.id, second.id].sort());
  expect(matches.items.every((patient) => !("orgId" in patient))).toBe(true);
  expect(matches.items.every((patient) => !("medicalHistory" in patient))).toBe(true);
});

test("search matches name and MRN substrings and keyset pagination has no duplicates or gaps", async () => {
  const owner = await createTestUser("patient-search");
  const organization = await createOrganization(owner, "patient-search");
  const api = clientFor(owner);

  const alice = await api.patient.register(
    registration(organization.slug, "Alice Wonderland", "5550300"),
  );
  const byName = await api.patient.search({ orgSlug: organization.slug, query: "liCe" });
  expect(byName.items.map((patient) => patient.id)).toContain(alice.id);

  const byMrn = await api.patient.search({ orgSlug: organization.slug, query: "000001" });
  expect(byMrn.items.map((patient) => patient.id)).toContain(alice.id);

  const registeredIds = [alice.id];
  for (let index = 1; index < 5; index++) {
    const patient = await api.patient.register(
      registration(organization.slug, `Paged Patient ${index}`, `55503${index}`),
    );
    registeredIds.push(patient.id);
  }

  const seenIds: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.patient.search({
      orgSlug: organization.slug,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.items.length).toBeLessThanOrEqual(2);
    seenIds.push(...page.items.map((patient) => patient.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  expect(new Set(seenIds).size).toBe(seenIds.length);
  expect([...seenIds].sort()).toEqual([...registeredIds].sort());
});

test("update changes demographics without changing identity or consuming an MRN", async () => {
  const owner = await createTestUser("patient-update");
  const organization = await createOrganization(owner, "patient-update");
  const api = clientFor(owner);
  const original = await api.patient.register(
    registration(organization.slug, "Before Update", "5550400"),
  );

  await Bun.sleep(2);
  const updated = await api.patient.update({
    orgSlug: organization.slug,
    patientId: original.id,
    updatedAt: original.updatedAt.toISOString(),
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

  const next = await api.patient.register(
    registration(organization.slug, "After Counter Check", "5550402"),
  );
  expect(next.mrn).toBe("000002");

  const missingId = Bun.randomUUIDv7();
  await expectORPCCode(
    api.patient.get({ orgSlug: organization.slug, patientId: missingId }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.patient.update({
      orgSlug: organization.slug,
      patientId: missingId,
      updatedAt: new Date(0).toISOString(),
      name: "Missing",
      phone: "5550499",
      sex: "male",
      dateOfBirth: "1986-08-27",
      dobEstimated: true,
      address: "",
    }),
    "CONFLICT",
  );
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

test("registration requires a date of birth", async () => {
  const owner = await createTestUser("patient-validation");
  const organization = await createOrganization(owner, "patient-validation");

  await expectORPCCode(
    clientFor(owner).patient.register({
      orgSlug: organization.slug,
      name: "Missing Date of Birth",
      phone: "5550500",
      sex: "other",
      dateOfBirth: "",
      dobEstimated: false,
      address: "",
    }),
    "BAD_REQUEST",
  );
});

test("new patient fields round-trip and unknown sex is accepted", async () => {
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

  // Half a guardian or a contact with no phone is refused by the input shape itself.
  await expectORPCCode(
    api.patient.register({
      ...registration(organization.slug, "Half Guardian", "5550552"),
      // @ts-expect-error name is required once a guardian is given
      guardian: { relation: "S/o" },
    }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    api.patient.register({
      ...registration(organization.slug, "Half Contact", "5550553"),
      // @ts-expect-error phone is required once a contact is given
      emergencyContact: { name: "nobody" },
    }),
    "BAD_REQUEST",
  );
});

test("UID is unique within an organization but reusable in another organization", async () => {
  const owner = await createTestUser("patient-uid");
  const one = await createOrganization(owner, "patient-uid-one");
  const two = await createOrganization(owner, "patient-uid-two");
  const api = clientFor(owner);

  await api.patient.register({
    ...registration(one.slug, "UID One", "5550560"),
    uid: "SHARED-UID",
  });
  await expectORPCCode(
    api.patient.register({
      ...registration(one.slug, "UID Duplicate", "5550561"),
      uid: "SHARED-UID",
    }),
    "CONFLICT",
  );

  const otherOrgPatient = await api.patient.register({
    ...registration(two.slug, "UID Other Org", "5550562"),
    uid: "SHARED-UID",
  });
  expect(otherOrgPatient.orgId).toBe(two.id);
  expect(otherOrgPatient.uid).toBe("SHARED-UID");
});

test("register and update successes are written to the audit trail", async () => {
  const owner = await createTestUser("patient-audit");
  const organization = await createOrganization(owner, "patient-audit");
  const api = clientFor(owner);
  const patient = await api.patient.register(
    registration(organization.slug, "Audited Patient", "5550600"),
  );

  const registered = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    return audit.items.find(
      (entry) => entry.action === "patient.register" && entry.target === `patient:${patient.id}`,
    );
  });
  expect(registered.actorId).toBe(owner.user.id);
  expect(registered.orgId).toBe(organization.id);

  await api.patient.update({
    orgSlug: organization.slug,
    patientId: patient.id,
    updatedAt: patient.updatedAt.toISOString(),
    name: "Audited Patient Updated",
    phone: "5550601",
    sex: "male",
    dateOfBirth: "1995-08-27",
    dobEstimated: true,
    address: "",
  });

  const updated = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    return audit.items.find(
      (entry) => entry.action === "patient.update" && entry.target === `patient:${patient.id}`,
    );
  });
  expect(updated.actorId).toBe(owner.user.id);
  expect(updated.orgId).toBe(organization.id);
});

test("phone lookup ignores formatting and preserves stored display text", async () => {
  const owner = await createTestUser("patient-phone-format");
  const organization = await createOrganization(owner, "patient-phone-format");
  const api = clientFor(owner);
  const storedPhone = "98765-43210";
  const patient = await api.patient.register(
    registration(organization.slug, "Formatted Phone", storedPhone),
  );

  for (const phone of ["9876543210", "98765 43210", "(98765) 43210"]) {
    const result = await api.patient.search({ orgSlug: organization.slug, phone });
    expect(result.items.map((item) => item.id)).toContain(patient.id);
    expect(result.items.find((item) => item.id === patient.id)?.phone).toBe(storedPhone);
  }

  const generic = await api.patient.search({
    orgSlug: organization.slug,
    query: "98765 43210",
  });
  expect(generic.items.map((item) => item.id)).toContain(patient.id);

  const loaded = await api.patient.get({ orgSlug: organization.slug, patientId: patient.id });
  expect(loaded.phone).toBe(storedPhone);
});

test("short normalized values reject explicit lookup and skip generic phone matching", async () => {
  const owner = await createTestUser("patient-phone-short");
  const organization = await createOrganization(owner, "patient-phone-short");
  const api = clientFor(owner);
  await api.patient.register(registration(organization.slug, "Boundary Patient", "12-3456"));

  await expectORPCCode(
    api.patient.search({ orgSlug: organization.slug, phone: "--12--" }),
    "BAD_REQUEST",
  );

  const shortDigits = await api.patient.search({ orgSlug: organization.slug, query: "12" });
  expect(shortDigits.items).toHaveLength(0);

  const emptyNormalized = await api.patient.search({ orgSlug: organization.slug, query: "--" });
  expect(emptyNormalized.items).toHaveLength(0);
});

test("patient registration persists one birth model and exposes no legacy age", async () => {
  const owner = await createTestUser("patient-age-model");
  const organization = await createOrganization(owner, "patient-age-model");
  const api = clientFor(owner);

  const registered = await api.patient.register({
    orgSlug: organization.slug,
    name: "Estimated Birth Patient",
    phone: "555-1200",
    sex: "female",
    dateOfBirth: "1992-08-27",
    dobEstimated: true,
    address: "",
  });

  expect(registered).toMatchObject({
    dateOfBirth: "1992-08-27",
    dobEstimated: true,
  });
  expect("ageYears" in registered).toBe(false);

  const [stored] = await db
    .select({
      dateOfBirth: patients.dateOfBirth,
      dobEstimated: patients.dobEstimated,
    })
    .from(patients)
    .where(and(eq(patients.orgId, organization.id), eq(patients.id, registered.id)))
    .limit(1);
  expect(stored).toEqual({ dateOfBirth: "1992-08-27", dobEstimated: true });

  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });
  expect(loaded).toMatchObject({ dateOfBirth: "1992-08-27", dobEstimated: true });
  expect("ageYears" in loaded).toBe(false);
});

test("patient search only returns a cursor when another matching row exists", async () => {
  const owner = await createTestUser("patient-search-boundary");
  const exactOrganization = await createOrganization(owner, "patient-search-exact");
  const overflowOrganization = await createOrganization(owner, "patient-search-overflow");
  const api = clientFor(owner);
  const limit = 5;

  for (let index = 0; index < limit; index++) {
    await api.patient.register(
      registration(exactOrganization.slug, `Exact Boundary ${index}`, `55510${index}`),
    );
  }

  for (let index = 0; index < limit + 1; index++) {
    await api.patient.register(
      registration(overflowOrganization.slug, `Overflow Boundary ${index}`, `55520${index}`),
    );
  }

  const exactPage = await api.patient.search({
    orgSlug: exactOrganization.slug,
    query: "Exact Boundary",
    limit,
  });
  expect(exactPage.items).toHaveLength(limit);
  expect(exactPage.items.every((patient) => patient.name.startsWith("exact boundary"))).toBe(true);
  expect(exactPage.nextCursor).toBeNull();

  const firstOverflowPage = await api.patient.search({
    orgSlug: overflowOrganization.slug,
    query: "Overflow Boundary",
    limit,
  });
  expect(firstOverflowPage.items).toHaveLength(limit);
  expect(
    firstOverflowPage.items.every((patient) => patient.name.startsWith("overflow boundary")),
  ).toBe(true);
  expect(firstOverflowPage.nextCursor).not.toBeNull();

  const nextCursor = firstOverflowPage.nextCursor;
  if (!nextCursor) {
    throw new Error("Expected another page for limit + 1 matching patients");
  }

  const secondOverflowPage = await api.patient.search({
    orgSlug: overflowOrganization.slug,
    query: "Overflow Boundary",
    limit,
    cursor: nextCursor,
  });
  expect(secondOverflowPage.items).toHaveLength(1);
  expect(secondOverflowPage.items[0]?.name).toMatch(/^overflow boundary/);
  expect(secondOverflowPage.nextCursor).toBeNull();
});

test("pagination keeps rows that share a creation millisecond", async () => {
  const owner = await createTestUser("patient-search-microsecond");
  const organization = await createOrganization(owner, "patient-search-micros");
  const api = clientFor(owner);

  // `defaultNow()` stores microseconds; the id-only keyset never compares
  // timestamps, so same-millisecond rows can neither vanish nor repeat.
  const ids = [1, 2, 3].map(() => Bun.randomUUIDv7());
  const rows = ids.map((id, index) => ({
    id,
    orgId: organization.id,
    mrn: `MICRO-${index}`,
    name: `Micro Boundary ${index}`,
    phone: `77700${index}`,
    sex: "other" as const,
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: "",
    createdAt: sql`${`2026-08-24T05:00:00.500${String(index + 1).padStart(3, "0")}Z`}::timestamptz`,
  }));
  await db.insert(patients).values(rows);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.patient.search({
      orgSlug: organization.slug,
      query: "Micro Boundary",
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((patient) => patient.id));
    cursor = page.nextCursor;
  } while (cursor);

  expect(seen).toEqual([...ids].sort().reverse());
});

test("file list only returns a cursor when another row exists and keeps same-millisecond rows", async () => {
  const owner = await createTestUser("file-list-boundary");
  const organization = await createOrganization(owner, "file-list-boundary");
  const api = clientFor(owner);

  // Uploads burst inside one millisecond, so the createdAt cursor must not
  // round-trip through a JS Date.
  await db.insert(file).values(
    [1, 2, 3].map((microseconds) => ({
      id: `${organization.id}/boundary-${microseconds}`,
      orgId: organization.id,
      name: `scan-${microseconds}.pdf`,
      size: 1000,
      status: "ready",
      createdAt: sql`${`2026-08-24T06:00:00.250${microseconds.toString().padStart(3, "0")}Z`}::timestamptz`,
    })),
  );

  const seen: string[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  do {
    const page = await api.file.list({
      orgSlug: organization.slug,
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.name));
    cursor = page.nextCursor;
  } while (cursor);

  expect(seen).toEqual(["scan-3.pdf", "scan-2.pdf", "scan-1.pdf"]);

  const exact = await api.file.list({ orgSlug: organization.slug, limit: 3 });
  expect(exact.items).toHaveLength(3);
  expect(exact.nextCursor).toBeNull();
});

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

type RejectedCall = {
  code?: string;
  data?: { reason?: ConflictReason };
  message?: string;
};

async function rejected(call: Promise<unknown>): Promise<RejectedCall> {
  try {
    await call;
  } catch (error) {
    return error as RejectedCall;
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
  expect(updated.name).toBe("winning update");
  expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(updated.updatedAt).not.toBe(loaded.updatedAt);

  const stale = await rejected(
    api.patient.update(
      updateInput(organization.slug, registered.id, loaded.updatedAt, "Stale Update"),
    ),
  );
  expect(stale.code).toBe("CONFLICT");
  expect(stale.message).toBe("This patient changed after you opened it.");
  expect(stale.data?.reason).toBe("stale_record");

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
  expect(missing.code).toBe("CONFLICT");
  expect(missing.data?.reason).toBe("stale_record");

  const winner = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });
  expect(winner.name).toBe("winning update");

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
  expect(updated.name).toBe("normalized token update");
  expect(updated.updatedAt).toMatch(/\.\d{3}Z$/);
});

test("only the patient UID constraint receives the uid_taken discriminator", async () => {
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
  expect(createConflict.data?.reason).toBe("uid_taken");

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
  expect(otherConstraint.data?.reason).toBeUndefined();
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
  expect(updateConflict.data?.reason).toBe("uid_taken");

  const unchanged = await api.patient.get({
    orgSlug: organization.slug,
    patientId: first.id,
  });
  expect(unchanged.uid).toBe("SHARED-UID");
});
