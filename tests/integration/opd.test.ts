import { beforeAll, expect, test } from "bun:test";
import pg from "pg";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
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

async function createOpdAppointmentSetup(seed: string) {
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
    departmentId: department.id,
  });
  const second = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: firstPractitioner.id,
    departmentId: department.id,
  });
  const other = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: secondPractitioner.id,
    departmentId: department.id,
  });

  expect(first.appointment.tokenNumber).toBe(1);
  expect(second.appointment.tokenNumber).toBe(2);
  expect(other.appointment.tokenNumber).toBe(1);
});

test("a practitioner consult fee creates an immutable snapshot charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-consult-fee");
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

  const created = await api.opd.createWalkIn({
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
  const readBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });
  expect(readBack.charges).toHaveLength(1);
  expect(readBack.charges[0]).toMatchObject({
    description: "Initial Consultation",
    unitPrice: "275.00",
    taxRatePercent: "5.00",
  });
});

test("a procedure walk-in creates the configured consultation charge", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-procedure-walk-in-fee",
  );
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `PROC-${crypto.randomUUID().slice(0, 8)}`,
      "Procedure Visit",
      "325.00",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Procedure Walk-in",
    { consultFeeItemId: fee.id },
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
    kind: "procedure",
  });

  expect(created.appointment.kind).toBe("procedure");
  expect(created.charge).toMatchObject({
    catalogItemId: fee.id,
    sourceType: "consult_fee",
    status: "pending",
  });
});

test("the department default fee is used when the practitioner has no consult fee", async () => {
  const { organization, api, patient } = await createOpdAppointmentSetup("opd-department-fee");
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

  const created = await api.opd.createWalkIn({
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
  const { organization, api, patient, department } = await createOpdAppointmentSetup("opd-no-fee");
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. No Fee",
  );

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge).toBeNull();

  const readBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });
  expect(readBack.charges).toEqual([]);
});

async function completeOpdAppointment(
  api: AppRouterClient,
  orgSlug: string,
  appointmentId: string,
) {
  await api.opd.startConsultation({ orgSlug, appointmentId });
  await api.opd.complete({ orgSlug, appointmentId });
}

test("follow-up pricing needs completed prior care, so a duplicate registration pays full price", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-follow-up-open");
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
      "Free Follow-up Consultation",
      "0.00",
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
    departmentId: department.id,
  });
  // The desk registers the same patient twice by mistake; the first is still
  // in the queue, so nothing has been consulted and nothing is a follow-up.
  const duplicate = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });

  expect(first.charge?.catalogItemId).toBe(consultFee.id);
  expect(duplicate.charge?.catalogItemId).toBe(consultFee.id);

  await completeOpdAppointment(api, organization.slug, first.appointment.id);
  const afterConsult = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(afterConsult.charge).toMatchObject({ catalogItemId: followUpFee.id, unitPrice: "0.00" });
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

  const first = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  await completeOpdAppointment(api, organization.slug, first.appointment.id);
  const second = await api.opd.createWalkIn({
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
  const prior = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    departmentId: department.id,
  });
  await completeOpdAppointment(api, organization.slug, prior.appointment.id);
  await db
    .update(opdAppointments)
    .set({ completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
    .where(
      and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, prior.appointment.id)),
    );

  const outsideOverride = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: overridePatient.id,
    practitionerId: overridePractitioner.id,
    departmentId: department.id,
  });
  expect(outsideOverride.charge?.catalogItemId).toBe(consultFee.id);
});

test("an inactive practitioner fee falls through to the active department fee", async () => {
  const { organization, api, patient } = await createOpdAppointmentSetup("opd-inactive-fee");
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

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  expect(created.charge?.catalogItemId).toBe(fallback.id);
});

test("OPD appointment commands enforce the state machine and required cancel reason", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-transitions");
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Transitions",
  );
  const createOpdAppointment = () =>
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
    });

  const lifecycle = await createOpdAppointment();
  const inConsult = await api.opd.startConsultation({
    orgSlug: organization.slug,
    appointmentId: lifecycle.appointment.id,
  });
  expect(inConsult.status).toBe("in_consult");
  expect(inConsult.consultationStartedAt).toBeInstanceOf(Date);
  const completed = await api.opd.complete({
    orgSlug: organization.slug,
    appointmentId: lifecycle.appointment.id,
  });
  expect(completed.status).toBe("completed");
  expect(completed.completedAt).toBeInstanceOf(Date);
  await expectORPCCode(
    api.opd.startConsultation({
      orgSlug: organization.slug,
      appointmentId: lifecycle.appointment.id,
    }),
    "CONFLICT",
  );

  const waiting = await createOpdAppointment();
  await expectORPCCode(
    api.opd.complete({
      orgSlug: organization.slug,
      appointmentId: waiting.appointment.id,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: waiting.appointment.id,
      reason: "",
    }),
    "BAD_REQUEST",
  );

  const cannotCancel = await createOpdAppointment();
  await api.opd.startConsultation({
    orgSlug: organization.slug,
    appointmentId: cannotCancel.appointment.id,
  });
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: cannotCancel.appointment.id,
      reason: "Patient left",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.opd.cancel({
      orgSlug: organization.slug,
      appointmentId: crypto.randomUUID(),
      reason: "Patient left",
    }),
    "NOT_FOUND",
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
    departmentId: department.id,
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
  // The prescription hangs directly off this OPD appointment.
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
    departmentId: department.id,
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

test("cancelling a waiting OPD appointment voids its pending consult charge", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup("opd-cancel");
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
  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
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

test("OPD appointment creation rejects a practitioner paired with another same-org department", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-department-match");
  const otherDepartment = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Another department",
  });
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Department Match",
  );

  await expectORPCCode(
    api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: otherDepartment.id,
    }),
    "NOT_FOUND",
  );
});

test("OPD appointment creation rejects patient, practitioner, and department ids from another organization", async () => {
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
      departmentId: alphaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaApi.opd.createWalkIn({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: betaPractitioner.id,
      departmentId: alphaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaApi.opd.createWalkIn({
      orgSlug: alpha.slug,
      patientId: alphaPatient.id,
      practitionerId: alphaPractitioner.id,
      departmentId: betaDepartment.id,
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
    departmentId: department.id,
  });
  await api.opd.startConsultation({
    orgSlug: organization.slug,
    appointmentId: walkIn.appointment.id,
  });
  await api.opd.complete({
    orgSlug: organization.slug,
    appointmentId: walkIn.appointment.id,
  });

  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
    scheduledLocal: "2030-03-14T09:00",
  });
  await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });
  await api.opd.startConsultation({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });
  await api.opd.complete({ orgSlug: organization.slug, appointmentId: booked.id });

  await drainAuditWrites();
  const audit = await api.audit.list({ orgSlug: organization.slug });
  const walkInEntry = audit.items.find(
    (entry) =>
      entry.action === "opd.walk_in.create" && entry.target === `opd:${walkIn.appointment.id}`,
  );
  const bookingEntry = audit.items.find(
    (entry) => entry.action === "opd.book" && entry.target === `opd:${booked.id}`,
  );
  expect(walkInEntry).toMatchObject({ actorId: owner.user.id, orgId: organization.id });
  expect(bookingEntry).toMatchObject({ actorId: owner.user.id, orgId: organization.id });

  const routineActions = new Set(["opd.check_in", "opd.consultation.start", "opd.complete"]);
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
    catalogItemInput(
      organization.slug,
      `CONS-${crypto.randomUUID().slice(0, 8)}`,
      "Consultation",
      "400.00",
    ),
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
    departmentId: department.id,
  });
  const issued = await api.billing.issueInvoice({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });

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
  expect(invoices.map((invoice) => invoice.id)).toContain(issued.invoice.id);
});

test("a caller-only booking becomes the same queued appointment at check-in", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-book-check-in");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `BOOK-${crypto.randomUUID().slice(0, 8)}`,
      "Booked Consultation",
    ),
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
    departmentId: department.id,
    kind: "consultation",
    scheduledLocal: "2030-03-15T10:30",
  });

  expect(booked).toMatchObject({
    arrivalMode: "scheduled",
    kind: "consultation",
    status: "booked",
    patientId: null,
    tokenNumber: null,
  });
  // The booked row already has a detail view: no patient or token yet, but
  // the caller details carried on the appointment itself.
  const bookedDetail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });
  expect(bookedDetail.patient).toBeNull();
  expect(bookedDetail.appointment).toMatchObject({
    status: "booked",
    tokenNumber: null,
    callerName: "Patient's daughter",
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
    status: "waiting",
    patientId: patient.id,
    tokenNumber: 1,
  });
  expect(checkedIn.charge?.catalogItemId).toBe(fee.id);

  const queue = await api.opd.queue({
    orgSlug: organization.slug,
    date: checkedIn.appointment.businessDate,
  });
  expect(queue.items.map((appointment) => appointment.id)).toContain(booked.id);
});

test("a booking linked to a patient checks in without re-selecting them", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-book-linked");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `LINK-${crypto.randomUUID().slice(0, 8)}`,
      "Linked Consultation",
    ),
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
    departmentId: department.id,
    kind: "consultation",
    scheduledLocal: "2030-03-15T11:00",
  });
  expect(booked).toMatchObject({ status: "booked", patientId: patient.id, tokenNumber: null });

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });
  expect(checkedIn.appointment).toMatchObject({
    id: booked.id,
    status: "waiting",
    patientId: patient.id,
    tokenNumber: 1,
  });
  expect(checkedIn.charge?.catalogItemId).toBe(fee.id);
});

test("a scheduled procedure creates the configured consultation charge at check-in", async () => {
  const { organization, api, patient, department } = await createOpdAppointmentSetup(
    "opd-procedure-check-in-fee",
  );
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `PROC-BOOK-${crypto.randomUUID().slice(0, 8)}`,
      "Scheduled Procedure Visit",
      "475.00",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Procedure Booking",
    { consultFeeItemId: fee.id },
  );
  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
    kind: "procedure",
    scheduledLocal: "2030-03-15T12:00",
  });

  const checkedIn = await api.opd.checkIn({
    orgSlug: organization.slug,
    appointmentId: booked.id,
  });

  expect(checkedIn.appointment).toMatchObject({ id: booked.id, kind: "procedure" });
  expect(checkedIn.charge).toMatchObject({
    catalogItemId: fee.id,
    sourceType: "consult_fee",
    status: "pending",
  });
});

test("queue keyset pagination traverses active arrivals once without caller-owned statuses", async () => {
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
    departmentId: department.id,
  });
  const createdIds = [first.appointment.id];
  const arrivedAt = first.appointment.arrivedAt!;
  const extraRows = Array.from({ length: 204 }, (_, index) => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    const createdAt = new Date(arrivedAt.getTime() + index + 1);
    return {
      id,
      orgId: organization.id,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
      arrivalMode: "walk_in" as const,
      kind: "consultation" as const,
      status: "waiting" as const,
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
  let cursor: { arrivedAt: Date; id: string } | undefined;
  do {
    const page = await api.opd.queue({
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

test("appointment keyset pagination uses id to traverse equal scheduled times once", async () => {
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
    departmentId: department.id,
    scheduledLocal: "2030-03-18T10:00",
  });
  const bookedIds = [first.id];
  const extraRows = Array.from({ length: 204 }, () => {
    const id = crypto.randomUUID();
    bookedIds.push(id);
    return {
      id,
      orgId: organization.id,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
      arrivalMode: "scheduled" as const,
      kind: "consultation" as const,
      status: "booked" as const,
      businessDate: first.businessDate,
      scheduledFor: first.scheduledFor,
      createdBy: owner.user.id,
    };
  });
  await db.insert(opdAppointments).values(extraRows);

  const seenIds: string[] = [];
  let cursor: { scheduledFor: Date; id: string } | undefined;
  do {
    const page = await api.opd.appointments({
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

test("concurrent check-in mints one token and one consultation charge", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-check-in-race");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `RACE-${crypto.randomUUID().slice(0, 8)}`,
      "Race Consultation",
    ),
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
    departmentId: department.id,
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
    departmentId: department.id,
    scheduledLocal: "2030-04-01T10:30",
  });
  const rescheduled = await api.opd.reschedule({
    orgSlug: organization.slug,
    appointmentId: booked.id,
    scheduledLocal: "2030-04-03T10:30",
  });
  expect(rescheduled.businessDate).not.toBe(booked.businessDate);

  const listed = await api.opd.appointments({
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
    catalogItemInput(
      organization.slug,
      `NOSHOW-${crypto.randomUUID().slice(0, 8)}`,
      "Advance Consultation",
    ),
  );
  const booked = await api.opd.book({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
    scheduledLocal: "2030-05-01T09:00",
  });
  // The API no longer accepts charges before check-in, so plant a pending
  // charge directly: the no-show write-off must clear money however it landed.
  await db.insert(charges).values({
    id: crypto.randomUUID(),
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

test("marking a waiting patient left unseen closes queue work and voids pending charges", async () => {
  const { organization, api, patient, department } =
    await createOpdAppointmentSetup("opd-left-unseen");
  const fee = await api.catalog.create(
    catalogItemInput(
      organization.slug,
      `LEFT-${crypto.randomUUID().slice(0, 8)}`,
      "Waiting Consultation",
    ),
  );
  const practitioner = await createPractitioner(
    api,
    organization.slug,
    department.id,
    "Dr. Left Unseen",
    { consultFeeItemId: fee.id },
  );
  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });

  const left = await api.opd.markLeftUnseen({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
    reason: "Patient left before consultation",
  });
  expect(left.status).toBe("left_unseen");
  expect(left.leftUnseenAt).toBeInstanceOf(Date);
  const detail = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });
  expect(detail.charges).toEqual([
    expect.objectContaining({ status: "voided", voidReason: "Patient left before consultation" }),
  ]);

  const entry = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    return audit.items.find(
      (auditEntry) =>
        auditEntry.action === "opd.left_unseen" &&
        auditEntry.target === `opd:${created.appointment.id}`,
    );
  });
  expect(entry.meta).toMatchObject({ voidedCharges: 1 });
});
