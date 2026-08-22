import { beforeAll, expect, test } from "bun:test";
import pg from "pg";

import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { eq } from "drizzle-orm";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

function fiscalYearNow(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() + 1 >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function paise(value: string): number {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -result : result;
}

function firstLineId(result: { lines: Array<{ id: string }> }): string {
  const [line] = result.lines;
  if (!line) {
    throw new Error("expected at least one line");
  }
  return line.id;
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
  });
  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5553000",
    sex: "other",
    ageYears: 30,
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

  async function createOpdAppointment() {
    const created = await api.opd.createWalkIn({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      departmentId: department.id,
    });
    return created.appointment;
  }

  async function addCatalogCharge(
    appointmentId: string,
    unitPrice: string,
    taxRatePercent = "0",
    description = `${seed} Catalog Charge`,
  ) {
    const item = await api.catalog.create({
      orgSlug: organization.slug,
      name: description,
      code: `TEST-${crypto.randomUUID().slice(0, 8)}`,
      category: "other",
      unitPrice,
      taxRatePercent,
    });
    return api.billing.addCharge({
      orgSlug: organization.slug,
      appointmentId,
      catalogItemId: item.id,
    });
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
    unitPrice: string,
    taxRatePercent?: string,
    description?: string,
  ) => Promise<{ id: string }>;
};

async function createInvoice(fixture: InvoiceFixture, amount = "100.00", taxRatePercent = "0") {
  const appointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(appointment.id, amount, taxRatePercent);
  const issued = await fixture.api.billing.issueInvoice({
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
    code: `BILL-${crypto.randomUUID().slice(0, 8)}`,
    category: "procedure",
    unitPrice: "100.00",
    taxRatePercent: "18.00",
    taxCode: "GST18",
  });
  const catalogCharge = await api.billing.addCharge({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
    qty: 2,
    catalogItemId: item.id,
  });
  const supplyCharge = await fixture.addCatalogCharge(appointment.id, "50.00", "0", "Supply");

  const pending = await api.billing.listPendingCharges({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });
  expect(pending).toHaveLength(2);
  expect(pending.map((charge) => charge.id)).toEqual(
    expect.arrayContaining([catalogCharge.id, supplyCharge.id]),
  );

  const issued = await api.billing.issueInvoice({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });
  expect(issued.invoice.invoiceNumber).toBe(`INV${fiscalYearNow()}/1`);
  expect(issued.invoice).toMatchObject({
    subtotal: "250.00",
    taxTotal: "36.00",
    grandTotal: "286.00",
  });
  expect(paise(issued.invoice.subtotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.lineSubtotal), 0),
  );
  expect(paise(issued.invoice.taxTotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.taxAmount), 0),
  );
  expect(paise(issued.invoice.grandTotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.gross), 0),
  );
  expect(
    await api.billing.listPendingCharges({
      orgSlug: organization.slug,
      appointmentId: appointment.id,
    }),
  ).toEqual([]);
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

  const payment = await api.billing.recordPayment({
    orgSlug: organization.slug,
    invoiceId: issued.invoice.id,
    method: "card",
    amount: issued.invoice.grandTotal,
    reference: "CARD-HAPPY",
  });
  expect(payment.receiptNumber).toBe(`RCT${fiscalYearNow()}/1`);
  expect(
    await api.billing.invoiceBalance({
      orgSlug: organization.slug,
      invoiceId: issued.invoice.id,
    }),
  ).toEqual({
    grandTotal: issued.invoice.grandTotal,
    creditTotal: "0.00",
    paymentsTotal: issued.invoice.grandTotal,
    refundsTotal: "0.00",
    outstanding: "0.00",
  });
  const listed = await api.billing.listInvoices({
    orgSlug: organization.slug,
    appointmentId: appointment.id,
  });
  expect(listed).toEqual([expect.objectContaining({ id: issued.invoice.id, outstanding: "0.00" })]);
  const detail = await api.billing.getInvoice({
    orgSlug: organization.slug,
    invoiceId: issued.invoice.id,
  });
  expect(detail.lines).toHaveLength(2);
  expect(detail.payments.map((row) => row.id)).toEqual([payment.id]);
  expect(detail.balance.outstanding).toBe("0.00");

  const invoiceAudit = await expectAudit(
    api,
    organization.slug,
    "invoice.issue",
    `invoice:${issued.invoice.id}`,
  );
  expect(invoiceAudit?.meta).toMatchObject({
    invoiceNumber: issued.invoice.invoiceNumber,
    grandTotal: issued.invoice.grandTotal,
  });
  const paymentAudit = await expectAudit(
    api,
    organization.slug,
    "payment.record",
    `payment:${payment.id}`,
  );
  expect(paymentAudit?.meta).toMatchObject({
    receiptNumber: payment.receiptNumber,
    amount: payment.amount,
  });
});

test("concurrent invoice issuance has one winner and leaves no charges for re-issue", async () => {
  const fixture = await createBillingFixture("billing-race");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, "100.00");
  const input = { orgSlug: fixture.organization.slug, appointmentId: appointment.id };

  const results = await Promise.allSettled([
    fixture.api.billing.issueInvoice(input),
    fixture.api.billing.issueInvoice(input),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("CONFLICT");
  await expectORPCCode(fixture.api.billing.issueInvoice(input), "CONFLICT");
});

test("zero pending charges conflict and voided charges are excluded from issuance", async () => {
  const fixture = await createBillingFixture("billing-empty");
  const emptyOpdAppointment = await fixture.createOpdAppointment();
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: emptyOpdAppointment.id,
    }),
    "CONFLICT",
  );

  const voidedOpdAppointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(voidedOpdAppointment.id, "25.00");
  await fixture.api.billing.voidCharge({
    orgSlug: fixture.organization.slug,
    chargeId: charge.id,
    reason: "Entered in error",
  });
  expect(
    await fixture.api.billing.listPendingCharges({
      orgSlug: fixture.organization.slug,
      appointmentId: voidedOpdAppointment.id,
    }),
  ).toEqual([]);
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: voidedOpdAppointment.id,
    }),
    "CONFLICT",
  );
});

test("charges and invoices are rejected before check-in and after a no-show", async () => {
  const fixture = await createBillingFixture("billing-pre-arrival");
  const booked = await fixture.api.opd.book({
    orgSlug: fixture.organization.slug,
    patientId: fixture.patient.id,
    practitionerId: fixture.practitioner.id,
    departmentId: fixture.department.id,
    scheduledLocal: "2030-06-01T10:00",
  });

  await expectORPCCode(fixture.addCatalogCharge(booked.id, "100.00"), "CONFLICT");
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: booked.id,
    }),
    "CONFLICT",
  );

  await fixture.api.opd.markNoShow({
    orgSlug: fixture.organization.slug,
    appointmentId: booked.id,
  });
  await expectORPCCode(fixture.addCatalogCharge(booked.id, "100.00"), "CONFLICT");
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: booked.id,
    }),
    "CONFLICT",
  );
});

test("voiding distinguishes unknown and invoiced charges and records its reason and audit", async () => {
  const fixture = await createBillingFixture("billing-void");
  const successfulOpdAppointment = await fixture.createOpdAppointment();
  const pending = await fixture.addCatalogCharge(successfulOpdAppointment.id, "25.00");
  const voided = await fixture.api.billing.voidCharge({
    orgSlug: fixture.organization.slug,
    chargeId: pending.id,
    reason: "Duplicate entry",
  });
  expect(voided).toMatchObject({ status: "voided", voidReason: "Duplicate entry" });
  const audit = await expectAudit(
    fixture.api,
    fixture.organization.slug,
    "charge.void",
    `charge:${pending.id}`,
  );
  expect(audit?.meta).toMatchObject({ reason: "Duplicate entry" });

  const invoiced = await createInvoice(fixture, "30.00");
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
      chargeId: crypto.randomUUID(),
      reason: "Unknown",
    }),
    "NOT_FOUND",
  );
});

test("partial payments follow outstanding and credit-adjusted caps", async () => {
  const fixture = await createBillingFixture("billing-payments");
  const first = await createInvoice(fixture);
  const paymentOne = await fixture.api.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    method: "cash",
    amount: "40.00",
  });
  const paymentTwo = await fixture.api.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    method: "upi",
    amount: "60.00",
    reference: "UPI-PARTIAL",
  });
  expect([paymentOne.receiptNumber, paymentTwo.receiptNumber]).toEqual([
    `RCT${fiscalYearNow()}/1`,
    `RCT${fiscalYearNow()}/2`,
  ]);
  await expectORPCCode(
    fixture.api.billing.recordPayment({
      orgSlug: fixture.organization.slug,
      invoiceId: first.invoice.id,
      method: "cash",
      amount: "1.00",
    }),
    "CONFLICT",
  );

  const second = await createInvoice(fixture);
  await expectORPCCode(
    fixture.api.billing.recordPayment({
      orgSlug: fixture.organization.slug,
      invoiceId: second.invoice.id,
      method: "cash",
      amount: "101.00",
    }),
    "CONFLICT",
  );
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Price adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: "80.00" }],
  });
  await expectORPCCode(
    fixture.api.billing.recordPayment({
      orgSlug: fixture.organization.slug,
      invoiceId: second.invoice.id,
      method: "cash",
      amount: "30.00",
    }),
    "CONFLICT",
  );
  await fixture.api.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    method: "cash",
    amount: "20.00",
  });
  expect(
    (
      await fixture.api.billing.invoiceBalance({
        orgSlug: fixture.organization.slug,
        invoiceId: second.invoice.id,
      })
    ).outstanding,
  ).toBe("0.00");
});

test("discount allocation, multi-rate totals, and partial credit tax extraction are exact", async () => {
  const fixture = await createBillingFixture("billing-discount");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(appointment.id, "100.00", "0", "Zero-rated Service");
  await fixture.addCatalogCharge(appointment.id, "200.00", "18.00", "Taxable Service");
  const issued = await fixture.api.billing.issueInvoice({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    discountAmount: "30.00",
    discountReason: "Package discount",
  });
  expect(issued.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ description: "Zero-rated Service", allocatedDiscount: "10.00" }),
      expect.objectContaining({ description: "Taxable Service", allocatedDiscount: "20.00" }),
    ]),
  );
  expect(issued.lines.reduce((sum, line) => sum + paise(line.allocatedDiscount), 0)).toBe(3000);
  expect(issued.invoice).toMatchObject({
    subtotal: "300.00",
    taxTotal: "32.40",
    grandTotal: "302.40",
  });
  expect(paise(issued.invoice.subtotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.lineSubtotal), 0),
  );
  expect(paise(issued.invoice.taxTotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.taxAmount), 0),
  );
  expect(paise(issued.invoice.grandTotal)).toBe(
    issued.lines.reduce((sum, line) => sum + paise(line.gross), 0),
  );

  const taxableLine = issued.lines.find((line) => line.taxRatePercent === "18.00");
  if (!taxableLine) {
    throw new Error("issued invoice did not include its 18% line");
  }
  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial service reversal",
    lines: [{ invoiceLineId: taxableLine.id, gross: "59.00" }],
  });
  expect(credited.creditNote.creditNoteNumber).toBe(`CN${fiscalYearNow()}/1`);
  expect(credited.lines[0]).toMatchObject({
    taxableValue: "50.00",
    taxAmount: "9.00",
    gross: "59.00",
  });
  const creditDetail = await fixture.api.billing.getInvoice({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
  });
  expect(creditDetail.creditNotes).toEqual([
    expect.objectContaining({
      id: credited.creditNote.id,
      lines: [expect.objectContaining({ id: firstLineId(credited), gross: "59.00" })],
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

  const missingReasonOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(missingReasonOpdAppointment.id, "100.00");
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: missingReasonOpdAppointment.id,
      discountAmount: "1.00",
    }),
    "BAD_REQUEST",
  );
  const excessiveOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(excessiveOpdAppointment.id, "300.00");
  await expectORPCCode(
    fixture.api.billing.issueInvoice({
      orgSlug: fixture.organization.slug,
      appointmentId: excessiveOpdAppointment.id,
      discountAmount: "400.00",
      discountReason: "Impossible discount",
    }),
    "BAD_REQUEST",
  );
});

test("credit notes enforce duplicate, full-line, partial-line, and invoice caps", async () => {
  const fixture = await createBillingFixture("billing-credit-caps");

  const full = await createInvoice(fixture);
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
    "CONFLICT",
  );

  const partial = await createInvoice(fixture);
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: partial.invoice.id,
      reason: "Duplicate input",
      lines: [
        { invoiceLineId: firstLineId(partial), gross: "10.00" },
        { invoiceLineId: firstLineId(partial), gross: "10.00" },
      ],
    }),
    "BAD_REQUEST",
  );
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: partial.invoice.id,
    reason: "First partial",
    lines: [{ invoiceLineId: firstLineId(partial), gross: "60.00" }],
  });
  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: partial.invoice.id,
      reason: "Over cap",
      lines: [{ invoiceLineId: firstLineId(partial), gross: "50.00" }],
    }),
    "CONFLICT",
  );

  const allOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(allOpdAppointment.id, "100.00", "0", "Line One");
  await fixture.addCatalogCharge(allOpdAppointment.id, "100.00", "18.00", "Line Two");
  const all = await fixture.api.billing.issueInvoice({
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
  const balance = await fixture.api.billing.invoiceBalance({
    orgSlug: fixture.organization.slug,
    invoiceId: all.invoice.id,
  });
  expect(balance.creditTotal).toBe(balance.grandTotal);
});

test("refunds are bounded by refund due and by the selected credit note", async () => {
  const fixture = await createBillingFixture("billing-refunds");
  const first = await createInvoice(fixture);
  await fixture.api.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    method: "cash",
    amount: "50.00",
  });
  const credit = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: first.invoice.id,
    reason: "Large adjustment",
    lines: [{ invoiceLineId: firstLineId(first), gross: "80.00" }],
  });
  expect(
    (
      await fixture.api.billing.invoiceBalance({
        orgSlug: fixture.organization.slug,
        invoiceId: first.invoice.id,
      })
    ).outstanding,
  ).toBe("-30.00");
  await expectORPCCode(
    fixture.api.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: credit.creditNote.id,
      method: "cash",
      amount: "50.00",
    }),
    "CONFLICT",
  );
  const refund = await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credit.creditNote.id,
    method: "cash",
    amount: "30.00",
  });
  expect(refund.refundNumber).toBe(`RF${fiscalYearNow()}/1`);
  expect(
    (
      await fixture.api.billing.invoiceBalance({
        orgSlug: fixture.organization.slug,
        invoiceId: first.invoice.id,
      })
    ).outstanding,
  ).toBe("0.00");
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
  await fixture.api.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    method: "card",
    amount: "100.00",
  });
  const smallNote = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Small adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: "10.00" }],
  });
  await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: second.invoice.id,
    reason: "Large adjustment",
    lines: [{ invoiceLineId: firstLineId(second), gross: "70.00" }],
  });
  await expectORPCCode(
    fixture.api.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: smallNote.creditNote.id,
      method: "cash",
      amount: "40.00",
    }),
    "CONFLICT",
  );
  await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: smallNote.creditNote.id,
    method: "cash",
    amount: "10.00",
  });
});

test("charge creation and invoice issuance cannot cross a concurrent appointment cancellation", async () => {
  const fixture = await createBillingFixture("billing-cancel-race");
  const appointment = await fixture.createOpdAppointment();
  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();

  try {
    await locker.query("begin");
    await locker.query(
      `update opd_appointments
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Concurrent cancellation'
       where org_id = $1 and id = $2`,
      [fixture.organization.id, appointment.id],
    );
    const blockerPid = (await locker.query<{ pid: number }>("select pg_backend_pid() as pid"))
      .rows[0]?.pid;
    if (!blockerPid) throw new Error("Expected cancellation transaction backend pid");

    let earlyOutcome:
      | { value: Awaited<ReturnType<typeof fixture.addCatalogCharge>>; error: undefined }
      | { value: undefined; error: unknown }
      | undefined;
    const outcomePromise = fixture.addCatalogCharge(appointment.id, "100.00").then(
      (value) => (earlyOutcome = { value, error: undefined }),
      (error: unknown) => (earlyOutcome = { value: undefined, error }),
    );

    let reachedOpdAppointmentLock = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = await locker.query<{ blocked: boolean }>(
        `select exists (
           select 1
           from pg_stat_activity
           where $1 = any(pg_blocking_pids(pid))
         ) as blocked`,
        [blockerPid],
      );
      if (blocked.rows[0]?.blocked) {
        reachedOpdAppointmentLock = true;
        break;
      }
      if (earlyOutcome) break;
      await Bun.sleep(20);
    }
    expect(reachedOpdAppointmentLock || earlyOutcome !== undefined).toBe(true);

    await locker.query("commit");
    const outcome = await outcomePromise;
    expect((outcome.error as { code?: string } | undefined)?.code).toBe("CONFLICT");
    expect(outcome.value).toBeUndefined();
    expect(
      await fixture.api.billing.listPendingCharges({
        orgSlug: fixture.organization.slug,
        appointmentId: appointment.id,
      }),
    ).toHaveLength(0);

    const cancelledOpdAppointmentWithPendingCharge = await fixture.createOpdAppointment();
    await fixture.addCatalogCharge(cancelledOpdAppointmentWithPendingCharge.id, "75.00");
    await locker.query(
      `update opd_appointments
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Imported state'
       where org_id = $1 and id = $2`,
      [fixture.organization.id, cancelledOpdAppointmentWithPendingCharge.id],
    );
    await expectORPCCode(
      fixture.api.billing.issueInvoice({
        orgSlug: fixture.organization.slug,
        appointmentId: cancelledOpdAppointmentWithPendingCharge.id,
      }),
      "CONFLICT",
    );

    const invoiceFirstOpdAppointment = await fixture.createOpdAppointment();
    const invoiceFirstCharge = await fixture.addCatalogCharge(
      invoiceFirstOpdAppointment.id,
      "60.00",
    );
    await locker.query("begin");
    await locker.query(`select id from charges where org_id = $1 and id = $2 for update`, [
      fixture.organization.id,
      invoiceFirstCharge.id,
    ]);

    const invoicePromise = fixture.api.billing.issueInvoice({
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

    // The invoice transaction already owns the appointment lock and is paused on the
    // charge. Cancellation therefore queues behind the invoice, exercising the
    // reverse order of the cancellation-first case above.
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
        `${index + 1}.00`,
        "0",
        `Concurrent charge ${index + 1}`,
      ),
    ),
  );
  const issued = await Promise.all(
    appointments.map((appointment) =>
      fixture.api.billing.issueInvoice({
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
  const appointment = await fixture.createOpdAppointment();
  const item = await fixture.api.catalog.create({
    orgSlug: fixture.organization.slug,
    name: "Member-added service",
    code: `MEMBER-${crypto.randomUUID().slice(0, 8)}`,
    category: "other",
    unitPrice: "100.00",
    taxRatePercent: "0",
  });
  await memberClient.billing.addCharge({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    catalogItemId: item.id,
  });
  const issued = await memberClient.billing.issueInvoice({
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });
  await memberClient.billing.recordPayment({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    method: "cash",
    amount: "100.00",
  });
  await expectORPCCode(
    memberClient.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: issued.invoice.id,
      reason: "Unauthorized adjustment",
      lines: [{ invoiceLineId: firstLineId(issued), gross: "10.00" }],
    }),
    "FORBIDDEN",
  );
  const note = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Owner adjustment",
    lines: [{ invoiceLineId: firstLineId(issued), gross: "10.00" }],
  });
  await expectORPCCode(
    memberClient.billing.recordRefund({
      orgSlug: fixture.organization.slug,
      creditNoteId: note.creditNote.id,
      method: "cash",
      amount: "10.00",
    }),
    "FORBIDDEN",
  );
});

test("the billing worklist separates unbilled charges from unpaid invoices", async () => {
  const fixture = await createBillingFixture("billing-worklist");
  const { api, organization } = fixture;

  // One encounter that has a charge and no invoice.
  const unbilled = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(unbilled.id, "150.00");

  // One invoiced encounter, part-paid, so it is still owed.
  const partPaid = await createInvoice(fixture, "400.00");
  await api.billing.recordPayment({
    orgSlug: organization.slug,
    invoiceId: partPaid.invoice.id,
    method: "cash",
    amount: "100.00",
  });

  // One invoiced encounter settled in full, which must appear in neither list.
  const settled = await createInvoice(fixture, "250.00");
  await api.billing.recordPayment({
    orgSlug: organization.slug,
    invoiceId: settled.invoice.id,
    method: "cash",
    amount: "250.00",
  });

  const worklist = await api.billing.worklist({ orgSlug: organization.slug });

  expect(worklist.currency).toBe("INR");
  expect(worklist.unbilled.map((row) => row.appointmentId)).toEqual([unbilled.id]);
  expect(worklist.unbilled[0]).toMatchObject({
    tokenNumber: unbilled.tokenNumber,
    chargeCount: 1,
    patientMrn: fixture.patient.mrn,
  });
  expect(Number(worklist.unbilled[0]?.pendingValue)).toBe(150);

  expect(worklist.unpaid.map((row) => row.id)).toEqual([partPaid.invoice.id]);
  expect(worklist.unpaid[0]).toMatchObject({
    appointmentId: partPaid.appointment.id,
    currency: "INR",
    outstanding: "300.00",
    paid: "100.00",
  });
});

test("the billing worklist filters before its oldest-first cap", async () => {
  const fixture = await createBillingFixture("billing-worklist-cap");
  const { api, organization } = fixture;

  const unbilledNewest = await fixture.createOpdAppointment();
  const newestCharge = await fixture.addCatalogCharge(unbilledNewest.id, "300.00");
  const unbilledOldest = await fixture.createOpdAppointment();
  const oldestCharge = await fixture.addCatalogCharge(unbilledOldest.id, "100.00");
  const unbilledMiddle = await fixture.createOpdAppointment();
  const middleCharge = await fixture.addCatalogCharge(unbilledMiddle.id, "200.00");

  await Promise.all([
    db
      .update(charges)
      .set({ createdAt: new Date("2026-01-03T00:00:00.000Z") })
      .where(eq(charges.id, newestCharge.id)),
    db
      .update(charges)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(charges.id, oldestCharge.id)),
    db
      .update(charges)
      .set({ createdAt: new Date("2026-01-02T00:00:00.000Z") })
      .where(eq(charges.id, middleCharge.id)),
  ]);

  const settledOldest = await createInvoice(fixture, "50.00");
  const unpaidMiddle = await createInvoice(fixture, "200.00");
  const unpaidNewest = await createInvoice(fixture, "300.00");
  const unpaidOldest = await createInvoice(fixture, "100.00");

  await api.billing.recordPayment({
    orgSlug: organization.slug,
    invoiceId: settledOldest.invoice.id,
    method: "cash",
    amount: "50.00",
  });
  await Promise.all([
    db
      .update(invoices)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(invoices.id, settledOldest.invoice.id)),
    db
      .update(invoices)
      .set({ createdAt: new Date("2026-01-03T00:00:00.000Z") })
      .where(eq(invoices.id, unpaidMiddle.invoice.id)),
    db
      .update(invoices)
      .set({ createdAt: new Date("2026-01-04T00:00:00.000Z") })
      .where(eq(invoices.id, unpaidNewest.invoice.id)),
    db
      .update(invoices)
      .set({ createdAt: new Date("2026-01-02T00:00:00.000Z") })
      .where(eq(invoices.id, unpaidOldest.invoice.id)),
  ]);

  const worklist = await api.billing.worklist({ orgSlug: organization.slug, limit: 2 });

  expect(worklist.unbilled.map((row) => row.appointmentId)).toEqual([
    unbilledOldest.id,
    unbilledMiddle.id,
  ]);
  expect(worklist.unpaid.map((row) => row.id)).toEqual([
    unpaidOldest.invoice.id,
    unpaidMiddle.invoice.id,
  ]);
});

test("a voided charge leaves the billing worklist", async () => {
  const fixture = await createBillingFixture("billing-worklist-void");
  const { api, organization } = fixture;
  const appointment = await fixture.createOpdAppointment();
  const charge = await fixture.addCatalogCharge(appointment.id, "90.00");

  expect((await api.billing.worklist({ orgSlug: organization.slug })).unbilled).toHaveLength(1);

  await api.billing.voidCharge({
    orgSlug: organization.slug,
    chargeId: charge.id,
    reason: "Entered twice",
  });

  expect((await api.billing.worklist({ orgSlug: organization.slug })).unbilled).toHaveLength(0);
});
