import { beforeAll, expect, test } from "bun:test";
import pg from "pg";

import { localMinute } from "@hms/api/lib/business-date";
import { db } from "@hms/db";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { shiftLocalMinute } from "../support/time";
import { uniqueSuffix } from "../support/unique";

beforeAll(resetTestDatabase);

async function fixture(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);

  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5557788",
    sex: "other",
    dateOfBirth: "1990-01-01",
    dobEstimated: false,
    address: "",
  });

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
  });

  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    departmentId: department.id,
    name: `Dr. ${seed}`,
  });

  const service = await api.catalog.create({
    orgSlug: organization.slug,
    name: `${seed} Course item`,
    code: `COURSE-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 50_00n,
    taxRatePercent: "0",
  });

  return { owner, organization, api, patient, practitioner, service };
}

type TreatmentFixture = Awaited<ReturnType<typeof fixture>>;

// `listForPatient` is the only plan read, so every detail assertion goes through it.
async function planDetail(setup: TreatmentFixture, planId: string) {
  const plans = await setup.api.treatment.listForPatient({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
  });

  const plan = plans.find((row) => row.id === planId);

  if (!plan) throw new Error(`Plan ${planId} is missing from the patient's plans`);

  return plan;
}

async function createCheckedInSitting(
  setup: TreatmentFixture,
  planId: string,
  minuteOffset: number,
  /** Services billed at intake, the way a desk charges work without the plan. */
  services?: { catalogItemId: string; qty: number }[],
) {
  const settings = await setup.api.settings.get({ orgSlug: setup.organization.slug });

  const booked = await setup.api.opd.book({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    treatmentPlanId: planId,
    services,
    scheduledLocal: shiftLocalMinute(localMinute(new Date(), settings.timeZone), minuteOffset),
  });

  return setup.api.opd.checkIn({
    orgSlug: setup.organization.slug,
    appointmentId: booked.id,
  });
}

test("an abandoned two-sitting RCT creates no invoice before delivery and stays actionable in follow-ups", async () => {
  const setup = await fixture("treatment-abandoned-rct");

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
    nextSittingOn: "2000-01-01",
    nextSittingNote: "Call before booking",
  });

  const advance = await setup.api.billing.recordAdvance({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    treatmentPlanId: plan.id,
    method: "cash",
    amount: 30_00n,
  });

  const first = await createCheckedInSitting(setup, plan.id, 10);

  // The desk billed the course's service at intake instead of posting it from the plan.
  const second = await createCheckedInSitting(setup, plan.id, 20, [
    { catalogItemId: setup.service.id, qty: 1 },
  ]);

  expect(
    await setup.api.billing.listInvoices({
      orgSlug: setup.organization.slug,
      appointmentId: first.appointment.id,
    }),
  ).toEqual([]);
  expect(
    await setup.api.billing.listInvoices({
      orgSlug: setup.organization.slug,
      appointmentId: second.appointment.id,
    }),
  ).toEqual([]);

  const noDate = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const future = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    nextSittingOn: "2999-01-01",
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const bookedPlan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    nextSittingOn: "2000-01-02",
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const settings = await setup.api.settings.get({ orgSlug: setup.organization.slug });

  const nextBooking = await setup.api.opd.book({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    treatmentPlanId: bookedPlan.id,
    scheduledLocal: shiftLocalMinute(localMinute(new Date(), settings.timeZone), 30),
  });

  const firstPage = await setup.api.treatment.followUps({
    orgSlug: setup.organization.slug,
    query: setup.patient.name,
    limit: 1,
  });

  expect(firstPage.items.map((row) => row.id)).toEqual([plan.id]);
  expect(firstPage.nextCursor).not.toBeNull();

  const secondPage = await setup.api.treatment.followUps({
    orgSlug: setup.organization.slug,
    query: setup.patient.mrn,
    limit: 1,
    cursor: firstPage.nextCursor!,
  });

  // The future-dated plan is not due, so the no-date plan ends the list.
  expect(secondPage.items.map((row) => row.id)).toEqual([noDate.id]);
  expect(secondPage.nextCursor).toBeNull();

  await db
    .update(opdAppointments)
    .set({ businessDate: "2000-01-01", scheduledFor: new Date("2000-01-01") })
    .where(
      and(eq(opdAppointments.orgId, setup.organization.id), eq(opdAppointments.id, nextBooking.id)),
    );

  const missed = await setup.api.treatment.followUps({
    orgSlug: setup.organization.slug,
    query: setup.patient.mrn,
  });

  expect(missed.items.map((row) => row.id)).toContain(bookedPlan.id);

  const detail = await planDetail(setup, plan.id);

  expect(detail.items[0]).toMatchObject({ postedSittings: 0, done: false });

  // D038: the service billed at intake stays ordinary work; the plan post is its own charge.
  const posted = await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: second.appointment.id,
    itemId: detail.items[0]!.id,
  });

  const secondVisit = await setup.api.opd.get({
    orgSlug: setup.organization.slug,
    appointmentId: second.appointment.id,
  });

  expect(
    secondVisit.charges
      .filter((charge) => charge.catalogItemId === setup.service.id)
      .map((charge) => [charge.sourceType, charge.sourceId]),
  ).toEqual(
    expect.arrayContaining([
      ["catalog", null],
      ["treatment_plan", detail.items[0]!.id],
    ]),
  );
  expect(posted.charge.sourceId).toBe(detail.items[0]!.id);
  expect((await planDetail(setup, plan.id)).items[0]).toMatchObject({
    postedSittings: 1,
    done: true,
  });
  expect(detail.sittings.map((sitting) => sitting.id)).toEqual([
    first.appointment.id,
    second.appointment.id,
  ]);

  const closed = await setup.api.treatment.close({
    orgSlug: setup.organization.slug,
    planId: plan.id,
    reason: "Patient stopped after two sittings",
  });

  expect(closed).toMatchObject({
    status: "closed",
    closeReason: "Patient stopped after two sittings",
  });

  // Open plans lead the record screen; the closed one falls to the end.
  expect(
    (
      await setup.api.treatment.listForPatient({
        orgSlug: setup.organization.slug,
        patientId: setup.patient.id,
      })
    ).map((row) => row.id),
  ).toEqual([bookedPlan.id, future.id, noDate.id, plan.id]);

  const refund = await setup.api.billing.recordAdvanceRefund({
    orgSlug: setup.organization.slug,
    advanceReceiptId: advance.id,
    method: "cash",
    amount: 30_00n,
  });

  expect(refund.amount).toBe(30_00n);

  // The voucher stays reachable from the patient's account after its dialog closed.
  const account = await setup.api.patient.account({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
  });

  expect(account.advanceRefunds).toEqual([
    expect.objectContaining({ id: refund.id, advanceReceiptId: advance.id, amount: 30_00n }),
  ]);
});

test("a crown added mid-course remains on the RCT plan and each charge names its sitting", async () => {
  const setup = await fixture("treatment-crown");

  const consultation = await setup.api.catalog.create({
    orgSlug: setup.organization.slug,
    name: "Consultation",
    code: `CONSULT-${uniqueSuffix()}`,
    category: "consultation",
    unitPrice: 10_00n,
    taxRatePercent: "0",
  });

  await expectORPCCode(
    setup.api.treatment.create({
      orgSlug: setup.organization.slug,
      patientId: setup.patient.id,
      practitionerId: setup.practitioner.id,
      item: { catalogItemId: consultation.id, sittingsPlanned: 1 },
    }),
    "NOT_FOUND",
  );

  const crown = await setup.api.catalog.create({
    orgSlug: setup.organization.slug,
    name: "Crown 36",
    code: `CROWN-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 80_00n,
    taxRatePercent: "0",
  });

  // The plan starts from the visit the patient is already at: that visit is sitting 1.
  const settings = await setup.api.settings.get({ orgSlug: setup.organization.slug });

  const booked = await setup.api.opd.book({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    scheduledLocal: shiftLocalMinute(localMinute(new Date(), settings.timeZone), 10),
  });

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    appointmentId: booked.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  await expectORPCCode(
    setup.api.treatment.create({
      orgSlug: setup.organization.slug,
      patientId: setup.patient.id,
      practitionerId: setup.practitioner.id,
      appointmentId: booked.id,
      item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
    }),
    "CONFLICT",
  );

  const beforeCrown = await planDetail(setup, plan.id);
  const planItem = beforeCrown.items[0];

  if (!planItem) throw new Error("Expected the plan's first item");

  // Work is delivered at a sitting, so a visit still waiting to arrive cannot receive it.
  await expectORPCCode(
    setup.api.treatment.postToVisit({
      orgSlug: setup.organization.slug,
      appointmentId: booked.id,
      itemId: planItem.id,
    }),
    "CONFLICT",
  );

  const first = await setup.api.opd.checkIn({
    orgSlug: setup.organization.slug,
    appointmentId: booked.id,
  });

  expect(first.appointment.treatmentPlanId).toBe(plan.id);

  await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: first.appointment.id,
    itemId: planItem.id,
  });

  const second = await createCheckedInSitting(setup, plan.id, 20);

  // One was quoted and one was delivered, so a later sitting has nothing left to post.
  await expectORPCCode(
    setup.api.treatment.postToVisit({
      orgSlug: setup.organization.slug,
      appointmentId: second.appointment.id,
      itemId: planItem.id,
    }),
    "CONFLICT",
  );

  // A price off the catalog has to say why.
  await expectORPCCode(
    setup.api.treatment.addItem({
      orgSlug: setup.organization.slug,
      planId: plan.id,
      item: { catalogItemId: crown.id, sittingsPlanned: 1, quotedPrice: 75_00n },
    }),
    "BAD_REQUEST",
  );

  const added = await setup.api.treatment.addItem({
    orgSlug: setup.organization.slug,
    planId: plan.id,
    item: {
      catalogItemId: crown.id,
      sittingsPlanned: 1,
      quotedPrice: 75_00n,
      note: "Quoted package rate",
    },
  });

  // The crown is quoted but not yet delivered.
  await expectORPCCode(
    setup.api.treatment.complete({ orgSlug: setup.organization.slug, planId: plan.id }),
    "CONFLICT",
  );

  await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: second.appointment.id,
    itemId: added.id,
  });

  const detail = await planDetail(setup, plan.id);

  expect(detail.label).toBe(`${setup.service.name} + Crown 36`);

  expect(detail.items).toEqual([
    expect.objectContaining({ catalogItemId: setup.service.id, postedSittings: 1, done: true }),
    expect.objectContaining({
      catalogItemId: crown.id,
      quotedPrice: 75_00n,
      postedSittings: 1,
      done: true,
    }),
  ]);

  const visits = await Promise.all(
    detail.sittings.map(({ id }) =>
      setup.api.opd.get({ orgSlug: setup.organization.slug, appointmentId: id }),
    ),
  );

  expect(
    visits.map((visit) => [
      visit.appointment.id,
      visit.charges.find((charge) => charge.sourceType === "treatment_plan")?.sourceId,
    ]),
  ).toEqual([
    [first.appointment.id, planItem.id],
    [second.appointment.id, added.id],
  ]);
});

test("two teeth of one procedure post to one sitting, and voiding delivery reopens the plan", async () => {
  const setup = await fixture("treatment-reopen");

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1, note: "Tooth 36" },
  });

  const second = await setup.api.treatment.addItem({
    orgSlug: setup.organization.slug,
    planId: plan.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1, note: "Tooth 46" },
  });

  const sitting = await createCheckedInSitting(setup, plan.id, 10);
  const [first] = (await planDetail(setup, plan.id)).items;

  if (!first) throw new Error("Expected the plan's first item");

  const firstPost = await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: sitting.appointment.id,
    itemId: first.id,
  });

  await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: sitting.appointment.id,
    itemId: second.id,
  });

  await expectORPCCode(
    setup.api.treatment.postToVisit({
      orgSlug: setup.organization.slug,
      appointmentId: sitting.appointment.id,
      itemId: first.id,
    }),
    "CONFLICT",
  );

  await setup.api.treatment.complete({ orgSlug: setup.organization.slug, planId: plan.id });

  await setup.api.billing.voidCharge({
    orgSlug: setup.organization.slug,
    chargeId: firstPost.charge.id,
    reason: "Posted to the wrong tooth",
  });

  expect(await planDetail(setup, plan.id)).toMatchObject({ status: "open" });

  await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: sitting.appointment.id,
    itemId: first.id,
  });

  expect(
    await setup.api.treatment.complete({ orgSlug: setup.organization.slug, planId: plan.id }),
  ).toMatchObject({ status: "completed" });
});

test("closing a plan ahead of queued item writes leaves no dependent change behind", async () => {
  const setup = await fixture("treatment-close-race");

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const extra = await setup.api.catalog.create({
    orgSlug: setup.organization.slug,
    name: "Late course item",
    code: `LATE-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 10_00n,
    taxRatePercent: "0",
  });

  const initialItem = (await planDetail(setup, plan.id)).items[0];

  if (!initialItem) throw new Error("Expected the plan's initial item");

  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });

  await locker.connect();

  try {
    await locker.query("begin");

    const blockerPid = (await locker.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;

    if (!blockerPid) throw new Error("Expected lock transaction backend pid");

    await locker.query("select id from treatment_plans where org_id = $1 and id = $2 for update", [
      setup.organization.id,
      plan.id,
    ]);

    const closePromise = setup.api.treatment.close({
      orgSlug: setup.organization.slug,
      planId: plan.id,
      reason: "Course cancelled",
    });

    const closeBackendPid = await eventually(async () => {
      const blocked = await locker.query<{ pid: number }>(
        `select pid
         from pg_stat_activity
         where $1 = any(pg_blocking_pids(pid))
         limit 1`,
        [blockerPid],
      );

      return blocked.rows[0]?.pid;
    });

    const addPromise = expectORPCCode(
      setup.api.treatment.addItem({
        orgSlug: setup.organization.slug,
        planId: plan.id,
        item: { catalogItemId: extra.id, sittingsPlanned: 1 },
      }),
      "CONFLICT",
    );

    const dropPromise = expectORPCCode(
      setup.api.treatment.dropItem({
        orgSlug: setup.organization.slug,
        itemId: initialItem.id,
        reason: "Should lose the close race",
      }),
      "CONFLICT",
    );

    // Both item writes must be waiting on the close, not racing past it.
    await eventually(async () => {
      const blocked = await locker.query<{ count: number }>(
        `select count(*)::integer as count
         from pg_stat_activity
         where $1 = any(pg_blocking_pids(pid))`,
        [closeBackendPid],
      );

      return blocked.rows[0]?.count === 2 ? true : undefined;
    });

    await locker.query("commit");
    const [closed] = await Promise.all([closePromise, addPromise, dropPromise]);

    expect(closed.status).toBe("closed");

    expect((await planDetail(setup, plan.id)).items).toEqual([
      expect.objectContaining({ catalogItemId: setup.service.id, status: "open" }),
    ]);

    await expectORPCCode(
      setup.api.billing.recordAdvance({
        orgSlug: setup.organization.slug,
        patientId: setup.patient.id,
        treatmentPlanId: plan.id,
        method: "cash",
        amount: 10_00n,
      }),
      "CONFLICT",
    );
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
});

test("three irregular plan advances settle three physiotherapy sittings before untagged credit", async () => {
  const setup = await fixture("treatment-physio");

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: {
      catalogItemId: setup.service.id,
      sittingsPlanned: 3,
      quotedPrice: 150_00n,
      note: "Three-session course",
    },
  });

  await expectORPCCode(
    setup.api.billing.recordAdvance({
      orgSlug: setup.organization.slug,
      patientId: setup.patient.id,
      treatmentPlanId: plan.id,
      method: "upi",
      amount: 1_00n,
    }),
    "BAD_REQUEST",
  );

  // Older and untagged: plan sittings spend the plan's own credit first.
  await setup.api.billing.recordAdvance({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    method: "cash",
    amount: 10_00n,
  });

  const first = await setup.api.billing.recordAdvance({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    method: "cash",
    treatmentPlanId: plan.id,
    amount: 30_00n,
  });

  const second = await setup.api.billing.recordAdvance({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    method: "upi",
    treatmentPlanId: plan.id,
    amount: 40_00n,
    reference: "UPI-ADVANCE",
  });

  const third = await setup.api.billing.recordAdvance({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    treatmentPlanId: plan.id,
    method: "bank",
    amount: 80_00n,
    reference: "BANK-ADVANCE",
  });

  const item = (await planDetail(setup, plan.id)).items[0]!;

  const invoices = [];

  for (const [index, expectedAllocations] of [
    [
      [first.id, 30_00n],
      [second.id, 20_00n],
    ],
    [
      [second.id, 20_00n],
      [third.id, 30_00n],
    ],
    [[third.id, 50_00n]],
  ].entries()) {
    const sitting = await createCheckedInSitting(setup, plan.id, (index + 1) * 10);

    const posted = await setup.api.treatment.postToVisit({
      orgSlug: setup.organization.slug,
      appointmentId: sitting.appointment.id,
      itemId: item.id,
    });

    if (index === 0) {
      // Two sittings are still unplanned, but one sitting bills a service once.
      await expectORPCCode(
        setup.api.treatment.postToVisit({
          orgSlug: setup.organization.slug,
          appointmentId: sitting.appointment.id,
          itemId: item.id,
        }),
        "CONFLICT",
      );

      await expectORPCCode(
        setup.api.billing.settleCharges({
          orgSlug: setup.organization.slug,
          appointmentId: sitting.appointment.id,
          expectedChargeRevision: posted.chargeRevision,
          expectedGrandTotal: 50_00n,
          applyCredit: 50_01n,
        }),
        "CONFLICT",
      );
    }

    const settled = await setup.api.billing.settleCharges({
      orgSlug: setup.organization.slug,
      appointmentId: sitting.appointment.id,
      expectedChargeRevision: posted.chargeRevision,
      expectedGrandTotal: 50_00n,
      applyCredit: 50_00n,
    });

    const invoice = await setup.api.billing.getInvoice({
      orgSlug: setup.organization.slug,
      invoiceId: settled.invoice.id,
    });

    expect(invoice.allocations.map((row) => [row.advanceReceiptId, row.amount])).toEqual(
      expectedAllocations,
    );
    expect(invoice.balance).toMatchObject({ allocationsTotal: 50_00n, outstanding: 0n });
    invoices.push(invoice.invoice.id);
  }

  expect(new Set(invoices).size).toBe(3);

  const credit = await setup.api.billing.patientCredit({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
  });

  expect(credit.total).toBe(10_00n);
  await expectORPCCode(
    setup.api.billing.recordAdvanceRefund({
      orgSlug: setup.organization.slug,
      advanceReceiptId: third.id,
      method: "cash",
      amount: 1n,
    }),
    "CONFLICT",
  );

  const completed = await setup.api.treatment.complete({
    orgSlug: setup.organization.slug,
    planId: plan.id,
  });

  expect(completed.status).toBe("completed");
});

test("check-in cannot change patient when a plan was linked while it waited", async () => {
  const setup = await fixture("treatment-check-in-link");
  const orgSlug = setup.organization.slug;

  const other = await setup.api.patient.register({
    orgSlug,
    name: "Other patient",
    phone: "5558899",
    sex: "other",
    dateOfBirth: "1990-01-01",
    dobEstimated: false,
    address: "",
  });

  const plan = await setup.api.treatment.create({
    orgSlug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const settings = await setup.api.settings.get({ orgSlug });

  // A sitting belongs to the plan's own patient.
  await expectORPCCode(
    setup.api.opd.book({
      orgSlug,
      patientId: other.id,
      practitionerId: setup.practitioner.id,
      treatmentPlanId: plan.id,
      scheduledLocal: shiftLocalMinute(localMinute(new Date(), settings.timeZone), 5),
    }),
    "CONFLICT",
  );

  const appointment = await setup.api.opd.book({
    orgSlug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    scheduledLocal: shiftLocalMinute(localMinute(new Date(), settings.timeZone), 10),
  });

  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();

  try {
    await locker.query("begin");
    await locker.query("select id from opd_appointments where org_id = $1 and id = $2 for update", [
      setup.organization.id,
      appointment.id,
    ]);

    const checkIn = setup.api.opd.checkIn({
      orgSlug,
      appointmentId: appointment.id,
      patientId: other.id,
    });

    const rejected = expectORPCCode(checkIn, "CONFLICT");
    await eventually(async () => {
      const waiting = await locker.query(
        "select pid from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))",
      );

      return waiting.rows[0];
    });
    await locker.query(
      "update opd_appointments set treatment_plan_id = $1 where org_id = $2 and id = $3",
      [plan.id, setup.organization.id, appointment.id],
    );
    await locker.query("commit");
    await rejected;
    const record = await setup.api.opd.get({ orgSlug, appointmentId: appointment.id });
    expect(record.patient?.id).toBe(setup.patient.id);
    expect(record.appointment.status).toBe("booked");
    expect(record.appointment.treatmentPlanId).toBe(plan.id);
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
});

test("credit allocation does not spend receipts created after its lock statement", async () => {
  const setup = await fixture("treatment-credit-lock-set");
  const orgSlug = setup.organization.slug;

  const plan = await setup.api.treatment.create({
    orgSlug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 1 },
  });

  const sitting = await createCheckedInSitting(setup, plan.id, 10);
  const detail = await planDetail(setup, plan.id);

  const posted = await setup.api.treatment.postToVisit({
    orgSlug,
    appointmentId: sitting.appointment.id,
    itemId: detail.items[0]!.id,
  });

  const settled = await setup.api.billing.settleCharges({
    orgSlug,
    appointmentId: sitting.appointment.id,
    expectedChargeRevision: posted.chargeRevision,
    expectedGrandTotal: 50_00n,
    note: "Pay later",
  });

  const first = await setup.api.billing.recordAdvance({
    orgSlug,
    patientId: setup.patient.id,
    method: "cash",
    amount: 20_00n,
  });

  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();

  try {
    await locker.query("begin");
    await locker.query("select id from advance_receipts where org_id = $1 and id = $2 for update", [
      setup.organization.id,
      first.id,
    ]);

    const allocation = setup.api.billing.recordPayments({
      orgSlug,
      invoiceId: settled.invoice.id,
      applyCredit: 50_00n,
    });

    const rejected = expectORPCCode(allocation, "CONFLICT");
    await eventually(async () => {
      const waiting = await locker.query(
        "select pid from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))",
      );

      return waiting.rows[0];
    });
    await setup.api.billing.recordAdvance({
      orgSlug,
      patientId: setup.patient.id,
      method: "cash",
      amount: 30_00n,
    });
    await locker.query("commit");
    await rejected;
    expect(
      (await setup.api.billing.patientCredit({ orgSlug, patientId: setup.patient.id })).total,
    ).toBe(50_00n);
    expect(
      (await setup.api.billing.getInvoice({ orgSlug, invoiceId: settled.invoice.id })).balance
        .outstanding,
    ).toBe(50_00n);
    await setup.api.billing.recordPayments({
      orgSlug,
      invoiceId: settled.invoice.id,
      applyCredit: 50_00n,
    });
    expect(
      (await setup.api.billing.patientCredit({ orgSlug, patientId: setup.patient.id })).total,
    ).toBe(0n);
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
});

test("a four-sitting estimate allows billing the rest early and finishing the plan", async () => {
  const setup = await fixture("treatment-course-split");

  const plan = await setup.api.treatment.create({
    orgSlug: setup.organization.slug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: { catalogItemId: setup.service.id, sittingsPlanned: 4 },
  });

  const [item] = (await planDetail(setup, plan.id)).items;

  if (!item) throw new Error("Expected the plan's first item");

  const first = await createCheckedInSitting(setup, plan.id, 10);

  const firstPost = await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: first.appointment.id,
    itemId: item.id,
  });

  expect(firstPost.charge.unitPrice).toBe(12_50n);

  const second = await createCheckedInSitting(setup, plan.id, 20);

  const restPost = await setup.api.treatment.postToVisit({
    orgSlug: setup.organization.slug,
    appointmentId: second.appointment.id,
    itemId: item.id,
    rest: true,
  });

  expect(restPost.charge.unitPrice).toBe(37_50n);

  expect(await planDetail(setup, plan.id)).toMatchObject({
    quotedTotal: 50_00n,
    postedAmount: 50_00n,
    items: [expect.objectContaining({ postedSittings: 2, nextSittingPrice: null, done: true })],
  });

  const third = await createCheckedInSitting(setup, plan.id, 30);
  await expectORPCCode(
    setup.api.treatment.postToVisit({
      orgSlug: setup.organization.slug,
      appointmentId: third.appointment.id,
      itemId: item.id,
    }),
    "CONFLICT",
  );

  expect(
    await setup.api.treatment.complete({ orgSlug: setup.organization.slug, planId: plan.id }),
  ).toMatchObject({ status: "completed" });
});

test("a free course needs one posted sitting before completion", async () => {
  const setup = await fixture("treatment-free-course");
  const orgSlug = setup.organization.slug;

  const plan = await setup.api.treatment.create({
    orgSlug,
    patientId: setup.patient.id,
    practitionerId: setup.practitioner.id,
    item: {
      catalogItemId: setup.service.id,
      sittingsPlanned: 2,
      quotedPrice: 0n,
      note: "No-charge treatment",
    },
  });

  await expectORPCCode(setup.api.treatment.complete({ orgSlug, planId: plan.id }), "CONFLICT");

  const sitting = await createCheckedInSitting(setup, plan.id, 10);
  const item = (await planDetail(setup, plan.id)).items[0]!;

  const posted = await setup.api.treatment.postToVisit({
    orgSlug,
    appointmentId: sitting.appointment.id,
    itemId: item.id,
  });

  expect(posted.charge.unitPrice).toBe(0n);
  expect((await planDetail(setup, plan.id)).items[0]).toMatchObject({
    postedSittings: 1,
    done: true,
  });
  expect(await setup.api.treatment.complete({ orgSlug, planId: plan.id })).toMatchObject({
    status: "completed",
  });
});
