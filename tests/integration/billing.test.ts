import { beforeAll, expect, test } from "bun:test";
import pg from "pg";

import { formatDecimal } from "@hms/api/core/money";
import { invoiceBalanceFor } from "@hms/api/lib/invoice-balance";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { addPendingCatalogCharge, settlePendingCharges } from "../support/billing";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

// The fixture's organization runs on Asia/Kolkata, so the expected fiscal year comes
// from that calendar, not the UTC one the test process happens to be in.
function fiscalYearNow(): string {
  const [year, month] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number) as [number, number];

  const startYear = month >= 4 ? year : year - 1;

  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function firstLineId(result: { lines: Array<{ id: string }> }): string {
  const [line] = result.lines;

  if (!line) {
    throw new Error("expected at least one line");
  }

  return line.id;
}

async function pendingChargesFor(api: AppRouterClient, orgSlug: string, appointmentId: string) {
  const record = await api.opd.get({ orgSlug, appointmentId });

  return record.charges.filter((charge) => charge.status === "pending");
}

async function createBillingFixture(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);
  await api.settings.update({
    orgSlug: organization.slug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "GSTIN-TEST",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    creditNotePrefix: "CN",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 1,
  });

  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5553000",
    sex: "other",
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: `${seed} Patient Address`,
  });

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
  });

  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: `Dr. ${seed}`,
    departmentId: department.id,
  });

  async function createOpdAppointment(
    services: Array<{ catalogItemId: string; qty?: number }> = [],
  ) {
    const booked = await api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      scheduledLocal: "2030-03-15T10:30",
      services,
    });

    return (
      await api.opd.checkIn({
        orgSlug: organization.slug,
        appointmentId: booked.id,
      })
    ).appointment;
  }

  async function addCatalogCharge(
    appointmentId: string,
    unitPrice: bigint,
    taxRatePercent = "0",
    description = `${seed} Catalog Charge`,
  ) {
    const item = await api.catalog.create({
      orgSlug: organization.slug,
      name: description,
      code: `TEST-${uniqueSuffix()}`,
      category: "other",
      unitPrice,
      taxRatePercent,
    });

    const charge = await addPendingCatalogCharge({
      orgId: organization.id,
      userId: owner.user.id,
      appointmentId,
      catalogItemId: item.id,
    });

    return charge;
  }

  return {
    owner,
    organization,
    api,
    patient,
    department,
    practitioner,
    createOpdAppointment,
    addCatalogCharge,
  };
}

type InvoiceFixture = {
  api: AppRouterClient;
  organization: { slug: string };
  createOpdAppointment: () => Promise<{ id: string }>;
  addCatalogCharge: (
    appointmentId: string,
    unitPrice: bigint,
    taxRatePercent?: string,
    description?: string,
  ) => Promise<{ id: string }>;
};

async function createInvoice(fixture: InvoiceFixture, amount = 100_00n, taxRatePercent = "0") {
  const appointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(appointment.id, amount, taxRatePercent);

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  return { appointment, charge, ...issued };
}

async function expectAudit(api: AppRouterClient, orgSlug: string, action: string, target: string) {
  return eventually(async () => {
    const audit = await api.audit.list({ orgSlug });

    return audit.items.find((entry) => entry.action === action && entry.target === target);
  });
}

test("catalog charges issue an exact invoice and a full payment settles it", async () => {
  const fixture = await createBillingFixture("billing-happy");
  const { api, organization } = fixture;
  const appointment = await fixture.createOpdAppointment();

  const item = await api.catalog.create({
    orgSlug: organization.slug,
    name: "Taxable Procedure",
    code: `BILL-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 100_00n,
    taxRatePercent: "18.00",
    taxCode: "GST18",
  });

  const catalogCharge = await addPendingCatalogCharge({
    orgId: organization.id,
    userId: fixture.owner.user.id,
    appointmentId: appointment.id,
    catalogItemId: item.id,
    qty: 2,
  });

  const supplyCharge = await fixture.addCatalogCharge(appointment.id, 50_00n, "0", "Supply");

  const pending = await pendingChargesFor(api, organization.slug, appointment.id);
  expect(pending).toHaveLength(2);
  expect(pending.map((charge) => charge.id)).toEqual(
    expect.arrayContaining([catalogCharge.id, supplyCharge.id]),
  );

  const issued = await settlePendingCharges(api, {
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });

  expect(issued.invoice.invoiceNumber).toBe(`INV${fiscalYearNow()}/1`);
  expect(issued.invoice.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(issued.invoice).toMatchObject({
    subtotal: 250_00n,
    taxTotal: 36_00n,
    grandTotal: 286_00n,
  });
  expect(issued.invoice.subtotal).toBe(
    issued.lines.reduce((sum, line) => sum + line.lineSubtotal, 0n),
  );
  expect(issued.invoice.taxTotal).toBe(
    issued.lines.reduce((sum, line) => sum + line.taxAmount, 0n),
  );
  expect(issued.invoice.grandTotal).toBe(issued.lines.reduce((sum, line) => sum + line.gross, 0n));
  expect(await pendingChargesFor(api, organization.slug, appointment.id)).toEqual([]);

  const appointmentReadBack = await api.opd.get({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });

  expect(appointmentReadBack.charges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: catalogCharge.id,
        status: "invoiced",
        invoiceId: issued.invoice.id,
      }),
      expect.objectContaining({
        id: supplyCharge.id,
        status: "invoiced",
        invoiceId: issued.invoice.id,
      }),
    ]),
  );

  const [payment] = await api.billing.recordPayments({
    orgSlug: organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "card", amount: issued.invoice.grandTotal, reference: "CARD-HAPPY" }],
  });

  if (!payment) throw new Error("expected a payment");
  expect(payment.receiptNumber).toBe(`RCT${fiscalYearNow()}/1`);
  expect(payment.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(
    await invoiceBalanceFor(db, organization.id, {
      ...issued.invoice,
      grandTotal: issued.invoice.grandTotal,
    }),
  ).toEqual({
    grandTotal: issued.invoice.grandTotal,
    creditTotal: 0n,
    paymentsTotal: issued.invoice.grandTotal,
    refundsTotal: 0n,
    outstanding: 0n,
  });

  const listed = await api.billing.listInvoices({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });

  expect(listed).toEqual([expect.objectContaining({ id: issued.invoice.id, outstanding: 0n })]);

  const detail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: issued.invoice.id,
  });

  expect(detail.lines).toHaveLength(2);
  expect(detail.invoice.businessDate).toBe(issued.invoice.businessDate);
  expect(detail.payments.map((row) => row.id)).toEqual([payment.id]);
  expect(detail.payments[0]?.businessDate).toBe(payment.businessDate);
  expect(detail.balance.outstanding).toBe(0n);

  const invoiceAudit = await expectAudit(
    api,
    organization.slug,
    "invoice.issue",
    `invoice:${issued.invoice.id}`,
  );

  expect(invoiceAudit?.meta).toMatchObject({
    invoiceNumber: issued.invoice.invoiceNumber,
    grandTotal: formatDecimal(issued.invoice.grandTotal),
  });

  const paymentAudit = await expectAudit(
    api,
    organization.slug,
    "payment.record",
    `payment:${payment.id}`,
  );

  expect(paymentAudit?.meta).toMatchObject({
    receiptNumber: payment.receiptNumber,
    amount: formatDecimal(payment.amount),
  });
});

test("booked service charges settle with split payments in one transaction", async () => {
  const fixture = await createBillingFixture("billing-settle-charges");

  const [existing, staged] = await Promise.all([
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Existing charge",
      code: `EXISTING-${uniqueSuffix()}`,
      category: "procedure",
      unitPrice: 100_00n,
      taxRatePercent: "0",
    }),
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Staged procedure",
      code: `STAGED-${uniqueSuffix()}`,
      category: "procedure",
      unitPrice: 200_00n,
      taxRatePercent: "0",
    }),
  ]);

  const appointment = await fixture.createOpdAppointment([
    { catalogItemId: existing.id },
    { catalogItemId: staged.id },
  ]);

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  const settled = await fixture.api.billing.settleCharges({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    expectedChargeRevision: review.appointment.chargeRevision,
    expectedGrandTotal: 275_00n,
    discountAmount: 25_00n,
    note: "Concession approved; balance due next visit.",
    payments: [
      { method: "cash", amount: 100_00n },
      { method: "upi", amount: 75_00n, reference: "UPI-SPLIT" },
    ],
  });

  expect(settled.invoice).toMatchObject({
    subtotal: 300_00n,
    discountAmount: 25_00n,
    grandTotal: 275_00n,
  });
  expect(settled.lines.map((line) => line.description)).toEqual([
    "Existing charge",
    "Staged procedure",
  ]);
  expect(settled.payments).toHaveLength(2);
  expect(await pendingChargesFor(fixture.api, fixture.organization.slug, appointment.id)).toEqual(
    [],
  );
  expect(
    await invoiceBalanceFor(db, fixture.organization.id, {
      ...settled.invoice,
      grandTotal: settled.invoice.grandTotal,
    }),
  ).toMatchObject({
    paymentsTotal: 17_500n,
    outstanding: 10_000n,
  });
});

test("equal-timestamp charges keep one reviewed order through settlement", async () => {
  const fixture = await createBillingFixture("billing-charge-order");
  const appointment = await fixture.createOpdAppointment();

  const [zeroRated, fivePercent, smaller] = await Promise.all([
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Zero-rated equal line",
      code: `ORDER-A-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 300_00n,
      taxRatePercent: "0",
    }),
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Five-percent equal line",
      code: `ORDER-B-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 300_00n,
      taxRatePercent: "5",
    }),
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Smaller line",
      code: `ORDER-C-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 250_00n,
      taxRatePercent: "0",
    }),
  ]);

  const prefix = `same-time-${uniqueSuffix()}`;

  const ids = {
    zeroRated: `${prefix}-a`,
    fivePercent: `${prefix}-b`,
    smaller: `${prefix}-c`,
  };

  const createdAt = new Date("2026-08-30T10:00:00.000Z");

  for (const [id, catalogItemId] of [
    [ids.fivePercent, fivePercent.id],
    [ids.zeroRated, zeroRated.id],
    [ids.smaller, smaller.id],
  ] as const) {
    await addPendingCatalogCharge({
      orgId: fixture.organization.id,
      userId: fixture.owner.user.id,
      appointmentId: appointment.id,
      catalogItemId,
      id,
      createdAt,
    });
  }

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  expect(review.charges.map((charge) => charge.id)).toEqual([
    ids.zeroRated,
    ids.fivePercent,
    ids.smaller,
  ]);

  const settled = await fixture.api.billing.settleCharges({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    expectedChargeRevision: review.appointment.chargeRevision,
    expectedGrandTotal: 862_96n,
    discountAmount: 2_00n,
    note: "Reviewed discount and outstanding balance",
  });

  expect(settled.invoice.grandTotal).toBe(862_96n);
  expect(settled.lines.map((line) => line.chargeId)).toEqual([
    ids.zeroRated,
    ids.fivePercent,
    ids.smaller,
  ]);
});

test("charge settlement rolls back the invoice on invalid collection", async () => {
  const fixture = await createBillingFixture("billing-settle-rollback");

  const [existing, staged] = await Promise.all([
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Existing charge",
      code: `EXISTING-${uniqueSuffix()}`,
      category: "procedure",
      unitPrice: 100_00n,
      taxRatePercent: "0",
    }),
    fixture.api.catalog.create({
      orgSlug: fixture.organization.slug,
      name: "Staged charge",
      code: `ROLLBACK-${uniqueSuffix()}`,
      category: "procedure",
      unitPrice: 50_00n,
      taxRatePercent: "0",
    }),
  ]);

  const appointment = await fixture.createOpdAppointment([
    { catalogItemId: existing.id },
    { catalogItemId: staged.id },
  ]);

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  await expectORPCCode(
    fixture.api.billing.settleCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 150_00n,
      payments: [{ method: "cash", amount: 150_01n }],
    }),
    "BAD_REQUEST",
  );

  expect(await pendingChargesFor(fixture.api, fixture.organization.slug, appointment.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ catalogItemId: existing.id }),
      expect.objectContaining({ catalogItemId: staged.id }),
    ]),
  );
  expect(
    await fixture.api.billing.listInvoices({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    }),
  ).toEqual([]);
});

test("charge settlement requires a checked-in appointment", async () => {
  const fixture = await createBillingFixture("billing-pre-arrival");

  const booked = await fixture.api.opd.book({
    orgSlug: fixture.organization.slug,
    patientId: fixture.patient.id,
    practitionerId: fixture.practitioner.id,
    scheduledLocal: "2030-06-01T10:00",
  });

  await fixture.addCatalogCharge(booked.id, 100_00n);

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: booked.id,
  });

  await expectORPCCode(
    fixture.api.billing.settleCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: booked.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 100_00n,
    }),
    "CONFLICT",
  );
});

test("charge settlement requires a reason for a discount", async () => {
  const fixture = await createBillingFixture("billing-discount-reason");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, 100_00n);

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  await expectORPCCode(
    fixture.api.billing.settleCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 99_00n,
      discountAmount: 1_00n,
    }),
    "BAD_REQUEST",
  );
});

test("charge settlement rejects a discount above the invoice subtotal", async () => {
  const fixture = await createBillingFixture("billing-discount-cap");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, 300_00n);

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  await expectORPCCode(
    fixture.api.billing.settleCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 0n,
      discountAmount: 400_00n,
      note: "Impossible discount",
    }),
    "BAD_REQUEST",
  );
});

test("charge settlement rejects charges added after the cashier reviewed the bill", async () => {
  const fixture = await createBillingFixture("billing-settle-stale-review");
  const appointment = await fixture.createOpdAppointment();
  const reviewed = await fixture.addCatalogCharge(appointment.id, 100_00n, "0", "Reviewed charge");

  const review = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  const addedElsewhere = await fixture.addCatalogCharge(
    appointment.id,
    50_00n,
    "0",
    "Charge from another terminal",
  );

  await expectORPCCode(
    fixture.api.billing.settleCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 100_00n,
      note: "Patient will pay the reviewed balance later.",
      payments: [{ method: "cash", amount: 100_00n }],
    }),
    "CONFLICT",
  );

  expect(await pendingChargesFor(fixture.api, fixture.organization.slug, appointment.id)).toEqual([
    expect.objectContaining({ id: reviewed.id, status: "pending" }),
    expect.objectContaining({ id: addedElsewhere.id, status: "pending" }),
  ]);
  expect(
    await fixture.api.billing.listInvoices({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    }),
  ).toEqual([]);
});

test("booked-service settlement has one winner across two terminals", async () => {
  const fixture = await createBillingFixture("billing-staged-only-race");

  const staged = await fixture.api.catalog.create({
    orgSlug: fixture.organization.slug,
    name: "Booked procedure",
    code: `STAGED-RACE-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 100_00n,
    taxRatePercent: "0",
  });

  const appointment = await fixture.createOpdAppointment([{ catalogItemId: staged.id }]);

  const input = {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    expectedChargeRevision: appointment.chargeRevision,
    expectedGrandTotal: 100_00n,
    payments: [{ method: "cash" as const, amount: 100_00n }],
  };

  const results = await Promise.allSettled([
    fixture.api.billing.settleCharges(input),
    fixture.api.billing.settleCharges(input),
  ]);

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ code: "CONFLICT" }) }),
  ]);
  expect(
    await fixture.api.billing.listInvoices({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    }),
  ).toHaveLength(1);

  const settledAppointment = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  expect(settledAppointment.charges).toEqual([
    expect.objectContaining({ catalogItemId: staged.id, status: "invoiced" }),
  ]);
});

test("concurrent invoice issuance has one winner and leaves no charges for re-issue", async () => {
  const fixture = await createBillingFixture("billing-race");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, 100_00n);
  const input = { orgSlug: fixture.organization.slug, appointmentId: appointment.id };

  const results = await Promise.allSettled([
    settlePendingCharges(fixture.api, input),
    settlePendingCharges(fixture.api, input),
  ]);

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("CONFLICT");
  await expectORPCCode(settlePendingCharges(fixture.api, input), "CONFLICT");
});

test("zero pending charges conflict and voided charges are excluded from issuance", async () => {
  const fixture = await createBillingFixture("billing-empty");
  const emptyOpdAppointment = await fixture.createOpdAppointment();
  await expectORPCCode(
    settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: emptyOpdAppointment.id,
    }),
    "CONFLICT",
  );

  const voidedOpdAppointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(voidedOpdAppointment.id, 25_00n);
  await fixture.api.billing.voidCharge({
    orgSlug: fixture.organization.slug,
    chargeId: charge.id,
    reason: "Entered in error",
  });
  expect(
    await pendingChargesFor(fixture.api, fixture.organization.slug, voidedOpdAppointment.id),
  ).toEqual([]);
  await expectORPCCode(
    settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: voidedOpdAppointment.id,
    }),
    "CONFLICT",
  );
});

test("cancelling a paid appointment does not issue credit or refund", async () => {
  const fixture = await createBillingFixture("billing-cancel-paid");
  const issued = await createInvoice(fixture);
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ amount: issued.invoice.grandTotal, method: "cash" }],
  });
  await fixture.api.opd.cancel({
    orgSlug: fixture.organization.slug,
    appointmentId: issued.appointment.id,
    reason: "Patient left",
  });

  const detail = await fixture.api.billing.getInvoice({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
  });

  expect(detail.creditNotes).toEqual([]);
  expect(detail.refunds).toEqual([]);
});

test("voiding distinguishes unknown and invoiced charges and records its reason and audit", async () => {
  const fixture = await createBillingFixture("billing-void");
  const successfulOpdAppointment = await fixture.createOpdAppointment();
  const pending = await fixture.addCatalogCharge(successfulOpdAppointment.id, 25_00n);

  const reviewed = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: successfulOpdAppointment.id,
  });

  const voided = await fixture.api.billing.voidCharge({
    orgSlug: fixture.organization.slug,
    chargeId: pending.id,
    reason: "Duplicate entry",
  });

  expect(voided).toMatchObject({ status: "voided", voidReason: "Duplicate entry" });

  const afterVoid = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: successfulOpdAppointment.id,
  });

  expect(afterVoid.appointment.chargeRevision).toBe(reviewed.appointment.chargeRevision + 1);

  const audit = await expectAudit(
    fixture.api,
    fixture.organization.slug,
    "charge.void",
    `charge:${pending.id}`,
  );

  expect(audit?.meta).toMatchObject({ reason: "Duplicate entry" });

  const invoiced = await createInvoice(fixture, 30_00n);
  await expectORPCCode(
    fixture.api.billing.voidCharge({
      orgSlug: fixture.organization.slug,
      chargeId: invoiced.charge.id,
      reason: "Too late",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    fixture.api.billing.voidCharge({
      orgSlug: fixture.organization.slug,
      chargeId: Bun.randomUUIDv7(),
      reason: "Unknown",
    }),
    "NOT_FOUND",
  );
});

test("partial payments follow outstanding and credit-adjusted caps", async () => {
  const fixture = await createBillingFixture("billing-payments");
  const first = await createInvoice(fixture);

  const [paymentOne] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    payments: [{ method: "cash", amount: 40_00n }],
  });

  const [paymentTwo] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    payments: [{ method: "upi", amount: 60_00n, reference: "UPI-PARTIAL" }],
  });

  if (!paymentOne || !paymentTwo) throw new Error("expected both payments");
  expect([paymentOne.receiptNumber, paymentTwo.receiptNumber]).toEqual([
    `RCT${fiscalYearNow()}/1`,
    `RCT${fiscalYearNow()}/2`,
  ]);
  await expectORPCCode(
    fixture.api.billing.recordPayments({
      orgSlug: fixture.organization.slug,
      invoiceId: first.invoice.id,
      payments: [{ method: "cash", amount: 1_00n }],
    }),
    "CONFLICT",
  );

  const second = await createInvoice(fixture);
  await expectORPCCode(
    fixture.api.billing.recordPayments({
      orgSlug: fixture.organization.slug,
      invoiceId: second.invoice.id,
      payments: [{ method: "cash", amount: 101_00n }],
    }),
    "CONFLICT",
  );
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Price adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: 80_00n }],
  });
  await expectORPCCode(
    fixture.api.billing.recordPayments({
      orgSlug: fixture.organization.slug,
      invoiceId: second.invoice.id,
      payments: [{ method: "cash", amount: 30_00n }],
    }),
    "CONFLICT",
  );
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    payments: [{ method: "cash", amount: 20_00n }],
  });
  expect(
    (
      await invoiceBalanceFor(db, fixture.organization.id, {
        ...second.invoice,
        grandTotal: second.invoice.grandTotal,
      })
    ).outstanding,
  ).toBe(0n);
});

test("split payments settle atomically and require reconciliation references", async () => {
  const fixture = await createBillingFixture("billing-split-payment");
  const issued = await createInvoice(fixture);

  await expectORPCCode(
    fixture.api.billing.recordPayments({
      orgSlug: fixture.organization.slug,
      invoiceId: issued.invoice.id,
      payments: [
        { method: "cash", amount: 40_00n },
        { method: "upi", amount: 60_00n },
      ],
    }),
    "BAD_REQUEST",
  );
  expect(
    (
      await invoiceBalanceFor(db, fixture.organization.id, {
        ...issued.invoice,
        grandTotal: issued.invoice.grandTotal,
      })
    ).paymentsTotal,
  ).toBe(0n);

  const recorded = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [
      { method: "cash", amount: 40_00n },
      { method: "upi", amount: 60_00n, reference: "UPI-SPLIT" },
    ],
  });

  expect(recorded.map((payment) => payment.amount)).toEqual([40_00n, 60_00n]);
  expect(recorded.map((payment) => payment.receiptNumber)).toEqual([
    `RCT${fiscalYearNow()}/1`,
    `RCT${fiscalYearNow()}/2`,
  ]);
  expect(
    (
      await invoiceBalanceFor(db, fixture.organization.id, {
        ...issued.invoice,
        grandTotal: issued.invoice.grandTotal,
      })
    ).outstanding,
  ).toBe(0n);
});

test("discount allocation, multi-rate totals, and partial credit tax extraction are exact", async () => {
  const fixture = await createBillingFixture("billing-discount");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, 100_00n, "0", "Zero-rated Service");
  await fixture.addCatalogCharge(appointment.id, 200_00n, "18.00", "Taxable Service");

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    discountAmount: 30_00n,
    note: "Package discount",
  });

  expect(issued.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ description: "Zero-rated Service", allocatedDiscount: 10_00n }),
      expect.objectContaining({ description: "Taxable Service", allocatedDiscount: 20_00n }),
    ]),
  );
  expect(issued.lines.reduce((sum, line) => sum + line.allocatedDiscount, 0n)).toBe(3000n);
  expect(issued.invoice).toMatchObject({
    subtotal: 300_00n,
    taxTotal: 32_40n,
    grandTotal: 302_40n,
  });
  expect(issued.invoice.subtotal).toBe(
    issued.lines.reduce((sum, line) => sum + line.lineSubtotal, 0n),
  );
  expect(issued.invoice.taxTotal).toBe(
    issued.lines.reduce((sum, line) => sum + line.taxAmount, 0n),
  );
  expect(issued.invoice.grandTotal).toBe(issued.lines.reduce((sum, line) => sum + line.gross, 0n));

  const taxableLine = issued.lines.find((line) => line.taxRatePercent === "18.00");

  if (!taxableLine) {
    throw new Error("issued invoice did not include its 18% line");
  }

  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial service reversal",
    lines: [{ invoiceLineId: taxableLine.id, gross: 59_00n }],
  });

  expect(credited.creditNote.creditNoteNumber).toBe(`CN${fiscalYearNow()}/1`);
  expect(credited.lines[0]).toMatchObject({
    taxableValue: 50_00n,
    taxAmount: 9_00n,
    gross: 59_00n,
  });

  const creditDetail = await fixture.api.billing.getInvoice({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
  });

  expect(creditDetail.creditNotes).toEqual([
    expect.objectContaining({
      id: credited.creditNote.id,
      lines: [expect.objectContaining({ id: firstLineId(credited), gross: 59_00n })],
    }),
  ]);

  const creditAudit = await expectAudit(
    fixture.api,
    fixture.organization.slug,
    "creditNote.issue",
    `creditNote:${credited.creditNote.id}`,
  );

  expect(creditAudit?.meta).toMatchObject({
    creditNoteNumber: credited.creditNote.creditNoteNumber,
    total: "59.00",
  });
});

test("credit notes enforce duplicate, full-line, partial-line, and invoice caps", async () => {
  const fixture = await createBillingFixture("billing-credit-caps");

  const full = await createInvoice(fixture);
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: full.invoice.id,
      reason: "Unknown line",
      lines: [{ invoiceLineId: Bun.randomUUIDv7(), full: true }],
    }),
    "NOT_FOUND",
  );
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: full.invoice.id,
    reason: "Full reversal",
    lines: [{ invoiceLineId: firstLineId(full), full: true }],
  });
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: full.invoice.id,
      reason: "Second reversal",
      lines: [{ invoiceLineId: firstLineId(full), full: true }],
    }),
    "BAD_REQUEST",
  );

  const partial = await createInvoice(fixture);
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: partial.invoice.id,
      reason: "Duplicate input",
      lines: [
        { invoiceLineId: firstLineId(partial), gross: 10_00n },
        { invoiceLineId: firstLineId(partial), gross: 10_00n },
      ],
    }),
    "BAD_REQUEST",
  );
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: partial.invoice.id,
    reason: "First partial",
    lines: [{ invoiceLineId: firstLineId(partial), gross: 60_00n }],
  });
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: partial.invoice.id,
      reason: "Over cap",
      lines: [{ invoiceLineId: firstLineId(partial), gross: 50_00n }],
    }),
    "BAD_REQUEST",
  );

  const allOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(allOpdAppointment.id, 100_00n, "0", "Line One");
  await fixture.addCatalogCharge(allOpdAppointment.id, 100_00n, "18.00", "Line Two");

  const all = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: allOpdAppointment.id,
  });

  const allCredit = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: all.invoice.id,
    reason: "Entire invoice reversed",
    lines: all.lines.map((line) => ({ invoiceLineId: line.id, full: true as const })),
  });

  expect(allCredit.creditNote.subtotal).toBe(all.invoice.subtotal);
  expect(allCredit.creditNote.taxTotal).toBe(all.invoice.taxTotal);
  expect(allCredit.creditNote.total).toBe(all.invoice.grandTotal);

  const balance = await invoiceBalanceFor(db, fixture.organization.id, {
    ...all.invoice,
    grandTotal: all.invoice.grandTotal,
  });

  expect(balance.creditTotal).toBe(balance.grandTotal);
});

test("refunds are bounded by refund due and by the selected credit note", async () => {
  const fixture = await createBillingFixture("billing-refunds");
  const first = await createInvoice(fixture);
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    payments: [{ method: "cash", amount: 50_00n }],
  });

  const credit = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    reason: "Large adjustment",
    lines: [{ invoiceLineId: firstLineId(first), gross: 80_00n }],
  });

  expect(
    (
      await invoiceBalanceFor(db, fixture.organization.id, {
        ...first.invoice,
        grandTotal: first.invoice.grandTotal,
      })
    ).outstanding,
  ).toBe(-3_000n);
  await expectORPCCode(
    fixture.api.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: credit.creditNote.id,
      method: "cash",
      amount: 50_00n,
    }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    fixture.api.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: credit.creditNote.id,
      method: "upi",
      amount: 30_00n,
    }),
    "BAD_REQUEST",
  );

  const refund = await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credit.creditNote.id,
    method: "upi",
    amount: 30_00n,
    reference: "UPI-REFUND-30",
  });

  expect(refund.refundNumber).toBe(`RF${fiscalYearNow()}/1`);
  expect(refund.reference).toBe("UPI-REFUND-30");
  expect(
    (
      await invoiceBalanceFor(db, fixture.organization.id, {
        ...first.invoice,
        grandTotal: first.invoice.grandTotal,
      })
    ).outstanding,
  ).toBe(0n);

  const refundedDetail = await fixture.api.billing.getInvoice({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
  });

  expect(refundedDetail.refunds.map((row) => row.id)).toEqual([refund.id]);

  const refundAudit = await expectAudit(
    fixture.api,
    fixture.organization.slug,
    "refund.record",
    `refund:${refund.id}`,
  );

  expect(refundAudit?.meta).toMatchObject({ refundNumber: refund.refundNumber, amount: "30.00" });

  const second = await createInvoice(fixture);
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    payments: [{ method: "card", amount: 100_00n, reference: "CARD-REFUND-FIXTURE" }],
  });

  const smallNote = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Small adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: 10_00n }],
  });

  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Large adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: 70_00n }],
  });
  await expectORPCCode(
    fixture.api.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: smallNote.creditNote.id,
      method: "cash",
      amount: 40_00n,
    }),
    "BAD_REQUEST",
  );
  await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: smallNote.creditNote.id,
    method: "cash",
    amount: 10_00n,
  });
});

test("refund due lists overpaid invoices until the refund is recorded", async () => {
  const fixture = await createBillingFixture("billing-refund-due");
  const issued = await createInvoice(fixture);
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "cash", amount: 100_00n }],
  });

  const credit = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial reversal",
    lines: [{ invoiceLineId: firstLineId(issued), gross: 25_00n }],
  });

  const due = await fixture.api.billing.refundDue({ orgSlug: fixture.organization.slug });
  expect(due).toMatchObject({
    hasMore: false,
    rows: [
      {
        invoiceId: issued.invoice.id,
        invoiceNumber: issued.invoice.invoiceNumber,
        patientName: fixture.patient.name,
        patientMrn: fixture.patient.mrn,
        businessDate: issued.invoice.businessDate,
        refundDue: 25_00n,
      },
    ],
  });

  await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credit.creditNote.id,
    method: "cash",
    amount: 25_00n,
  });
  expect(
    (await fixture.api.billing.refundDue({ orgSlug: fixture.organization.slug })).rows,
  ).toEqual([]);
});

test("settlement and appointment cancellation serialize without crossing states", async () => {
  const fixture = await createBillingFixture("billing-cancel-race");
  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();

  try {
    const blockerPid = (await locker.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;

    if (!blockerPid) throw new Error("Expected lock transaction backend pid");

    const cancelledOpdAppointmentWithPendingCharge = await fixture.createOpdAppointment();
    await fixture.addCatalogCharge(cancelledOpdAppointmentWithPendingCharge.id, 75_00n);
    await locker.query(
      `update opd_appointments
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Imported state'
       where org_id = $1 and id = $2`,
      [fixture.organization.id, cancelledOpdAppointmentWithPendingCharge.id],
    );
    await expectORPCCode(
      settlePendingCharges(fixture.api, {
        orgSlug: fixture.organization.slug,
        appointmentId: cancelledOpdAppointmentWithPendingCharge.id,
      }),
      "CONFLICT",
    );

    const invoiceFirstOpdAppointment = await fixture.createOpdAppointment();

    const invoiceFirstCharge = await fixture.addCatalogCharge(
      invoiceFirstOpdAppointment.id,
      60_00n,
    );

    await locker.query("begin");
    await locker.query(`select id from charges where org_id = $1 and id = $2 for update`, [
      fixture.organization.id,
      invoiceFirstCharge.id,
    ]);

    const invoicePromise = settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: invoiceFirstOpdAppointment.id,
    });

    let invoiceBackendPid: number | undefined;

    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = await locker.query<{ pid: number }>(
        `select pid
         from pg_stat_activity
         where $1 = any(pg_blocking_pids(pid))
         limit 1`,
        [blockerPid],
      );

      invoiceBackendPid = blocked.rows[0]?.pid;

      if (invoiceBackendPid) break;
      await Bun.sleep(20);
    }

    expect(invoiceBackendPid).toBeDefined();

    if (!invoiceBackendPid) throw new Error("Expected invoice transaction backend pid");

    // The invoice transaction already holds the appointment lock, so cancellation
    // queues behind it — the reverse order of the case above.
    const cancellationPromise = fixture.api.opd.cancel({
      orgSlug: fixture.organization.slug,
      appointmentId: invoiceFirstOpdAppointment.id,
      reason: "Patient left after payment",
    });

    let cancellationQueuedBehindInvoice = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = await locker.query<{ blocked: boolean }>(
        `select exists (
           select 1
           from pg_stat_activity
           where $1 = any(pg_blocking_pids(pid))
         ) as blocked`,
        [invoiceBackendPid],
      );

      if (blocked.rows[0]?.blocked) {
        cancellationQueuedBehindInvoice = true;
        break;
      }

      await Bun.sleep(20);
    }

    expect(cancellationQueuedBehindInvoice).toBe(true);

    await locker.query("commit");
    await invoicePromise;
    await cancellationPromise;

    const cancelled = await fixture.api.opd.get({
      orgSlug: fixture.organization.slug,
      appointmentId: invoiceFirstOpdAppointment.id,
    });

    expect(cancelled.appointment.status).toBe("cancelled");
  } finally {
    await locker.query("rollback").catch(() => undefined);
    await locker.end();
  }
});

test("concurrent invoices allocate a gapless organization fiscal-year sequence", async () => {
  const fixture = await createBillingFixture("billing-numbering");

  const appointments = await Promise.all(
    Array.from({ length: 20 }, () => fixture.createOpdAppointment()),
  );

  await Promise.all(
    appointments.map((appointment, index) =>
      fixture.addCatalogCharge(
        appointment.id,
        BigInt(index + 1) * 100n,
        "0",
        `Concurrent charge ${index + 1}`,
      ),
    ),
  );

  const issued = await Promise.all(
    appointments.map((appointment) =>
      settlePendingCharges(fixture.api, {
        orgSlug: fixture.organization.slug,
        appointmentId: appointment.id,
      }),
    ),
  );

  const numbers = issued.map(({ invoice }) => invoice.invoiceNumber);
  expect(new Set(numbers).size).toBe(20);
  expect(
    numbers
      .map((number) => Number(number.slice(number.lastIndexOf("/") + 1)))
      .sort((left, right) => left - right),
  ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
});

test("members can charge, invoice, and pay but cannot issue credits or refunds", async () => {
  const fixture = await createBillingFixture("billing-member");
  const member = await createTestUser("billing-member-clerk");
  await joinOrganization(member, fixture.organization.id);
  const memberClient = clientFor(member);

  const item = await fixture.api.catalog.create({
    orgSlug: fixture.organization.slug,
    name: "Member-added service",
    code: `MEMBER-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 100_00n,
    taxRatePercent: "0",
  });

  const appointment = await fixture.createOpdAppointment([{ catalogItemId: item.id }]);

  const issued = await memberClient.billing.settleCharges({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    expectedChargeRevision: appointment.chargeRevision,
    expectedGrandTotal: 100_00n,
    payments: [{ method: "cash", amount: 100_00n }],
  });

  await expectORPCCode(
    memberClient.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: issued.invoice.id,
      reason: "Unauthorized adjustment",
      lines: [{ invoiceLineId: firstLineId(issued), gross: 10_00n }],
    }),
    "FORBIDDEN",
  );

  const note = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Owner adjustment",
    lines: [{ invoiceLineId: firstLineId(issued), gross: 10_00n }],
  });

  await expectORPCCode(
    memberClient.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: note.creditNote.id,
      method: "cash",
      amount: 10_00n,
    }),
    "FORBIDDEN",
  );
});

test("the billing worklist reports what is unbilled and sums what is open", async () => {
  const fixture = await createBillingFixture("billing-worklist");
  const { api, organization } = fixture;

  const unbilled = await fixture.createOpdAppointment();
  const unbilledCharge = await fixture.addCatalogCharge(unbilled.id, 150_00n);
  await db
    .update(charges)
    .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(and(eq(charges.orgId, organization.id), eq(charges.id, unbilledCharge.id)));

  const partPaid = await createInvoice(fixture, 400_00n);
  await api.billing.recordPayments({
    orgSlug: organization.slug,
    invoiceId: partPaid.invoice.id,
    payments: [{ method: "cash", amount: 100_00n }],
  });

  const settled = await createInvoice(fixture, 250_00n);
  await api.billing.recordPayments({
    orgSlug: organization.slug,
    invoiceId: settled.invoice.id,
    payments: [{ method: "cash", amount: 250_00n }],
  });

  const worklist = await api.billing.worklist({ orgSlug: organization.slug });

  expect(worklist.unbilled.map((row) => row.appointmentId)).toEqual([unbilled.id]);
  expect(worklist.unbilled[0]).toMatchObject({
    tokenNumber: unbilled.tokenNumber,
    chargeCount: 1,
    patientMrn: fixture.patient.mrn,
  });
  expect(worklist.unbilled[0]?.pendingValue).toBe(150_00n);

  expect(worklist.summary).toMatchObject({ toBillCount: 1, openCount: 1, staleCount: 0 });
  expect(worklist.summary.toBillTotal).toBe(150_00n);
  expect(worklist.summary.outstanding).toBe(300_00n);
  expect(worklist.summary.staleTotal).toBe(0n);
  expect(worklist.summary.collectedToday).toBe(350_00n);
  expect(worklist.summary.receiptCount).toBe(2);

  const open = await api.billing.openInvoices({ orgSlug: organization.slug });
  expect(open.items.map((row) => row.id)).toEqual([partPaid.invoice.id]);
  expect(open.items[0]).toMatchObject({
    appointmentId: partPaid.appointment.id,
    outstanding: 300_00n,
    paid: 100_00n,
  });
  expect(open.nextCursor).toBeNull();
});

test("the unbilled threshold hides fresh charges until they age into the worklist", async () => {
  const fixture = await createBillingFixture("billing-worklist-threshold");
  const appointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(appointment.id, 75_00n);

  expect(
    (await fixture.api.billing.worklist({ orgSlug: fixture.organization.slug })).unbilled,
  ).toEqual([]);

  await db
    .update(charges)
    .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(and(eq(charges.orgId, fixture.organization.id), eq(charges.id, charge.id)));

  const aged = await fixture.api.billing.worklist({ orgSlug: fixture.organization.slug });
  expect(aged.unbilled.map((row) => row.appointmentId)).toEqual([appointment.id]);
  expect(aged.hasMore).toBe(false);
  expect(aged.summary.toBillCount).toBe(1);
});

test("open invoices page on a cursor and can be narrowed to the overdue ones", async () => {
  const fixture = await createBillingFixture("billing-worklist-page");
  const { api, organization } = fixture;

  const first = await createInvoice(fixture, 100_00n);
  const second = await createInvoice(fixture, 200_00n);
  const third = await createInvoice(fixture, 300_00n);
  const paid = await createInvoice(fixture, 50_00n);
  await api.billing.recordPayments({
    orgSlug: organization.slug,
    invoiceId: paid.invoice.id,
    payments: [{ method: "cash", amount: 50_00n }],
  });

  const page = await api.billing.openInvoices({ orgSlug: organization.slug, limit: 2 });
  expect(page.items.map((row) => row.id)).toEqual([first.invoice.id, second.invoice.id]);
  expect(page.nextCursor).toBe(second.invoice.id);

  const rest = await api.billing.openInvoices({
    orgSlug: organization.slug,
    limit: 2,
    cursor: page.nextCursor ?? undefined,
  });

  expect(rest.items.map((row) => row.id)).toEqual([third.invoice.id]);
  expect(rest.nextCursor).toBeNull();

  await db
    .update(invoices)
    .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
    .where(eq(invoices.id, second.invoice.id));

  const overdue = await api.billing.openInvoices({
    orgSlug: organization.slug,
    overdueOnly: true,
  });

  expect(overdue.items.map((row) => row.id)).toEqual([second.invoice.id]);

  const searched = await api.billing.openInvoices({
    orgSlug: organization.slug,
    query: third.invoice.invoiceNumber,
  });

  expect(searched.items.map((row) => row.id)).toEqual([third.invoice.id]);

  const [percent, underscore] = await Promise.all([
    api.billing.openInvoices({ orgSlug: organization.slug, query: "%" }),
    api.billing.openInvoices({ orgSlug: organization.slug, query: "_" }),
  ]);

  expect(percent.items).toEqual([]);
  expect(underscore.items).toEqual([]);
});

test("a voided charge leaves the billing worklist", async () => {
  const fixture = await createBillingFixture("billing-worklist-void");
  const { api, organization } = fixture;
  const appointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(appointment.id, 90_00n);
  await db
    .update(charges)
    .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(and(eq(charges.orgId, organization.id), eq(charges.id, charge.id)));

  expect((await api.billing.worklist({ orgSlug: organization.slug })).unbilled).toHaveLength(1);

  await api.billing.voidCharge({
    orgSlug: organization.slug,
    chargeId: charge.id,
    reason: "Entered twice",
  });

  expect((await api.billing.worklist({ orgSlug: organization.slug })).unbilled).toHaveLength(0);
});
