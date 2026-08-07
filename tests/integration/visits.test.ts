import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@better-stack/api/routers/index";
import { db } from "@better-stack/db";
import { visits } from "@better-stack/db/schema/visits";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
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

function catalogItemInput(orgSlug: string, code: string, name: string, unitPrice = "150.00") {
  return {
    orgSlug,
    name,
    code,
    category: "consultation" as const,
    unitPrice,
    taxRatePercent: "5.00",
    taxCode: "GST5",
  };
}

async function createVisitSetup(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);
  const patient = await api.patient.register(
    registration(organization.slug, `${seed} Patient`, "5552500"),
  );
  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
  });

  return { owner, organization, api, patient, department };
}

async function createPractitioner(
  api: AppRouterClient,
  orgSlug: string,
  departmentId: string,
  name: string,
  fields: {
    consultFeeItemId?: string | null;
    followUpFeeItemId?: string | null;
    followUpValidityDays?: number | null;
  } = {},
) {
  return api.staff.createPractitioner({
    orgSlug,
    name,
    departmentId,
    ...fields,
  });
}

test("visit tokens increment per practitioner and reset for another practitioner", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-tokens");
  const firstPractitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Token One",
  );
  const secondPractitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Token Two",
  );

  const first = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    departmentId: department.id,
  });
  const second = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    departmentId: department.id,
  });
  const other = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: secondPractitioner.id,
    departmentId: department.id,
  });

  expect(first.visit.tokenNumber).toBe(1);
  expect(second.visit.tokenNumber).toBe(2);
  expect(other.visit.tokenNumber).toBe(1);
});

test("a practitioner consult fee creates an immutable snapshot charge", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-consult-fee");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `CONS-${crypto.randomUUID().slice(0, 8)}`,
      "Initial Consultation",
      "275.00",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Consult Fee",
    { consultFeeItemId: fee.id },
  );

  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge).toMatchObject({
    catalogItemId: fee.id,
    description: "Initial Consultation",
    unitPrice: "275.00",
    taxRatePercent: "5.00",
    taxCode: "GST5",
    qty: 1,
    sourceType: "consult_fee",
    status: "pending",
  });

  await api.catalog.update({
    orgSlug: organization.slug,
    itemId: fee.id,
    name: fee.name,
    code: fee.code,
    category: fee.category,
    unitPrice: "425.00",
    taxRatePercent: fee.taxRatePercent,
    taxCode: fee.taxCode,
    active: true,
  });
  const readBack = await api.visit.get({
    orgSlug: organization.slug,
    visitId: created.visit.id,
  });
  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({
    description: "Initial Consultation",
    unitPrice: "275.00",
    taxRatePercent: "5.00",
  });
});

test("the department default fee is used when the practitioner has no consult fee", async () => {
  const { organization, api, patient } = await createVisitSetup("visit-department-fee");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `DEPT-${crypto.randomUUID().slice(0, 8)}`,
      "Department Consultation",
    ),
  );
  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Department Fee Department",
    defaultConsultFeeItemId: fee.id,
  });
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Department Fee",
  );

  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });

  expect(created.charge).toMatchObject({
    catalogItemId: fee.id,
    description: "Department Consultation",
    sourceType: "consult_fee",
  });
});

test("registration succeeds without a configured fee and creates no charge", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-no-fee");
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. No Fee",
  );

  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge).toBeNull();

  const readBack = await api.visit.get({
    orgSlug: organization.slug,
    visitId: created.visit.id,
  });
  expect(readBack.charges).toEqual([]);
});

test("follow-up fees honor the organization window and a practitioner override", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-follow-up");
  const currentSettings = await api.settings.get({ orgSlug: organization.slug });
  await api.settings.update({
    orgSlug: organization.slug,
    ...currentSettings,
    followUpValidityDays: 14,
  });
  const consultFee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `NEW-${crypto.randomUUID().slice(0, 8)}`,
      "New Consultation",
      "300.00",
    ),
  );
  const followUpFee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `FOLLOW-${crypto.randomUUID().slice(0, 8)}`,
      "Follow-up Consultation",
      "100.00",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Follow Up",
    { consultFeeItemId: consultFee.id, followUpFeeItemId: followUpFee.id },
  );

  const first = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  const second = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(first.charge?.catalogItemId).toBe(consultFee.id);
  expect(second.charge?.catalogItemId).toBe(followUpFee.id);

  const overridePatient = await api.patient.register(
    registration(organization.slug, "Override Window Patient", "5552200"),
  );
  const overridePractitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. One Day Window",
    {
      consultFeeItemId: consultFee.id,
      followUpFeeItemId: followUpFee.id,
      followUpValidityDays: 1,
    },
  );
  const prior = await api.visit.create({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    departmentId: department.id,
  });
  await db
    .update(visits)
    .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
    .where(and(eq(visits.orgId, organization.id), eq(visits.id, prior.visit.id)));

  const outsideOverride = await api.visit.create({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    departmentId: department.id,
  });
  expect(outsideOverride.charge?.catalogItemId).toBe(consultFee.id);
});

test("an inactive practitioner fee falls through to the active department fee", async () => {
  const { organization, api, patient } = await createVisitSetup("visit-inactive-fee");
  const inactive = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `INACTIVE-${crypto.randomUUID().slice(0, 8)}`,
      "Inactive Consultation",
    ),
  );
  await api.catalog.update({
    orgSlug: organization.slug,
    itemId: inactive.id,
    name: inactive.name,
    code: inactive.code,
    category: inactive.category,
    unitPrice: inactive.unitPrice,
    taxRatePercent: inactive.taxRatePercent,
    taxCode: inactive.taxCode,
    active: false,
  });
  const fallback = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `FALLBACK-${crypto.randomUUID().slice(0, 8)}`,
      "Fallback Consultation",
    ),
  );
  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Fallback Department",
    defaultConsultFeeItemId: fallback.id,
  });
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Inactive Fee",
    { consultFeeItemId: inactive.id },
  );

  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge?.catalogItemId).toBe(fallback.id);
});

test("visit transitions enforce the state machine and required cancel reason", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-transitions");
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Transitions",
  );
  const createVisit = () =>
    api.visit.create({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
    });

  const lifecycle = await createVisit();
  const inConsult = await api.visit.transition({
    orgSlug: organization.slug,
    visitId: lifecycle.visit.id,
    to: "in_consult",
  });
  expect(inConsult.status).toBe("in_consult");
  expect(inConsult.startedAt).toBeInstanceOf(Date);
  const completed = await api.visit.transition({
    orgSlug: organization.slug,
    visitId: lifecycle.visit.id,
    to: "completed",
  });
  expect(completed.status).toBe("completed");
  expect(completed.completedAt).toBeInstanceOf(Date);
  await expectORPCCode(
    api.visit.transition({
      orgSlug: organization.slug,
      visitId: lifecycle.visit.id,
      to: "in_consult",
    }),
    "CONFLICT",
  );

  const waiting = await createVisit();
  await expectORPCCode(
    api.visit.transition({
      orgSlug: organization.slug,
      visitId: waiting.visit.id,
      to: "completed",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.visit.transition({
      orgSlug: organization.slug,
      visitId: waiting.visit.id,
      to: "cancelled",
    }),
    "BAD_REQUEST",
  );

  const cannotCancel = await createVisit();
  await api.visit.transition({
    orgSlug: organization.slug,
    visitId: cannotCancel.visit.id,
    to: "in_consult",
  });
  await expectORPCCode(
    api.visit.transition({
      orgSlug: organization.slug,
      visitId: cannotCancel.visit.id,
      to: "cancelled",
      cancelReason: "Patient left",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.visit.transition({
      orgSlug: organization.slug,
      visitId: crypto.randomUUID(),
      to: "in_consult",
    }),
    "NOT_FOUND",
  );
});

test("cancelling a waiting visit voids its pending consult charge", async () => {
  const { organization, api, patient, department } = await createVisitSetup("visit-cancel");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `CANCEL-${crypto.randomUUID().slice(0, 8)}`,
      "Cancelable Consultation",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Cancel",
    { consultFeeItemId: fee.id },
  );
  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge?.status).toBe("pending");

  const reason = "Patient requested cancellation";
  const cancelled = await api.visit.transition({
    orgSlug: organization.slug,
    visitId: created.visit.id,
    to: "cancelled",
    cancelReason: reason,
  });
  expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: reason });
  expect(cancelled.cancelledAt).toBeInstanceOf(Date);

  const readBack = await api.visit.get({
    orgSlug: organization.slug,
    visitId: created.visit.id,
  });
  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({ status: "voided", voidReason: reason });
});

test("visit creation rejects patient, practitioner, and department ids from another organization", async () => {
  const alphaOwner = await createTestUser("visit-refs-alpha-owner");
  const alpha = await createOrganization(alphaOwner, "visit-refs-alpha");
  const alphaApi = clientFor(alphaOwner);
  const alphaPatient = await alphaApi.patient.register(
    registration(alpha.slug, "Alpha Patient", "5552301"),
  );
  const alphaDepartment = await alphaApi.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha Department",
  });
  const alphaPractitioner = await createPractitioner(
    alphaApi,
    alpha.slug,
    alphaDepartment.id,
    "Dr. Alpha",
  );

  const betaOwner = await createTestUser("visit-refs-beta-owner");
  const beta = await createOrganization(betaOwner, "visit-refs-beta");
  const betaApi = clientFor(betaOwner);
  const betaPatient = await betaApi.patient.register(
    registration(beta.slug, "Beta Patient", "5552302"),
  );
  const betaDepartment = await betaApi.staff.createDepartment({
    orgSlug: beta.slug,
    name: "Beta Department",
  });
  const betaPractitioner = await createPractitioner(
    betaApi,
    beta.slug,
    betaDepartment.id,
    "Dr. Beta",
  );

  await expectORPCCode(
    alphaApi.visit.create({
      orgSlug: alpha.slug,
      patientId: betaPatient.id,
      practitionerId: alphaPractitioner.id,
      departmentId: alphaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaApi.visit.create({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: betaPractitioner.id,
      departmentId: alphaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaApi.visit.create({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: alphaPractitioner.id,
      departmentId: betaDepartment.id,
    }),
    "NOT_FOUND",
  );
});

test("visit create and transition successes are written to the audit trail", async () => {
  const { owner, organization, api, patient, department } = await createVisitSetup("visit-audit");
  const practitioner = await createPractitioner(api, organization.slug, department.id, "Dr. Audit");
  const created = await api.visit.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  await api.visit.transition({
    orgSlug: organization.slug,
    visitId: created.visit.id,
    to: "in_consult",
  });

  const entries = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    const createEntry = audit.items.find(
      (entry) => entry.action === "visit.create" && entry.target === `visit:${created.visit.id}`,
    );
    const transitionEntry = audit.items.find(
      (entry) =>
        entry.action === "visit.transition" && entry.target === `visit:${created.visit.id}`,
    );
    return createEntry && transitionEntry ? { createEntry, transitionEntry } : undefined;
  });
  expect(entries.createEntry.actorId).toBe(owner.user.id);
  expect(entries.createEntry.orgId).toBe(organization.id);
  expect(entries.transitionEntry.actorId).toBe(owner.user.id);
  expect(entries.transitionEntry.orgId).toBe(organization.id);
  expect(entries.transitionEntry.meta).toMatchObject({ to: "in_consult" });
});
