import { beforeAll, expect, test } from "bun:test";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
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
    ageYears: 30,
    address: "",
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
  expect(matches.items.every((patient) => patient.orgId === one.id)).toBe(true);
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
  let cursor: { createdAt: Date; id: string } | undefined;
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
    name: "After Update",
    phone: "5550401",
    sex: "female",
    dateOfBirth: "1990-04-05",
    ageYears: null,
    address: "Updated address",
  });

  expect(updated).toMatchObject({
    id: original.id,
    orgId: original.orgId,
    mrn: original.mrn,
    name: "After Update",
    phone: "5550401",
    sex: "female",
    dateOfBirth: "1990-04-05",
    ageYears: null,
    address: "Updated address",
    createdBy: original.createdBy,
    createdAt: original.createdAt,
  });
  expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());

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
      name: "Missing",
      phone: "5550499",
      sex: "male",
      ageYears: 40,
      address: "",
    }),
    "NOT_FOUND",
  );
});

test("registration requires either date of birth or age", async () => {
  const owner = await createTestUser("patient-validation");
  const organization = await createOrganization(owner, "patient-validation");

  await expectORPCCode(
    clientFor(owner).patient.register({
      orgSlug: organization.slug,
      name: "Missing Age",
      phone: "5550500",
      sex: "other",
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
    ...registration(organization.slug, "Patient Master Fields", "5550550"),
    sex: "unknown",
    email: "patient@example.com",
    bloodGroup: "AB-",
    allergies: "Penicillin",
    medicalHistory: "Hypertension",
    uid: "  NATIONAL-123  ",
  });
  const patient = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });

  expect(patient).toMatchObject({
    sex: "unknown",
    email: "patient@example.com",
    bloodGroup: "AB-",
    allergies: "Penicillin",
    medicalHistory: "Hypertension",
    uid: "NATIONAL-123",
  });
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
    name: "Audited Patient Updated",
    phone: "5550601",
    sex: "male",
    ageYears: 31,
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
