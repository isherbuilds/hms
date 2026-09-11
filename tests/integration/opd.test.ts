import { beforeAll, expect, test } from "bun:test";
import pg from "pg";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { roles } from "@hms/auth/access";
import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { and, eq } from "drizzle-orm";
import { businessDate, localMinute } from "@hms/api/lib/business-date";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { shiftLocalMinute } from "../support/time";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

function requireInvoice(result: Awaited<ReturnType<AppRouterClient["opd"]["createWalkIn"]>>) {
  if (!result.invoice) throw new Error("Expected walk-in to issue an invoice");

  return result.invoice;
}

async function appointmentCharges(api: AppRouterClient, orgSlug: string, appointmentId: string) {
  return (await api.opd.get({ orgSlug, appointmentId })).charges;
}

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

function catalogItemInput(orgSlug: string, code: string, name: string, unitPrice = 150_00n) {
  return {
    orgSlug,
    name,
    code,
    category: "consultation" as const,
    unitPrice,
    taxRatePercent: "5.00",
    taxCode: "GST5",
    customRate: false,
  };
}

function unpaidSettlement(expectedGrandTotal = 157_50n) {
  return {
    expectedGrandTotal,
    payments: [],
    note: "Integration test leaves this walk-in unpaid",
  };
}

async function createOpdAppointmentSetup(seed: string, withDefaultFee = true) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);

  const patient = await api.patient.register(
    registration(organization.slug, `${seed} Patient`, "5552500"),
  );

  const defaultFee = withDefaultFee
    ? await api.catalog.create(
        catalogItemInput(
          organization.slug,
          `DEFAULT-${uniqueSuffix()}`,
          `${seed} Default Consultation`,
        ),
      )
    : null;

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
    defaultConsultFeeItemId: defaultFee?.id,
  });

  return { owner, organization, api, patient, department };
}

async function journalFor(orgId: string, sourceType: string, sourceId: string) {
  const entries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );

  if (entries.length !== 1) {
    return { entries, lines: [] };
  }

  const lines = await db
    .select({
      systemKey: accounts.systemKey,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, orgId)))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entries[0]!.id)));

  return { entries, lines };
}

function moneyTotal(values: bigint[]) {
  return values.reduce((sum, value) => sum + value, 0n);
}

function expectBalanced(lines: Array<{ debit: bigint; credit: bigint }>) {
  expect(moneyTotal(lines.map((line) => line.debit))).toBe(
    moneyTotal(lines.map((line) => line.credit)),
  );
}

function lineBySystemKey(
  lines: Array<{ systemKey: string | null; debit: bigint; credit: bigint }>,
  systemKey: string,
) {
  const line = lines.find((candidate) => candidate.systemKey === systemKey);

  if (!line) {
    throw new Error(`expected journal line for account ${systemKey}`);
  }

  return line;
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

test("booking accepts only a minute later than the fresh organization minute", async () => {
  const { owner, organization, patient, department } =
    await createOpdAppointmentSetup("opd-book-time-boundary");

  const api = clientFor(owner);

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Book Boundary",
  );

  const settings = await api.settings.get({ orgSlug: organization.slug });
  const currentMinute = localMinute(new Date(), settings.timeZone);

  const input = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  await expectORPCCode(api.opd.book({ ...input, scheduledLocal: currentMinute }), "BAD_REQUEST");

  const booked = await api.opd.book({
    ...input,
    scheduledLocal: shiftLocalMinute(currentMinute, 5),
  });

  expect(booked.status).toBe("booked");
});

test("walk-in creation uses the fresh server time without a client time claim", async () => {
  const { owner, organization, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-time-boundary",
  );

  const api = clientFor(owner);

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Walk-in Boundary",
  );

  const settings = await api.settings.get({ orgSlug: organization.slug });

  const input = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  };

  const before = businessDate(new Date(), settings.timeZone);
  const created = await api.opd.createWalkIn(input);
  const after = businessDate(new Date(), settings.timeZone);
  expect(created.appointment.status).toBe("checked_in");
  expect([before, after]).toContain(created.appointment.businessDate);
});

test("walk-in creation requires patient read and denial writes nothing", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-patient-read",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Patient Read",
  );

  const operator = await createTestUser("opd-without-patient-read");
  await joinOrganization(operator, organization.id);
  const operatorApi = clientFor(operator);

  // No production role lacks patient:read, so the serial runner fabricates this denial.
  const receptionStatements = roles.reception.statements;
  const originalPatientGrants = receptionStatements.patient;
  Object.assign(receptionStatements, { patient: ["create", "update"] });

  try {
    await expectORPCCode(
      operatorApi.opd.createWalkIn({
        orgSlug: organization.slug,
        patientId: patient.id,
        practitionerId: practitioner.id,
        settlement: unpaidSettlement(),
      }),
      "FORBIDDEN",
    );
  } finally {
    Object.assign(receptionStatements, { patient: originalPatientGrants });
  }

  expect(
    await db
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(eq(opdAppointments.orgId, organization.id)),
  ).toHaveLength(0);
  expect(
    await db.select({ id: charges.id }).from(charges).where(eq(charges.orgId, organization.id)),
  ).toHaveLength(0);
  expect(
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.orgId, organization.id)),
  ).toHaveLength(0);
});

test("OPD appointment tokens increment per practitioner and reset for another practitioner", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup("opd-tokens");

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

  const first = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    settlement: unpaidSettlement(),
  });

  const second = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    settlement: unpaidSettlement(),
  });

  const other = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: secondPractitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(first.appointment.tokenNumber).toBe(1);
  expect(second.appointment.tokenNumber).toBe(2);
  expect(other.appointment.tokenNumber).toBe(1);
});

test("a practitioner consult fee creates an immutable snapshot charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-consult-fee");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `CONS-${uniqueSuffix()}`, "Initial Consultation", 275_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Consult Fee",
    { consultFeeItemId: fee.id },
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(288_75n),
  });

  expect(
    (await appointmentCharges(api, organization.slug, created.appointment.id))[0],
  ).toMatchObject({
    catalogItemId: fee.id,
    description: "Initial Consultation",
    unitPrice: 275_00n,
    taxRatePercent: "5.00",
    taxCode: "GST5",
    qty: 1,
    sourceType: "consult_fee",
    status: "invoiced",
  });

  await api.catalog.update({
    orgSlug: organization.slug,
    itemId: fee.id,
    name: fee.name,
    code: fee.code,
    category: fee.category,
    unitPrice: 425_00n,
    customRate: false,
    taxRatePercent: fee.taxRatePercent,
    taxCode: fee.taxCode,
  });

  const readBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(created.appointment.chargeRevision).toBe(1);
  expect(created.appointment.chargeRevision).toBe(readBack.appointment.chargeRevision);
  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({
    description: "Initial Consultation",
    unitPrice: 275_00n,
    taxRatePercent: "5.00",
  });
});

test("a walk-in creates the configured consultation charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-fee");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `WALKIN-${uniqueSuffix()}`,
      "Walk-in Consultation",
      325_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Walk-in Fee",
    { consultFeeItemId: fee.id },
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(341_25n),
  });

  expect(created.appointment).not.toHaveProperty("kind");
  expect(
    (await appointmentCharges(api, organization.slug, created.appointment.id))[0],
  ).toMatchObject({
    catalogItemId: fee.id,
    sourceType: "consult_fee",
    status: "invoiced",
  });
});

test("the department default fee is used when the practitioner has no consult fee", async () => {
  const { organization, api, patient } = await createOpdAppointmentSetup("opd-department-fee");

  const fee = await api.catalog.create({
    ...catalogItemInput(organization.slug, `DEPT-${uniqueSuffix()}`, "Department Attendance Fee"),
    category: "lab" as const,
  });

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

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(
    (await appointmentCharges(api, organization.slug, created.appointment.id))[0],
  ).toMatchObject({
    catalogItemId: fee.id,
    description: "Department Attendance Fee",
    revenueCategory: "lab",
    sourceType: "consult_fee",
  });
});

test("a practitioner without a configured fee creates a zero-value walk-in", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-no-fee",
    false,
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. No Fee",
  );

  const input = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  const quote = await api.opd.quoteWalkIn(input);
  expect(quote).toMatchObject({ lines: [], subtotal: 0n, grandTotal: 0n });

  const created = await api.opd.createWalkIn({ ...input, settlement: unpaidSettlement(0n) });
  expect(created).toMatchObject({ invoice: null, payments: [] });
});

test("follow-up pricing excludes a cancelled prior attendance", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-follow-up-open");

  const consultFee = await api.catalog.create(
    catalogItemInput(organization.slug, `NEW-${uniqueSuffix()}`, "New Consultation", 300_00n),
  );

  const followUpFee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `FOLLOW-${uniqueSuffix()}`,
      "Free Follow-up Consultation",
      0n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Still Waiting",
    { consultFeeItemId: consultFee.id, followUpFeeItemId: followUpFee.id },
  );

  const first = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(315_00n),
  });

  await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: first.appointment.id,
    reason: "Patient left",
  });

  const duplicate = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(315_00n),
  });

  expect(
    (await appointmentCharges(api, organization.slug, first.appointment.id))[0]?.catalogItemId,
  ).toBe(consultFee.id);
  expect(
    (await appointmentCharges(api, organization.slug, duplicate.appointment.id))[0]?.catalogItemId,
  ).toBe(consultFee.id);
});

test("follow-up fees honor the organization window and a practitioner override", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-follow-up");

  const currentSettings = await api.settings.get({ orgSlug: organization.slug });
  await api.settings.update({
    orgSlug: organization.slug,
    ...currentSettings,
    followUpValidityDays: 14,
  });

  const consultFee = await api.catalog.create(
    catalogItemInput(organization.slug, `NEW-${uniqueSuffix()}`, "New Consultation", 300_00n),
  );

  const followUpFee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `FOLLOW-${uniqueSuffix()}`,
      "Follow-up Consultation",
      100_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Follow Up",
    { consultFeeItemId: consultFee.id, followUpFeeItemId: followUpFee.id },
  );

  const first = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(315_00n),
  });

  expect(first.appointment.status).toBe("checked_in");

  const second = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(105_00n),
  });

  expect(
    (await appointmentCharges(api, organization.slug, first.appointment.id))[0]?.catalogItemId,
  ).toBe(consultFee.id);
  expect(
    (await appointmentCharges(api, organization.slug, second.appointment.id))[0]?.catalogItemId,
  ).toBe(followUpFee.id);

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

  const prior = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    settlement: unpaidSettlement(315_00n),
  });

  await db
    .update(opdAppointments)
    .set({ arrivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
    .where(
      and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, prior.appointment.id)),
    );

  const outsideOverride = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    settlement: unpaidSettlement(315_00n),
  });

  expect(
    (await appointmentCharges(api, organization.slug, outsideOverride.appointment.id))[0]
      ?.catalogItemId,
  ).toBe(consultFee.id);
});

test("an inactive practitioner fee falls through to the active department fee", async () => {
  const { organization, api, patient } = await createOpdAppointmentSetup("opd-inactive-fee");

  const inactive = await api.catalog.create(
    catalogItemInput(organization.slug, `INACTIVE-${uniqueSuffix()}`, "Inactive Consultation"),
  );

  await api.catalog.setActive({ orgSlug: organization.slug, itemId: inactive.id, active: false });

  const fallback = await api.catalog.create(
    catalogItemInput(organization.slug, `FALLBACK-${uniqueSuffix()}`, "Fallback Consultation"),
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

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(
    (await appointmentCharges(api, organization.slug, created.appointment.id))[0]?.catalogItemId,
  ).toBe(fallback.id);
});

test("OPD appointment commands enforce the four-status state machine", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-transitions");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Transitions",
  );

  const checkedIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(checkedIn.appointment.status).toBe("checked_in");
  await expectORPCCode(
    api.opd.markNoShow({
      orgSlug: organization.slug,
      appointmentId: checkedIn.appointment.id,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: checkedIn.appointment.id,
      reason: "",
    }),
    "BAD_REQUEST",
  );

  const cancelled = await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: checkedIn.appointment.id,
    reason: "Patient left",
  });

  expect(cancelled.status).toBe("cancelled");
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: checkedIn.appointment.id,
      reason: "Again",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: Bun.randomUUIDv7(),
      reason: "Patient left",
    }),
    "CONFLICT",
  );
});

test("staff attach and detach the doctor's paper prescription from an OPD appointment", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-prescription");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Paper Prescription",
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  const upload = await api.file.createUpload({
    orgSlug: organization.slug,
    name: "signed-prescription.jpg",
    mimeType: "image/jpeg",
    size: 1,
  });

  await api.file.finalizeUpload({ orgSlug: organization.slug, key: upload.key });

  const attached = await api.opd.attachPrescription({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
    fileId: upload.key,
  });

  expect(attached).toMatchObject({
    targetType: "prescription",
    targetId: created.appointment.id,
    fileId: upload.key,
    createdBy: owner.user.id,
  });

  const detail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(detail.prescriptions).toEqual([
    expect.objectContaining({
      id: attached.id,
      fileId: upload.key,
      name: "signed-prescription.jpg",
      mimeType: "image/jpeg",
      size: 1,
      createdAt: expect.any(Date),
    }),
  ]);

  await expectORPCCode(
    api.opd.attachPrescription({
      orgSlug: organization.slug,
      appointmentId: created.appointment.id,
      fileId: upload.key,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.file.delete({ orgSlug: organization.slug, key: upload.key }),
    "CONFLICT",
  );

  const textUpload = await api.file.createUpload({
    orgSlug: organization.slug,
    name: "not-a-prescription.txt",
    mimeType: "text/plain",
    size: 32,
  });

  await api.file.finalizeUpload({ orgSlug: organization.slug, key: textUpload.key });
  await expectORPCCode(
    api.opd.attachPrescription({
      orgSlug: organization.slug,
      appointmentId: created.appointment.id,
      fileId: textUpload.key,
    }),
    "NOT_FOUND",
  );

  const foreignOwner = await createTestUser("opd-prescription-foreign-owner");
  const foreignOrganization = await createOrganization(foreignOwner, "opd-prescription-foreign");
  const foreignApi = clientFor(foreignOwner);

  const foreignUpload = await foreignApi.file.createUpload({
    orgSlug: foreignOrganization.slug,
    name: "foreign-prescription.jpg",
    mimeType: "image/jpeg",
    size: 1,
  });

  await foreignApi.file.finalizeUpload({
    orgSlug: foreignOrganization.slug,
    key: foreignUpload.key,
  });
  await expectORPCCode(
    api.opd.attachPrescription({
      orgSlug: organization.slug,
      appointmentId: created.appointment.id,
      fileId: foreignUpload.key,
    }),
    "NOT_FOUND",
  );

  await api.opd.detachPrescription({
    orgSlug: organization.slug,
    attachmentId: attached.id,
  });
  expect(
    (await api.opd.get({ orgSlug: organization.slug, appointmentId: created.appointment.id }))
      .prescriptions,
  ).toEqual([]);
  expect(
    (await api.file.getReadUrl({ orgSlug: organization.slug, key: upload.key })).url,
  ).toContain("X-Amz-Signature");

  for (const action of ["opd.prescription.attach", "opd.prescription.detach"]) {
    const entry = await eventually(async () => {
      const audit = await api.audit.list({ orgSlug: organization.slug });

      return audit.items.find((item) => item.action === action);
    });

    expect(entry.target).toBe(`opd:${created.appointment.id}`);
    expect(entry.meta).toMatchObject({ attachmentId: attached.id, fileId: upload.key });
  }
});

test("prescription attachment rechecks cancellation after waiting on the OPD row lock", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-prescription-cancel-race",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Prescription Race",
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  const upload = await api.file.createUpload({
    orgSlug: organization.slug,
    name: "racing-prescription.jpg",
    mimeType: "image/jpeg",
    size: 1,
  });

  await api.file.finalizeUpload({ orgSlug: organization.slug, key: upload.key });

  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();

  try {
    await locker.query("begin");
    await locker.query(
      `update opd_appointments
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Concurrent cancellation'
       where org_id = $1 and id = $2`,
      [organization.id, created.appointment.id],
    );

    const blockerPid = (await locker.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;

    if (!blockerPid) throw new Error("Expected cancellation transaction backend pid");

    const attachment = api.opd.attachPrescription({
      orgSlug: organization.slug,
      appointmentId: created.appointment.id,
      fileId: upload.key,
    });

    let reachedOpdLock = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = await locker.query<{ blocked: boolean }>(
        `select exists (
           select 1 from pg_stat_activity
           where $1 = any(pg_blocking_pids(pid))
         ) as blocked`,
        [blockerPid],
      );

      if (blocked.rows[0]?.blocked) {
        reachedOpdLock = true;
        break;
      }

      await Bun.sleep(20);
    }

    expect(reachedOpdLock).toBe(true);

    await locker.query("commit");
    await expectORPCCode(attachment, "NOT_FOUND");
  } finally {
    await locker.query("rollback").catch(() => undefined);
    await locker.end();
  }
});

test("cancelling a checked-in OPD appointment voids its pending consult charge", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup("opd-cancel");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `CANCEL-${uniqueSuffix()}`, "Cancelable Consultation"),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Cancel",
    { consultFeeItemId: fee.id },
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-20T09:00",
  });

  const created = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(created.charge?.status).toBe("pending");

  const reason = "Patient requested cancellation";

  const cancelled = await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
    reason,
  });

  expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: reason });
  expect(cancelled.cancelledAt).toBeInstanceOf(Date);

  const readBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({ status: "voided", voidReason: reason });
});

test("OPD appointment creation rejects patient and practitioner ids from another organization", async () => {
  const alphaOwner = await createTestUser("opd-refs-alpha-owner");
  const alpha = await createOrganization(alphaOwner, "opd-refs-alpha");
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

  const betaOwner = await createTestUser("opd-refs-beta-owner");
  const beta = await createOrganization(betaOwner, "opd-refs-beta");
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
    alphaApi.opd.createWalkIn({
      orgSlug: alpha.slug,
      patientId: betaPatient.id,
      practitionerId: alphaPractitioner.id,
      settlement: unpaidSettlement(),
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaApi.opd.createWalkIn({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: betaPractitioner.id,
      settlement: unpaidSettlement(),
    }),
    "NOT_FOUND",
  );
});

test("sensitive OPD creation is audited while routine care transitions are not", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-audit");

  const practitioner = await createPractitioner(api, organization.slug, department.id, "Dr. Audit");

  const walkIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-14T09:00",
  });

  await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  await drainAuditWrites();
  const audit = await api.audit.list({ orgSlug: organization.slug });

  const walkInEntry = audit.items.find(
    (entry) =>
      entry.action === "opd.walk_in.create" && entry.target === `opd:${walkIn.appointment.id}`,
  );

  expect(
    audit.items.find((entry) => entry.action === "opd.book" && entry.target === `opd:${booked.id}`),
  ).toBeUndefined();
  expect(walkInEntry).toMatchObject({ actorId: owner.user.id, orgId: organization.id });

  const routineActions = new Set(["opd.check_in"]);
  expect(
    audit.items.filter(
      (entry) =>
        routineActions.has(entry.action) &&
        [walkIn.appointment.id, booked.id].some((id) => entry.target === `opd:${id}`),
    ),
  ).toEqual([]);
});

test("clinical cancellation preserves an already-issued invoice", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-cancel-invoiced");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `CONS-${uniqueSuffix()}`, "Consultation", 400_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Invoiced",
    { consultFeeItemId: fee.id },
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(420_00n),
  });

  const issued = requireInvoice(created);

  const cancelled = await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
    reason: "Patient left",
  });

  expect(cancelled.status).toBe("cancelled");

  const invoices = await api.billing.listInvoices({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(invoices.map((invoice) => invoice.id)).toContain(issued.id);
});

test("a caller-only booking becomes the same queued appointment at check-in", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-book-check-in");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `BOOK-${uniqueSuffix()}`, "Booked Consultation"),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Booking",
    { consultFeeItemId: fee.id },
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    callerName: "Patient's daughter",
    callerPhone: "9876500011",
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T10:30",
  });

  expect(booked).toMatchObject({
    arrivalMode: "scheduled",
    status: "booked",
    patientId: null,
    tokenNumber: null,
  });
  expect(booked).not.toHaveProperty("kind");

  const callerNameResults = await api.opd.day({
    orgSlug: organization.slug,
    date: booked.businessDate,
    q: "daughter",
  });

  expect(callerNameResults.items.map((appointment) => appointment.id)).toContain(booked.id);

  const callerPhoneResults = await api.opd.day({
    orgSlug: organization.slug,
    date: booked.businessDate,
    q: "9876500011",
  });

  expect(callerPhoneResults.items.map((appointment) => appointment.id)).toContain(booked.id);

  const bookedDetail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(bookedDetail.patient).toBeNull();
  expect(bookedDetail.appointment).toMatchObject({
    status: "booked",
    tokenNumber: null,
    callerName: "patient's daughter",
    callerPhone: "9876500011",
  });
  await expectORPCCode(
    api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id }),
    "BAD_REQUEST",
  );

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
    patientId: patient.id,
  });

  expect(checkedIn.appointment).toMatchObject({
    id: booked.id,
    arrivalMode: "scheduled",
    status: "checked_in",
    patientId: patient.id,
    tokenNumber: 1,
  });
  expect(checkedIn.charge?.catalogItemId).toBe(fee.id);

  const queue = await api.opd.day({
    orgSlug: organization.slug,
    date: checkedIn.appointment.businessDate,
  });

  expect(queue.items.map((appointment) => appointment.id)).toContain(booked.id);
});

test("a booking linked to a patient checks in without re-selecting them", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-book-linked");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `LINK-${uniqueSuffix()}`, "Linked Consultation"),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Linked Booking",
    { consultFeeItemId: fee.id },
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T11:00",
  });

  expect(booked).toMatchObject({ status: "booked", patientId: patient.id, tokenNumber: null });

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(checkedIn.appointment).toMatchObject({
    id: booked.id,
    status: "checked_in",
    patientId: patient.id,
    tokenNumber: 1,
  });
  expect(checkedIn.charge?.catalogItemId).toBe(fee.id);
});

test("a scheduled appointment creates the configured consultation charge at check-in", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-scheduled-check-in-fee",
  );

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `SCHEDULED-${uniqueSuffix()}`,
      "Scheduled Consultation",
      475_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Scheduled Booking",
    { consultFeeItemId: fee.id },
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T12:00",
  });

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(checkedIn.appointment).toMatchObject({ id: booked.id, status: "checked_in" });
  expect(checkedIn.charge).toMatchObject({
    catalogItemId: fee.id,
    sourceType: "consult_fee",
    status: "pending",
  });
});

test("check-in rejects a practitioner moved out of the booked department", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-check-in-practitioner-transfer",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Department Transfer",
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T12:10",
  });

  const destination = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Destination Department",
  });

  await api.staff.updatePractitioner({
    orgSlug: organization.slug,
    practitionerId: practitioner.id,
    name: practitioner.name,
    departmentId: destination.id,
    registrationNumber: practitioner.registrationNumber,
    memberUserId: practitioner.memberUserId,
    consultFeeItemId: practitioner.consultFeeItemId,
    followUpFeeItemId: practitioner.followUpFeeItemId,
    followUpValidityDays: practitioner.followUpValidityDays,
  });

  await expectORPCCode(
    api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id }),
    "CONFLICT",
  );
  expect(
    (await api.opd.get({ orgSlug: organization.slug, appointmentId: booked.id })).appointment,
  ).toMatchObject({ status: "booked", departmentId: department.id });
});

test("an outpatient appointment refuses a charge it may not carry", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-billable-categories");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Categories",
  );

  const labPanel = await api.catalog.create({
    ...catalogItemInput(organization.slug, `LAB-${uniqueSuffix()}`, "Lipid panel", 400_00n),
    category: "lab" as const,
  });

  await expectORPCCode(
    api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      scheduledLocal: "2030-04-02T09:30",
      services: [{ catalogItemId: labPanel.id, qty: 1 }],
    }),
    "NOT_FOUND",
  );
  expect((await api.opd.day({ orgSlug: organization.slug, date: "2030-04-02" })).items).toEqual([]);
});

test("procedure rates flow through booking, walk-in quotes and stored charges", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-custom-procedure-rate",
    false,
  );

  const procedure = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `CUSTOM-RATE-${uniqueSuffix()}`,
      "Custom-rate procedure",
      30_00n,
    ),
    category: "procedure" as const,
    customRate: true,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Custom Rate",
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-04-02T10:00",
    services: [{ catalogItemId: procedure.id, qty: 1, unitPrice: 45_00n }],
  });

  expect(await appointmentCharges(api, organization.slug, booked.id)).toEqual([
    expect.objectContaining({ catalogItemId: procedure.id, qty: 1, unitPrice: 45_00n }),
  ]);

  const services = [{ catalogItemId: procedure.id, qty: 2, unitPrice: 40_00n }];

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    services,
    omitConsultFee: true,
  });

  expect(quote).toMatchObject({ subtotal: 80_00n, taxTotal: 4_00n, grandTotal: 84_00n });
  expect(quote.lines).toEqual([
    expect.objectContaining({
      chargeId: procedure.id,
      qty: 2,
      unitPrice: 40_00n,
      gross: 84_00n,
    }),
  ]);

  const walkIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      services,
      omitConsultFee: true,
      expectedGrandTotal: quote.grandTotal,
      payments: [{ method: "cash", amount: quote.grandTotal }],
    },
  });

  expect(requireInvoice(walkIn)).toMatchObject({
    subtotal: 80_00n,
    taxTotal: 4_00n,
    grandTotal: 84_00n,
  });
  expect(await appointmentCharges(api, organization.slug, walkIn.appointment.id)).toEqual([
    expect.objectContaining({ catalogItemId: procedure.id, qty: 2, unitPrice: 40_00n }),
  ]);
  expect(
    (
      await api.catalog.searchServices({
        orgSlug: organization.slug,
        query: procedure.code,
        includeConsultation: false,
      })
    )[0],
  ).toMatchObject({ id: procedure.id, unitPrice: 30_00n, customRate: true });
});

test("a custom rate needs the catalog flag and cannot go below the catalog rate", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-custom-rate-validation",
    false,
  );

  const fixed = await api.catalog.create({
    ...catalogItemInput(organization.slug, `FIXED-RATE-${uniqueSuffix()}`, "Fixed-rate procedure"),
    category: "procedure" as const,
  });

  const variable = await api.catalog.create({
    ...catalogItemInput(organization.slug, `CUSTOM-RATE-${uniqueSuffix()}`, "Variable procedure"),
    category: "procedure" as const,
    customRate: true,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Custom Rate Validation",
  );

  const base = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    omitConsultFee: true,
  };

  await expectORPCCode(
    api.opd.quoteWalkIn({
      ...base,
      services: [{ catalogItemId: fixed.id, qty: 1, unitPrice: 200_00n }],
    }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    api.opd.quoteWalkIn({
      ...base,
      services: [{ catalogItemId: variable.id, qty: 1, unitPrice: variable.unitPrice - 1n }],
    }),
    "BAD_REQUEST",
  );
});

test("a scheduled appointment keeps selected services until check-in", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-scheduled-services");

  const service = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `SCHEDULED-SERVICE-${uniqueSuffix()}`,
      "Booked dressing",
      350_00n,
    ),
    category: "procedure" as const,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Scheduled Services",
  );

  await expectORPCCode(
    api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      scheduledLocal: "2030-03-15T12:15",
      services: [{ catalogItemId: Bun.randomUUIDv7(), qty: 1 }],
    }),
    "NOT_FOUND",
  );
  expect((await api.opd.day({ orgSlug: organization.slug, date: "2030-03-15" })).items).toEqual([]);

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T12:30",
    services: [{ catalogItemId: service.id, qty: 2 }],
  });

  const detail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(detail.charges).toEqual([
    expect.objectContaining({
      catalogItemId: service.id,
      qty: 2,
      sourceType: "catalog",
      status: "pending",
    }),
  ]);
  expect(
    (await api.billing.worklist({ orgSlug: organization.slug })).unbilled.map(
      (row) => row.appointmentId,
    ),
  ).not.toContain(booked.id);
  expect((await api.dashboard.collections({ orgSlug: organization.slug })).unbilled).toBe(0n);

  await api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id });
  expect(
    (await api.billing.worklist({ orgSlug: organization.slug })).unbilled.map(
      (row) => row.appointmentId,
    ),
  ).not.toContain(booked.id);
  expect((await api.dashboard.collections({ orgSlug: organization.slug })).unbilled).toBe(0n);
});

test("day keyset pagination traverses checked-in arrivals once", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-queue-pagination");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Queue Pagination",
  );

  const first = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(),
  });

  const createdIds = [first.appointment.id];
  const arrivedAt = first.appointment.arrivedAt!;

  const extraRows = Array.from({ length: 204 }, (_, index) => {
    const id = Bun.randomUUIDv7();
    createdIds.push(id);
    const createdAt = new Date(arrivedAt.getTime() + index + 1);

    return {
      id,
      orgId: organization.id,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
      arrivalMode: "walk_in" as const,
      status: "checked_in" as const,
      businessDate: first.appointment.businessDate,
      tokenNumber: index + 2,
      arrivedAt: createdAt,
      createdBy: owner.user.id,
      createdAt,
      updatedAt: createdAt,
    };
  });

  await db.insert(opdAppointments).values(extraRows);

  const seenIds: string[] = [];
  let cursor: { dayOrderAt: Date; id: string } | undefined;

  do {
    const page = await api.opd.day({
      orgSlug: organization.slug,
      date: first.appointment.businessDate,
      includeClosed: false,
      limit: 100,
      cursor,
    });

    seenIds.push(...page.items.map((appointment) => appointment.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  expect(seenIds).toHaveLength(new Set(seenIds).size);
  expect(seenIds.toSorted()).toEqual(createdIds.toSorted());
});

test("day keyset pagination uses id to traverse equal scheduled times once", async () => {
  const { owner, organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-appointment-pagination",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Appointment Pagination",
  );

  const first = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-18T10:00",
  });

  const bookedIds = [first.id];

  const extraRows = Array.from({ length: 204 }, () => {
    const id = Bun.randomUUIDv7();
    bookedIds.push(id);

    return {
      id,
      orgId: organization.id,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
      arrivalMode: "scheduled" as const,
      status: "booked" as const,
      businessDate: first.businessDate,
      scheduledFor: first.scheduledFor,
      createdBy: owner.user.id,
    };
  });

  await db.insert(opdAppointments).values(extraRows);

  const seenIds: string[] = [];
  let cursor: { dayOrderAt: Date; id: string } | undefined;

  do {
    const page = await api.opd.day({
      orgSlug: organization.slug,
      date: first.businessDate,
      limit: 100,
      cursor,
    });

    seenIds.push(...page.items.map((appointment) => appointment.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  expect(seenIds).toHaveLength(new Set(seenIds).size);
  expect(seenIds.toSorted()).toEqual(bookedIds.toSorted());
});

test("day interleaves visits, searches patient keys, returns balances, and closes past bookings", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-day");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `DAY-${uniqueSuffix()}`, "Day Consultation", 200_00n),
  );

  const practitioner = await createPractitioner(api, organization.slug, department.id, "Dr. Day", {
    consultFeeItemId: fee.id,
  });

  const arrived = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(210_00n),
  });

  await db
    .update(opdAppointments)
    .set({ tokenNumber: 987 })
    .where(
      and(
        eq(opdAppointments.orgId, organization.id),
        eq(opdAppointments.id, arrived.appointment.id),
      ),
    );

  const bookedPatient = await api.patient.register(
    registration(organization.slug, "Searchable Nair", "5558801"),
  );

  const currentDay = businessDate(
    new Date(),
    (await api.settings.get({ orgSlug: organization.slug })).timeZone,
  );

  const scheduledId = Bun.randomUUIDv7();
  await db.insert(opdAppointments).values({
    id: scheduledId,
    orgId: organization.id,
    patientId: bookedPatient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
    arrivalMode: "scheduled",
    status: "booked",
    businessDate: currentDay,
    scheduledFor: new Date(arrived.appointment.arrivedAt!.getTime() - 1_000),
    createdBy: owner.user.id,
  });

  const day = await api.opd.day({ orgSlug: organization.slug, date: currentDay });
  expect(day.items.map((row) => row.id)).toEqual([arrived.appointment.id, scheduledId]);
  expect(day.items.find((row) => row.id === arrived.appointment.id)?.balanceDue).toBe(210_00n);

  for (const q of [bookedPatient.name.toLowerCase(), bookedPatient.mrn, bookedPatient.phone]) {
    expect(
      (await api.opd.day({ orgSlug: organization.slug, date: currentDay, q })).items,
    ).toHaveLength(1);
  }

  for (const q of ["%", "_"]) {
    expect(
      (await api.opd.day({ orgSlug: organization.slug, date: currentDay, q })).items,
    ).toHaveLength(0);
  }

  expect(
    (
      await api.opd.day({
        orgSlug: organization.slug,
        date: currentDay,
        q: "987",
      })
    ).items.map((row) => row.id),
  ).toEqual([arrived.appointment.id]);

  const callerOnlyId = Bun.randomUUIDv7();
  await db.insert(opdAppointments).values({
    id: callerOnlyId,
    orgId: organization.id,
    patientId: null,
    practitionerId: practitioner.id,
    departmentId: department.id,
    arrivalMode: "walk_in",
    status: "cancelled",
    businessDate: currentDay,
    tokenNumber: 654,
    callerName: "Walk-in caller",
    callerPhone: "5558802",
    arrivedAt: new Date(arrived.appointment.arrivedAt!.getTime() + 1_000),
    cancelledAt: new Date(arrived.appointment.arrivedAt!.getTime() + 2_000),
    createdBy: owner.user.id,
  });
  expect(
    (
      await api.opd.day({
        orgSlug: organization.slug,
        date: currentDay,
        q: "654",
        includeClosed: true,
      })
    ).items.map((row) => row.id),
  ).toEqual([callerOnlyId]);

  const yesterday = new Date(`${currentDay}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const pastDay = yesterday.toISOString().slice(0, 10);

  const plannedService = await api.catalog.create({
    ...catalogItemInput(organization.slug, `PAST-SERVICE-${uniqueSuffix()}`, "Past booked service"),
    category: "procedure",
  });

  const pastBooking = await api.opd.book({
    orgSlug: organization.slug,
    patientId: bookedPatient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-20T10:00",
    services: [{ catalogItemId: plannedService.id, qty: 1 }],
  });

  await db
    .update(opdAppointments)
    .set({ businessDate: pastDay, scheduledFor: yesterday })
    .where(and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, pastBooking.id)));

  expect((await api.opd.day({ orgSlug: organization.slug, date: pastDay })).items).toEqual([]);

  const past = await api.opd.day({
    orgSlug: organization.slug,
    date: pastDay,
    includeClosed: true,
  });

  expect(past.items).toEqual([expect.objectContaining({ id: pastBooking.id, status: "no_show" })]);
  expect(
    await db
      .select({ status: charges.status })
      .from(charges)
      .where(and(eq(charges.orgId, organization.id), eq(charges.opdAppointmentId, pastBooking.id))),
  ).toEqual([{ status: "voided" }]);

  const sweepAudit = await eventually(async () => {
    const entries = await api.audit.list({ orgSlug: organization.slug });

    return entries.items.find(
      (entry) => entry.action === "opd.no_show" && entry.target === `opd:${pastBooking.id}`,
    );
  });

  expect(sweepAudit).toMatchObject({
    actorId: owner.user.id,
    orgId: organization.id,
    meta: { voidedCharges: 1, source: "past_day_sweep" },
  });
  expect(
    (await api.opd.get({ orgSlug: organization.slug, appointmentId: scheduledId })).appointment
      .status,
  ).toBe("booked");
});

test("OPD register reconciles expired bookings once without a prior day read", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-register");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Register",
  );

  const appointment = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-20T10:00",
  });

  const timeZone = (await api.settings.get({ orgSlug: organization.slug })).timeZone;
  const yesterday = new Date(`${businessDate(new Date(), timeZone)}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const pastDay = yesterday.toISOString().slice(0, 10);
  await db
    .update(opdAppointments)
    .set({ businessDate: pastDay, scheduledFor: yesterday })
    .where(and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, appointment.id)));

  const first = await api.report.opdRegister({
    orgSlug: organization.slug,
    from: pastDay,
    to: pastDay,
  });

  expect(first.rows).toEqual([
    expect.objectContaining({ appointmentId: appointment.id, status: "no_show" }),
  ]);
  expect(first.totals.byStatus.no_show).toBe(1);

  const second = await api.report.opdRegister({
    orgSlug: organization.slug,
    from: pastDay,
    to: pastDay,
  });

  expect(second).toEqual(first);
  await drainAuditWrites();
  expect(
    (await api.audit.list({ orgSlug: organization.slug })).items.filter(
      (entry) => entry.action === "opd.no_show" && entry.target === `opd:${appointment.id}`,
    ),
  ).toHaveLength(1);
});

test("concurrent check-in mints one token and one consultation charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-check-in-race");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `RACE-${uniqueSuffix()}`, "Race Consultation"),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Check-in Race",
    { consultFeeItemId: fee.id },
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-16T10:30",
  });

  const outcomes = await Promise.allSettled([
    api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id }),
    api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id }),
  ]);

  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  await expectORPCCode(Promise.reject(rejected[0]?.reason), "CONFLICT");

  const storedCharges = await db
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.orgId, organization.id), eq(charges.opdAppointmentId, booked.id)));

  expect(storedCharges).toHaveLength(1);
});

test("booked appointments can be rescheduled or marked no-show without creating queue work", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-reschedule-no-show");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Reschedule",
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-04-01T10:30",
  });

  const settings = await api.settings.get({ orgSlug: organization.slug });
  await expectORPCCode(
    api.opd.reschedule({
      orgSlug: organization.slug,
      appointmentId: booked.id,
      scheduledLocal: localMinute(new Date(), settings.timeZone),
    }),
    "BAD_REQUEST",
  );

  const rescheduled = await api.opd.reschedule({
    orgSlug: organization.slug,
    appointmentId: booked.id,
    scheduledLocal: "2030-04-03T10:30",
  });

  expect(rescheduled.businessDate).not.toBe(booked.businessDate);

  const listed = await api.opd.day({
    orgSlug: organization.slug,
    date: rescheduled.businessDate,
  });

  expect(listed.items.map((appointment) => appointment.id)).toEqual([booked.id]);

  const noShow = await api.opd.markNoShow({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(noShow).toMatchObject({ status: "no_show", tokenNumber: null, arrivedAt: null });
  expect(noShow.noShowAt).toBeInstanceOf(Date);
});

test("marking a booking no-show voids its pending charges and audits the write-off", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-no-show-void");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. No Show",
  );

  const item = await api.catalog.create(
    catalogItemInput(organization.slug, `NOSHOW-${uniqueSuffix()}`, "Advance Consultation"),
  );

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-05-01T09:00",
  });

  // Charges are refused before check-in, so plant one directly.
  await db.insert(charges).values({
    id: Bun.randomUUIDv7(),
    orgId: organization.id,
    opdAppointmentId: booked.id,
    catalogItemId: item.id,
    description: item.name,
    unitPrice: item.unitPrice,
    taxRatePercent: item.taxRatePercent,
    taxCode: item.taxCode,
    revenueCategory: item.category,
    sourceType: "catalog",
    status: "pending",
    createdBy: owner.user.id,
  });

  const noShow = await api.opd.markNoShow({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(noShow.status).toBe("no_show");

  const storedCharges = await db
    .select({ status: charges.status })
    .from(charges)
    .where(and(eq(charges.orgId, organization.id), eq(charges.opdAppointmentId, booked.id)));

  expect(storedCharges).toEqual([{ status: "voided" }]);

  const entry = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });

    return audit.items.find(
      (auditEntry) =>
        auditEntry.action === "opd.no_show" && auditEntry.target === `opd:${booked.id}`,
    );
  });

  expect(entry.meta).toMatchObject({ voidedCharges: 1 });
});

test("a walk-in settled at the desk creates the token, invoice and receipt in one commit", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-settled");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `SETTLE-${uniqueSuffix()}`,
      "Settled Consultation",
      200_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Settled",
    { consultFeeItemId: fee.id },
  );

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  });

  expect(quote).toMatchObject({ subtotal: 200_00n, taxTotal: 10_00n, grandTotal: 210_00n });
  expect(quote.lines).toEqual([
    expect.objectContaining({
      description: "Settled Consultation",
      unitPrice: 200_00n,
      source: "consultation",
    }),
  ]);

  await expectORPCCode(
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      settlement: {
        expectedGrandTotal: 210_00n,
        payments: [{ method: "upi", amount: 210_00n }],
      },
    }),
    "BAD_REQUEST",
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      expectedGrandTotal: 210_00n,
      payments: [
        { method: "cash", amount: 150_00n },
        { method: "upi", amount: 60_00n, reference: "UPI-SETTLED-TEST" },
      ],
    },
  });

  expect(requireInvoice(created).grandTotal).toBe(210_00n);

  const invoices = await api.billing.listInvoices({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(invoices).toHaveLength(1);

  const detail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: invoices[0]!.id,
  });

  expect(detail.payments).toHaveLength(2);
  expect(detail.balance.outstanding).toBe(0n);

  const invoiceJournal = await journalFor(organization.id, "invoice", detail.invoice.id);
  expect(invoiceJournal.entries).toHaveLength(1);
  expectBalanced(invoiceJournal.lines);
  expect(lineBySystemKey(invoiceJournal.lines, "patient_receivables")).toMatchObject({
    debit: 210_00n,
    credit: 0n,
  });
  expect(lineBySystemKey(invoiceJournal.lines, "revenue_consultation")).toMatchObject({
    debit: 0n,
    credit: 200_00n,
  });
  expect(lineBySystemKey(invoiceJournal.lines, "gst_output")).toMatchObject({
    debit: 0n,
    credit: 10_00n,
  });

  const cashPayment = detail.payments.find((payment) => payment.method === "cash");
  const upiPayment = detail.payments.find((payment) => payment.method === "upi");

  if (!cashPayment || !upiPayment) {
    throw new Error("expected both settled payment methods");
  }

  const cashJournal = await journalFor(organization.id, "payment", cashPayment.id);
  expect(cashJournal.entries).toHaveLength(1);
  expectBalanced(cashJournal.lines);
  expect(lineBySystemKey(cashJournal.lines, "cash")).toMatchObject({
    debit: 150_00n,
    credit: 0n,
  });
  expect(lineBySystemKey(cashJournal.lines, "patient_receivables")).toMatchObject({
    debit: 0n,
    credit: 150_00n,
  });
  const upiJournal = await journalFor(organization.id, "payment", upiPayment.id);
  expect(upiJournal.entries).toHaveLength(1);
  expectBalanced(upiJournal.lines);
  expect(lineBySystemKey(upiJournal.lines, "bank")).toMatchObject({
    debit: 60_00n,
    credit: 0n,
  });
  expect(lineBySystemKey(upiJournal.lines, "patient_receivables")).toMatchObject({
    debit: 0n,
    credit: 60_00n,
  });

  const financialEvents = await eventually(async () => {
    const entries = await api.audit.list({ orgSlug: organization.slug });

    const found = entries.items.filter(
      (entry) =>
        entry.target === `invoice:${detail.invoice.id}` ||
        detail.payments.some((payment) => entry.target === `payment:${payment.id}`),
    );

    return found.length === 3 ? found : undefined;
  });

  expect(financialEvents.map((entry) => entry.action).sort()).toEqual([
    "invoice.issue",
    "payment.record",
    "payment.record",
  ]);
});

test("leaving a walk-in unpaid needs a note, and so does a discount", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-credit-note");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `CREDIT-${uniqueSuffix()}`, "Credit Consultation", 100_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Credit",
    { consultFeeItemId: fee.id },
  );

  const walkIn = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  // SAFETY: omits `settlement` so server validation, not the client type, rejects it.
  await expectORPCCode(api.opd.createWalkIn(walkIn as never), "BAD_REQUEST");

  await expectORPCCode(
    api.opd.createWalkIn({
      ...walkIn,
      settlement: { expectedGrandTotal: 105_00n, payments: [] },
    }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    api.opd.createWalkIn({
      ...walkIn,
      settlement: {
        discountAmount: 10_00n,
        expectedGrandTotal: 94_50n,
        payments: [{ method: "cash", amount: 95_00n }],
      },
    }),
    "BAD_REQUEST",
  );

  const credited = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      expectedGrandTotal: 105_00n,
      payments: [],
      note: "Staff member, paying on Friday",
    },
  });

  expect(requireInvoice(credited).note).toBe("Staff member, paying on Friday");

  const invoices = await api.billing.listInvoices({
    orgSlug: organization.slug,
    appointmentId: credited.appointment.id,
  });

  const detail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: invoices[0]!.id,
  });

  expect(detail.payments).toHaveLength(0);
  expect(detail.balance.outstanding).toBe(105_00n);
});

test("a discounted walk-in persists its reason and settles the discounted total", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-discount");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `DISCOUNT-${uniqueSuffix()}`,
      "Discounted Consultation",
      100_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Discount",
    { consultFeeItemId: fee.id },
  );

  const note = "Approved staff discount";

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      discountAmount: 10_00n,
      expectedGrandTotal: 94_50n,
      note,
      payments: [{ method: "cash", amount: 94_50n }],
    },
  });

  expect(created.invoice).toMatchObject({
    discountAmount: 10_00n,
    grandTotal: 94_50n,
    note,
  });

  const detail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(created).id,
  });

  expect(detail.invoice).toMatchObject({
    discountAmount: 10_00n,
    grandTotal: 94_50n,
    note,
  });
  expect(detail.balance.outstanding).toBe(0n);
});

test("a walk-in that fails to settle leaves no token behind", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-settle-rollback",
  );

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `ROLL-${uniqueSuffix()}`, "Rollback Consultation", 100_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Rollback",
    { consultFeeItemId: fee.id },
  );

  await expectORPCCode(
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      settlement: {
        expectedGrandTotal: 105_00n,
        payments: [{ method: "cash", amount: 999_00n }],
      },
    }),
    "BAD_REQUEST",
  );

  expect(
    await db
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(
        and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.patientId, patient.id)),
      ),
  ).toHaveLength(0);
  expect(
    await db.select({ id: charges.id }).from(charges).where(eq(charges.orgId, organization.id)),
  ).toHaveLength(0);
  expect(
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.orgId, organization.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.orgId, organization.id)),
  ).toHaveLength(0);

  const valid = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      expectedGrandTotal: 105_00n,
      payments: [{ method: "cash", amount: 105_00n }],
    },
  });

  expect(valid.appointment.tokenNumber).toBe(1);
  expect(requireInvoice(valid).invoiceNumber.endsWith("/1")).toBe(true);
  expect(valid.payments).toHaveLength(1);
  expect(valid.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);
});

test("services chosen at the desk are charged in the same commit as the token", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-services");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `SVCFEE-${uniqueSuffix()}`,
      "Service Consultation",
      100_00n,
    ),
  );

  const dressing = await api.catalog.create({
    ...catalogItemInput(organization.slug, `DRESS-${uniqueSuffix()}`, "Dressing", 50_00n),
    category: "procedure" as const,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Services",
    { consultFeeItemId: fee.id },
  );

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    services: [{ catalogItemId: dressing.id, qty: 2 }],
  });

  expect(quote).toMatchObject({ subtotal: 200_00n, taxTotal: 10_00n, grandTotal: 210_00n });
  expect(quote.lines.map((line) => line.description)).toEqual(["Service Consultation", "Dressing"]);

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      services: [{ catalogItemId: dressing.id, qty: 2 }],
      expectedGrandTotal: 210_00n,
      payments: [{ method: "cash", amount: 210_00n }],
    },
  });

  expect(requireInvoice(created).grandTotal).toBe(210_00n);

  const detail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(detail.charges).toHaveLength(2);
  expect(detail.charges.map((charge) => charge.description).sort()).toEqual([
    "Dressing",
    "Service Consultation",
  ]);
});

test("a walk-in can omit the consultation fee while settling selected services", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-omit-fee");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `OMIT-FEE-${uniqueSuffix()}`,
      "Omitted Consultation",
      100_00n,
    ),
  );

  const service = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `OMIT-SVC-${uniqueSuffix()}`,
      "Omitted Fee Dressing",
      50_00n,
    ),
    category: "procedure" as const,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Omit Fee",
    { consultFeeItemId: fee.id },
  );

  const services = [{ catalogItemId: service.id, qty: 2 }];

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    services,
    omitConsultFee: true,
  });

  expect(quote).toMatchObject({ subtotal: 100_00n, taxTotal: 5_00n, grandTotal: 105_00n });
  expect(quote.lines).toEqual([
    expect.objectContaining({
      description: "Omitted Fee Dressing",
      unitPrice: 50_00n,
      qty: 2,
      source: "service",
    }),
  ]);

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      services,
      omitConsultFee: true,
      expectedGrandTotal: 105_00n,
      payments: [{ method: "cash", amount: 105_00n }],
    },
  });

  expect(created.invoice).toMatchObject({ subtotal: 100_00n, grandTotal: 105_00n });

  const appointment = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(appointment.charges).toHaveLength(1);
  expect(appointment.charges[0]).toMatchObject({
    catalogItemId: service.id,
    sourceType: "catalog",
  });

  const invoice = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(created).id,
  });

  expect(invoice.lines).toHaveLength(1);
  expect(invoice.lines[0]).toMatchObject({
    chargeId: appointment.charges[0]!.id,
    description: "Omitted Fee Dressing",
    qty: 2,
  });
});

test("a walk-in without billable services creates no financial document", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-omit-fee-empty",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Omit Fee Empty",
  );

  const walkIn = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  const quote = await api.opd.quoteWalkIn({ ...walkIn, omitConsultFee: true });
  expect(quote).toMatchObject({
    lines: [],
    subtotal: 0n,
    discountAmount: 0n,
    taxTotal: 0n,
    grandTotal: 0n,
  });

  const created = await api.opd.createWalkIn({
    ...walkIn,
    settlement: { ...unpaidSettlement(0n), omitConsultFee: true },
  });

  expect(created).toMatchObject({ invoice: null, payments: [] });
  expect(created.appointment.status).toBe("checked_in");
  await expectORPCCode(
    api.opd.createWalkIn({
      ...walkIn,
      settlement: {
        ...unpaidSettlement(0n),
        omitConsultFee: true,
        payments: [{ method: "cash", amount: 1_00n }],
      },
    }),
    "BAD_REQUEST",
  );
});

test("a walk-in reprices selected services after a stale quote", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-reprice");

  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `REPRICE-FEE-${uniqueSuffix()}`,
      "Reprice Consultation",
      100_00n,
    ),
  );

  const service = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `REPRICE-SVC-${uniqueSuffix()}`,
      "Repriced Dressing",
      50_00n,
    ),
    category: "procedure" as const,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Reprice",
    { consultFeeItemId: fee.id },
  );

  const services = [{ catalogItemId: service.id, qty: 2 }];

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    services,
  });

  expect(quote.grandTotal).toBe(210_00n);

  await api.catalog.update({
    orgSlug: organization.slug,
    itemId: service.id,
    name: service.name,
    code: service.code,
    category: service.category,
    unitPrice: 75_00n,
    customRate: false,
    taxRatePercent: service.taxRatePercent,
    taxCode: service.taxCode,
  });
  await expect(
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      settlement: {
        services,
        expectedGrandTotal: quote.grandTotal,
        payments: [{ method: "cash", amount: quote.grandTotal }],
      },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      services,
      expectedGrandTotal: 262_50n,
      payments: [{ method: "cash", amount: 262_50n }],
    },
  });

  expect(created.invoice).toMatchObject({ subtotal: 250_00n, grandTotal: 262_50n });

  const appointment = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  const serviceCharge = appointment.charges.find((charge) => charge.catalogItemId === service.id);
  expect(serviceCharge).toMatchObject({ unitPrice: 75_00n, qty: 2 });

  const invoice = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(created).id,
  });

  expect(invoice.lines.find((line) => line.chargeId === serviceCharge?.id)).toMatchObject({
    unitPrice: 75_00n,
    qty: 2,
  });
});

test("a discounted walk-in keeps fee-first quote ordering through settlement", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-charge-order",
    false,
  );

  const fee = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `ORDER-FEE-${uniqueSuffix()}`,
      "Zero-rated consultation",
      300_00n,
    ),
    taxRatePercent: "0",
    taxCode: undefined,
  });

  const fivePercent = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `ORDER-FIVE-${uniqueSuffix()}`,
      "Five-percent service",
      300_00n,
    ),
    category: "procedure" as const,
  });

  const smaller = await api.catalog.create({
    ...catalogItemInput(
      organization.slug,
      `ORDER-SMALL-${uniqueSuffix()}`,
      "Smaller zero-rated service",
      250_00n,
    ),
    category: "procedure" as const,
    taxRatePercent: "0",
    taxCode: undefined,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Charge Order",
    { consultFeeItemId: fee.id },
  );

  const services = [
    { catalogItemId: fivePercent.id, qty: 1 },
    { catalogItemId: smaller.id, qty: 1 },
  ];

  const quote = await api.opd.quoteWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    services,
    discountAmount: 2_00n,
  });

  expect(quote.grandTotal).toBe(862_96n);

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      services,
      discountAmount: 2_00n,
      expectedGrandTotal: quote.grandTotal,
      payments: [{ method: "cash", amount: quote.grandTotal }],
      note: "Package discount",
    },
  });

  expect(created.invoice?.grandTotal).toBe(862_96n);

  const invoice = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(created).id,
  });

  expect(invoice.lines.map((line) => line.description)).toEqual([
    fee.name,
    fivePercent.name,
    smaller.name,
  ]);
});

test("a walk-in can bill a selected consultation instead of the ladder fee", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-consult-service",
  );

  const ladderFee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `PRIMARY-${uniqueSuffix()}`,
      "Primary Consultation",
      100_00n,
    ),
  );

  const selectedConsultation = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `SELECTED-CONSULT-${uniqueSuffix()}`,
      "Selected Consultation",
      50_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Selected Consultation",
    { consultFeeItemId: ladderFee.id },
  );

  const walkIn = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  const services = [{ catalogItemId: selectedConsultation.id, qty: 1 }];

  const quote = await api.opd.quoteWalkIn({
    ...walkIn,
    services,
    omitConsultFee: true,
  });

  expect(quote.lines).toEqual([
    expect.objectContaining({
      chargeId: selectedConsultation.id,
      source: "service",
    }),
  ]);

  const created = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      services,
      omitConsultFee: true,
      expectedGrandTotal: 52_50n,
      payments: [],
      note: "Selected consultation remains unpaid",
    },
  });

  const detail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

  expect(detail.charges).toEqual([
    expect.objectContaining({
      catalogItemId: selectedConsultation.id,
      revenueCategory: "consultation",
      sourceType: "catalog",
    }),
  ]);
  expect(detail.charges.some((charge) => charge.sourceType === "consult_fee")).toBe(false);
});

test("booking rejects a consultation catalog item as a selected service", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-book-consult-service",
  );

  const consultation = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `BOOK-CONSULT-${uniqueSuffix()}`,
      "Booked Consultation",
      50_00n,
    ),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Booked Consultation",
  );

  await expectORPCCode(
    api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      scheduledLocal: "2030-03-15T14:00",
      services: [{ catalogItemId: consultation.id, qty: 1 }],
    }),
    "NOT_FOUND",
  );
});

test("walk-in quotes hide consultation items from another organization", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-consult-service-tenant",
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Consultation Tenant",
  );

  const otherOwner = await createTestUser("opd-consult-service-tenant-other");

  const otherOrganization = await createOrganization(
    otherOwner,
    "opd-consult-service-tenant-other",
  );

  const foreignConsultation = await clientFor(otherOwner).catalog.create(
    catalogItemInput(
      otherOrganization.slug,
      `FOREIGN-CONSULT-${uniqueSuffix()}`,
      "Foreign Consultation",
      50_00n,
    ),
  );

  await expectORPCCode(
    api.opd.quoteWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      services: [{ catalogItemId: foreignConsultation.id, qty: 1 }],
      omitConsultFee: true,
    }),
    "NOT_FOUND",
  );
});

test("an unknown service leaves no token behind", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-walk-in-unknown-service",
  );

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, `BADSVC-${uniqueSuffix()}`, "Bad Service Consult", 100_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Unknown Service",
    { consultFeeItemId: fee.id },
  );

  await expectORPCCode(
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      settlement: {
        services: [{ catalogItemId: Bun.randomUUIDv7(), qty: 1 }],
        expectedGrandTotal: 105_00n,
        payments: [],
        note: "Should never be written",
      },
    }),
    "NOT_FOUND",
  );

  const rows = await db
    .select({ id: opdAppointments.id })
    .from(opdAppointments)
    .where(
      and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.patientId, patient.id)),
    );

  expect(rows).toHaveLength(0);
});
