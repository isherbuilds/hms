import { beforeAll, expect, test } from "bun:test";

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
import { sumMoney } from "../support/unique";

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

function catalogItemInput(orgSlug: string, name: string, unitPrice = 150_00n) {
  return {
    orgSlug,
    name,
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
    ? await api.catalog.create(catalogItemInput(organization.slug, `${seed} Default Consultation`))
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

function expectBalanced(lines: Array<{ debit: bigint; credit: bigint }>) {
  expect(sumMoney(lines.map((line) => line.debit))).toBe(
    sumMoney(lines.map((line) => line.credit)),
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

test("walk-ins take per-practitioner tokens on the server day and are audited, unlike booking and check-in", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-basics");

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

  const settings = await api.settings.get({ orgSlug: organization.slug });

  const walkIn = (practitionerId: string) =>
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId,
      settlement: unpaidSettlement(),
    });

  const before = businessDate(new Date(), settings.timeZone);
  const first = await walkIn(firstPractitioner.id);
  const after = businessDate(new Date(), settings.timeZone);
  expect(first.appointment.status).toBe("checked_in");
  expect([before, after]).toContain(first.appointment.businessDate);

  const second = await walkIn(firstPractitioner.id);
  const other = await walkIn(secondPractitioner.id);

  expect(first.appointment.tokenNumber).toBe(1);
  expect(second.appointment.tokenNumber).toBe(2);
  expect(other.appointment.tokenNumber).toBe(1);

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    scheduledLocal: "2030-03-14T09:00",
  });

  await api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id });

  await drainAuditWrites();
  const audit = await api.audit.list({ orgSlug: organization.slug });

  expect(
    audit.items.find(
      (entry) =>
        entry.action === "opd.walk_in.create" && entry.target === `opd:${first.appointment.id}`,
    ),
  ).toMatchObject({ actorId: owner.user.id, orgId: organization.id });
  expect(
    audit.items.filter(
      (entry) =>
        (entry.action === "opd.book" || entry.action === "opd.check_in") &&
        entry.target === `opd:${booked.id}`,
    ),
  ).toEqual([]);
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

test("the consult fee ladder snapshots the practitioner fee, falls back to an active department fee, or bills nothing", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-fee-ladder",
    false,
  );

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, "Initial Consultation", 275_00n),
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

  const departmentFee = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Department Attendance Fee"),
    category: "lab" as const,
  });

  const feeDepartment = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Department Fee Department",
    defaultConsultFeeItemId: departmentFee.id,
  });

  const departmentPractitioner = await createPractitioner(
    api,
    organization.slug,
    feeDepartment.id,
    "Dr. Department Fee",
  );

  const departmentWalkIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: departmentPractitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(
    (await appointmentCharges(api, organization.slug, departmentWalkIn.appointment.id))[0],
  ).toMatchObject({
    catalogItemId: departmentFee.id,
    description: "Department Attendance Fee",
    revenueCategory: "lab",
    sourceType: "consult_fee",
  });

  const inactive = await api.catalog.create(
    catalogItemInput(organization.slug, "Inactive Consultation"),
  );

  await api.catalog.setActive({ orgSlug: organization.slug, itemId: inactive.id, active: false });

  const inactivePractitioner = await createPractitioner(
    api,
    organization.slug,
    feeDepartment.id,
    "Dr. Inactive Fee",
    { consultFeeItemId: inactive.id },
  );

  const inactiveWalkIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: inactivePractitioner.id,
    settlement: unpaidSettlement(),
  });

  expect(
    (await appointmentCharges(api, organization.slug, inactiveWalkIn.appointment.id))[0]
      ?.catalogItemId,
  ).toBe(departmentFee.id);

  const unpricedPractitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. No Fee",
  );

  const unpriced = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: unpricedPractitioner.id,
  };

  expect(await api.opd.quoteWalkIn(unpriced)).toMatchObject({
    lines: [],
    subtotal: 0n,
    grandTotal: 0n,
  });
  expect(
    await api.opd.createWalkIn({ ...unpriced, settlement: unpaidSettlement(0n) }),
  ).toMatchObject({ invoice: null, payments: [] });
});

test("follow-up fees skip cancelled visits and honor a practitioner window override", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-follow-up");

  const consultFee = await api.catalog.create(
    catalogItemInput(organization.slug, "New Consultation", 300_00n),
  );

  const followUpFee = await api.catalog.create(
    catalogItemInput(organization.slug, "Follow-up Consultation", 100_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Follow Up",
    { consultFeeItemId: consultFee.id, followUpFeeItemId: followUpFee.id },
  );

  const walkIn = (patientId: string, practitionerId: string, expectedGrandTotal: bigint) =>
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId,
      practitionerId,
      settlement: unpaidSettlement(expectedGrandTotal),
    });

  const feeOf = async (appointmentId: string) =>
    (await appointmentCharges(api, organization.slug, appointmentId))[0]?.catalogItemId;

  const cancelled = await walkIn(patient.id, practitioner.id, 315_00n);
  expect(await feeOf(cancelled.appointment.id)).toBe(consultFee.id);

  await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: cancelled.appointment.id,
    reason: "Patient left",
  });

  const first = await walkIn(patient.id, practitioner.id, 315_00n);
  expect(await feeOf(first.appointment.id)).toBe(consultFee.id);

  const second = await walkIn(patient.id, practitioner.id, 105_00n);
  expect(await feeOf(second.appointment.id)).toBe(followUpFee.id);

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

  const prior = await walkIn(overridePatient.id, overridePractitioner.id, 315_00n);

  await db
    .update(opdAppointments)
    .set({ arrivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
    .where(
      and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, prior.appointment.id)),
    );

  const outsideOverride = await walkIn(overridePatient.id, overridePractitioner.id, 315_00n);
  expect(await feeOf(outsideOverride.appointment.id)).toBe(consultFee.id);
});

test("cancellation needs a reason, keeps an issued invoice, voids a pending consult charge, and happens once", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup("opd-cancel");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, "Consultation", 400_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Cancel",
    { consultFeeItemId: fee.id },
  );

  const walkIn = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: unpaidSettlement(420_00n),
  });

  const issued = requireInvoice(walkIn);

  await expectORPCCode(
    api.opd.markNoShow({
      orgSlug: organization.slug,
      appointmentId: walkIn.appointment.id,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: walkIn.appointment.id,
      reason: "",
    }),
    "BAD_REQUEST",
  );

  const cancelledWalkIn = await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: walkIn.appointment.id,
    reason: "Patient left",
  });

  expect(cancelledWalkIn.status).toBe("cancelled");
  expect(
    (
      await api.billing.listInvoices({
        orgSlug: organization.slug,
        appointmentId: walkIn.appointment.id,
      })
    ).map((invoice) => invoice.id),
  ).toContain(issued.id);
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: walkIn.appointment.id,
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

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-20T09:00",
  });

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(checkedIn.charge?.status).toBe("pending");

  const reason = "Patient requested cancellation";

  const cancelled = await api.opd.cancel({
    orgSlug: organization.slug,
    appointmentId: booked.id,
    reason,
  });

  expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: reason });
  expect(cancelled.cancelledAt).toBeInstanceOf(Date);

  const readBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({ status: "voided", voidReason: reason });
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

test("walk-ins reject patient, practitioner and consultation ids from another organization", async () => {
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

  const betaConsultation = await betaApi.catalog.create(
    catalogItemInput(beta.slug, "Foreign Consultation", 50_00n),
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
  await expectORPCCode(
    alphaApi.opd.quoteWalkIn({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: alphaPractitioner.id,
      services: [{ catalogItemId: betaConsultation.id, qty: 1 }],
      omitConsultFee: true,
    }),
    "NOT_FOUND",
  );
});

test("a booking checks in as the same queued appointment, with or without a linked patient", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-book-check-in");

  const fee = await api.catalog.create(catalogItemInput(organization.slug, "Booked Consultation"));

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

  for (const q of ["daughter", "9876500011"]) {
    expect(
      (
        await api.opd.day({
          orgSlug: organization.slug,
          from: booked.businessDate,
          to: booked.businessDate,
          q,
        })
      ).items.map((appointment) => appointment.id),
    ).toContain(booked.id);
  }

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
    from: checkedIn.appointment.businessDate,
    to: checkedIn.appointment.businessDate,
  });

  expect(queue.items.map((appointment) => appointment.id)).toContain(booked.id);

  const linked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T11:00",
  });

  expect(linked).toMatchObject({ status: "booked", patientId: patient.id, tokenNumber: null });

  const linkedCheckIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: linked.id,
  });

  expect(linkedCheckIn.appointment).toMatchObject({
    id: linked.id,
    status: "checked_in",
    patientId: patient.id,
    tokenNumber: 2,
  });
  expect(linkedCheckIn.charge).toMatchObject({
    catalogItemId: fee.id,
    sourceType: "consult_fee",
    status: "pending",
  });
});

test("custom procedure rates need the catalog flag and flow through booking, quotes and stored charges", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-custom-procedure-rate",
    false,
  );

  const procedure = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Custom-rate procedure", 30_00n),
    category: "procedure" as const,
    customRate: true,
  });

  const fixed = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Fixed-rate procedure"),
    category: "procedure" as const,
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

  const lower = await api.opd.quoteWalkIn({
    ...base,
    services: [{ catalogItemId: procedure.id, qty: 1, unitPrice: 29_99n }],
  });

  expect(lower.lines[0]?.unitPrice).toBe(29_99n);

  const services = [{ catalogItemId: procedure.id, qty: 2, unitPrice: 40_00n }];
  const quote = await api.opd.quoteWalkIn({ ...base, services });

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
        query: procedure.name,
        includeConsultation: false,
      })
    )[0],
  ).toMatchObject({ id: procedure.id, unitPrice: 30_00n, customRate: true });
});

test("a booking refuses services it may not carry and keeps valid ones off the worklist until check-in", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-scheduled-services");

  const labPanel = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Lipid panel", 400_00n),
    category: "lab" as const,
  });

  const consultation = await api.catalog.create(
    catalogItemInput(organization.slug, "Booked Consultation", 50_00n),
  );

  const service = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Booked dressing", 350_00n),
    category: "procedure" as const,
  });

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Scheduled Services",
  );

  for (const catalogItemId of [Bun.randomUUIDv7(), labPanel.id, consultation.id]) {
    await expectORPCCode(
      api.opd.book({
        orgSlug: organization.slug,
        patientId: patient.id,
        practitionerId: practitioner.id,
        scheduledLocal: "2030-03-15T12:15",
        services: [{ catalogItemId, qty: 1 }],
      }),
      "NOT_FOUND",
    );
  }

  expect(
    (await api.opd.day({ orgSlug: organization.slug, from: "2030-03-15", to: "2030-03-15" })).items,
  ).toEqual([]);

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

  const beforeCheckIn = await api.billing.worklist({ orgSlug: organization.slug });
  expect(beforeCheckIn.unbilled.map((row) => row.appointmentId)).not.toContain(booked.id);
  expect(beforeCheckIn.summary.toBillTotal).toBe(0n);

  await api.opd.checkIn({ orgSlug: organization.slug, appointmentId: booked.id });

  const afterCheckIn = await api.billing.worklist({ orgSlug: organization.slug });
  expect(afterCheckIn.unbilled.map((row) => row.appointmentId)).not.toContain(booked.id);
  expect(afterCheckIn.summary.toBillTotal).toBe(0n);
});

test("day interleaves visits, searches patient keys, returns balances, and closes past bookings", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-day");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, "Day Consultation", 200_00n),
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

  const day = await api.opd.day({ orgSlug: organization.slug, from: currentDay, to: currentDay });
  expect(day.items.map((row) => row.id)).toEqual([arrived.appointment.id, scheduledId]);
  expect(day.items.find((row) => row.id === arrived.appointment.id)?.balanceDue).toBe(210_00n);

  for (const q of [bookedPatient.name.toLowerCase(), bookedPatient.mrn, bookedPatient.phone]) {
    expect(
      (await api.opd.day({ orgSlug: organization.slug, from: currentDay, to: currentDay, q }))
        .items,
    ).toHaveLength(1);
  }

  for (const q of ["%", "_"]) {
    expect(
      (await api.opd.day({ orgSlug: organization.slug, from: currentDay, to: currentDay, q }))
        .items,
    ).toHaveLength(0);
  }

  expect(
    (
      await api.opd.day({
        orgSlug: organization.slug,
        from: currentDay,
        to: currentDay,
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
        from: currentDay,
        to: currentDay,
        q: "654",
        includeClosed: true,
      })
    ).items.map((row) => row.id),
  ).toEqual([callerOnlyId]);

  const yesterday = new Date(`${currentDay}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const pastDay = yesterday.toISOString().slice(0, 10);

  const plannedService = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Past booked service"),
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

  expect(
    (await api.opd.day({ orgSlug: organization.slug, from: pastDay, to: pastDay })).items,
  ).toEqual([]);

  const past = await api.opd.day({
    orgSlug: organization.slug,
    from: pastDay,
    to: pastDay,
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

test("concurrent check-in mints one token and one consultation charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-check-in-race");

  const fee = await api.catalog.create(catalogItemInput(organization.slug, "Race Consultation"));

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

test("bookings need a future minute, can be rescheduled, and a no-show voids pending charges with an audit", async () => {
  const { owner, organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-reschedule-no-show");

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Reschedule",
  );

  const settings = await api.settings.get({ orgSlug: organization.slug });
  const currentMinute = localMinute(new Date(), settings.timeZone);

  const input = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  await expectORPCCode(api.opd.book({ ...input, scheduledLocal: currentMinute }), "BAD_REQUEST");
  expect(
    (await api.opd.book({ ...input, scheduledLocal: shiftLocalMinute(currentMinute, 5) })).status,
  ).toBe("booked");

  const booked = await api.opd.book({ ...input, scheduledLocal: "2030-04-01T10:30" });

  const item = await api.catalog.create(
    catalogItemInput(organization.slug, "Advance Consultation"),
  );

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

  await expectORPCCode(
    api.opd.reschedule({
      orgSlug: organization.slug,
      appointmentId: booked.id,
      scheduledLocal: currentMinute,
    }),
    "BAD_REQUEST",
  );

  const rescheduled = await api.opd.reschedule({
    orgSlug: organization.slug,
    appointmentId: booked.id,
    scheduledLocal: "2030-04-03T10:30",
  });

  expect(rescheduled.businessDate).not.toBe(booked.businessDate);
  expect(
    (
      await api.opd.day({
        orgSlug: organization.slug,
        from: rescheduled.businessDate,
        to: rescheduled.businessDate,
      })
    ).items.map((appointment) => appointment.id),
  ).toEqual([booked.id]);

  const noShow = await api.opd.markNoShow({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(noShow).toMatchObject({ status: "no_show", tokenNumber: null, arrivedAt: null });
  expect(noShow.noShowAt).toBeInstanceOf(Date);
  expect(
    await db
      .select({ status: charges.status })
      .from(charges)
      .where(and(eq(charges.orgId, organization.id), eq(charges.opdAppointmentId, booked.id))),
  ).toEqual([{ status: "voided" }]);

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
    catalogItemInput(organization.slug, "Settled Consultation", 200_00n),
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

test("a walk-in that fails settlement writes nothing, and unpaid or discounted walk-ins need a note", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-settlement");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, "Settlement Consultation", 100_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Settlement",
    { consultFeeItemId: fee.id },
  );

  const walkIn = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  // SAFETY: omits `settlement` so server validation, not the client type, rejects it.
  await expectORPCCode(api.opd.createWalkIn(walkIn as never), "BAD_REQUEST");

  for (const settlement of [
    { expectedGrandTotal: 105_00n, payments: [] },
    {
      discountAmount: 10_00n,
      expectedGrandTotal: 94_50n,
      payments: [{ method: "cash" as const, amount: 95_00n }],
    },
    { expectedGrandTotal: 105_00n, payments: [{ method: "cash" as const, amount: 999_00n }] },
  ]) {
    await expectORPCCode(api.opd.createWalkIn({ ...walkIn, settlement }), "BAD_REQUEST");
  }

  await expectORPCCode(
    api.opd.createWalkIn({
      ...walkIn,
      settlement: {
        services: [{ catalogItemId: Bun.randomUUIDv7(), qty: 1 }],
        expectedGrandTotal: 105_00n,
        payments: [],
        note: "Should never be written",
      },
    }),
    "NOT_FOUND",
  );

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
  expect(
    await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.orgId, organization.id)),
  ).toHaveLength(0);

  const paid = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      expectedGrandTotal: 105_00n,
      payments: [{ method: "cash", amount: 105_00n }],
    },
  });

  expect(paid.appointment.tokenNumber).toBe(1);
  expect(requireInvoice(paid).invoiceNumber.endsWith("/1")).toBe(true);
  expect(paid.payments).toHaveLength(1);
  expect(paid.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);

  const credited = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      expectedGrandTotal: 105_00n,
      payments: [],
      note: "Staff member, paying on Friday",
    },
  });

  const creditedDetail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(credited).id,
  });

  expect(creditedDetail.invoice.note).toBe("Staff member, paying on Friday");
  expect(creditedDetail.payments).toHaveLength(0);
  expect(creditedDetail.balance.outstanding).toBe(105_00n);

  const note = "Approved staff discount";

  const discounted = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      discountAmount: 10_00n,
      expectedGrandTotal: 94_50n,
      note,
      payments: [{ method: "cash", amount: 94_50n }],
    },
  });

  const discountedDetail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(discounted).id,
  });

  expect(discountedDetail.invoice).toMatchObject({
    discountAmount: 10_00n,
    grandTotal: 94_50n,
    note,
  });
  expect(discountedDetail.balance.outstanding).toBe(0n);
});

test("desk services are quoted and charged with the token, can replace the consultation fee, and reprice a stale quote", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-walk-in-services");

  const fee = await api.catalog.create(
    catalogItemInput(organization.slug, "Service Consultation", 100_00n),
  );

  const dressing = await api.catalog.create({
    ...catalogItemInput(organization.slug, "Dressing", 50_00n),
    category: "procedure" as const,
  });

  const selectedConsultation = await api.catalog.create(
    catalogItemInput(organization.slug, "Selected Consultation", 50_00n),
  );

  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Services",
    { consultFeeItemId: fee.id },
  );

  const walkIn = {
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
  };

  const services = [{ catalogItemId: dressing.id, qty: 2 }];

  const quote = await api.opd.quoteWalkIn({ ...walkIn, services });

  expect(quote).toMatchObject({ subtotal: 200_00n, taxTotal: 10_00n, grandTotal: 210_00n });
  expect(quote.lines.map((line) => line.description)).toEqual(["Service Consultation", "Dressing"]);

  const withFee = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      services,
      expectedGrandTotal: 210_00n,
      payments: [{ method: "cash", amount: 210_00n }],
    },
  });

  expect(requireInvoice(withFee).grandTotal).toBe(210_00n);
  expect(
    (await appointmentCharges(api, organization.slug, withFee.appointment.id))
      .map((charge) => charge.description)
      .sort(),
  ).toEqual(["Dressing", "Service Consultation"]);

  const omittedQuote = await api.opd.quoteWalkIn({ ...walkIn, services, omitConsultFee: true });

  expect(omittedQuote).toMatchObject({ subtotal: 100_00n, taxTotal: 5_00n, grandTotal: 105_00n });
  expect(omittedQuote.lines).toEqual([
    expect.objectContaining({
      description: "Dressing",
      unitPrice: 50_00n,
      qty: 2,
      source: "service",
    }),
  ]);

  const omitted = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      services,
      omitConsultFee: true,
      expectedGrandTotal: 105_00n,
      payments: [{ method: "cash", amount: 105_00n }],
    },
  });

  expect(omitted.invoice).toMatchObject({ subtotal: 100_00n, grandTotal: 105_00n });

  const omittedCharges = await appointmentCharges(api, organization.slug, omitted.appointment.id);

  expect(omittedCharges).toEqual([
    expect.objectContaining({ catalogItemId: dressing.id, sourceType: "catalog" }),
  ]);

  const omittedInvoice = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(omitted).id,
  });

  expect(omittedInvoice.lines).toEqual([
    expect.objectContaining({ chargeId: omittedCharges[0]!.id, description: "Dressing", qty: 2 }),
  ]);

  const consultationServices = [{ catalogItemId: selectedConsultation.id, qty: 1 }];

  expect(
    (await api.opd.quoteWalkIn({ ...walkIn, services: consultationServices, omitConsultFee: true }))
      .lines,
  ).toEqual([expect.objectContaining({ chargeId: selectedConsultation.id, source: "service" })]);

  const selected = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      services: consultationServices,
      omitConsultFee: true,
      expectedGrandTotal: 52_50n,
      payments: [],
      note: "Selected consultation remains unpaid",
    },
  });

  expect(await appointmentCharges(api, organization.slug, selected.appointment.id)).toEqual([
    expect.objectContaining({
      catalogItemId: selectedConsultation.id,
      revenueCategory: "consultation",
      sourceType: "catalog",
    }),
  ]);

  expect(await api.opd.quoteWalkIn({ ...walkIn, omitConsultFee: true })).toMatchObject({
    lines: [],
    subtotal: 0n,
    discountAmount: 0n,
    taxTotal: 0n,
    grandTotal: 0n,
  });
  expect(
    await api.opd.createWalkIn({
      ...walkIn,
      settlement: { ...unpaidSettlement(0n), omitConsultFee: true },
    }),
  ).toMatchObject({ invoice: null, payments: [] });
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

  await api.catalog.update({
    orgSlug: organization.slug,
    itemId: dressing.id,
    name: dressing.name,
    category: dressing.category,
    unitPrice: 75_00n,
    customRate: false,
    taxRatePercent: dressing.taxRatePercent,
    taxCode: dressing.taxCode,
  });
  await expectORPCCode(
    api.opd.createWalkIn({
      ...walkIn,
      settlement: {
        services,
        expectedGrandTotal: quote.grandTotal,
        payments: [{ method: "cash", amount: quote.grandTotal }],
      },
    }),
    "CONFLICT",
  );

  const repriced = await api.opd.createWalkIn({
    ...walkIn,
    settlement: {
      services,
      expectedGrandTotal: 262_50n,
      payments: [{ method: "cash", amount: 262_50n }],
    },
  });

  expect(repriced.invoice).toMatchObject({ subtotal: 250_00n, grandTotal: 262_50n });

  const repricedCharge = (
    await appointmentCharges(api, organization.slug, repriced.appointment.id)
  ).find((charge) => charge.catalogItemId === dressing.id);

  expect(repricedCharge).toMatchObject({ unitPrice: 75_00n, qty: 2 });

  const repricedInvoice = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: requireInvoice(repriced).id,
  });

  expect(repricedInvoice.lines.find((line) => line.chargeId === repricedCharge?.id)).toMatchObject({
    unitPrice: 75_00n,
    qty: 2,
  });
});
