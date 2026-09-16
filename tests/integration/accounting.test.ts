import { beforeAll, expect, test } from "bun:test";

import { businessDate } from "@hms/api/lib/business-date";
import { invoiceBalanceFor } from "@hms/api/lib/invoice-balance";
import { postJournalEntry } from "@hms/api/lib/ledger";
import type { AppRouterClient } from "@hms/api/routers/index";

import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { addPendingCatalogCharge, settlePendingCharges } from "../support/billing";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const REPORT_TIME_ZONE = "Asia/Kolkata";

function reportDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00+05:30`);

  return reportDate(new Date(instant.getTime() + days * 86_400_000));
}

function sumMoney(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

type AccountingFixture = {
  organization: { id: string; slug: string };
  api: AppRouterClient;
  patient: { id: string; name: string; mrn: string };
  createOpdAppointment: () => Promise<{ id: string }>;
  addOtherCharge: (
    appointmentId: string,
    unitPrice: bigint,
    taxRatePercent?: string,
    description?: string,
    taxCode?: string,
  ) => Promise<object>;
  addCatalogCharge: (
    appointmentId: string,
    options: {
      name: string;
      category: "consultation" | "procedure" | "lab" | "radiology" | "other";
      unitPrice: bigint;
      taxRatePercent: string;
      taxCode?: string;
    },
  ) => Promise<{
    item: { id: string };
    charge: { sourceType: string; revenueCategory: string };
  }>;
  createConsultationAppointment: (options: {
    name: string;
    unitPrice: bigint;
    taxRatePercent: string;
    taxCode?: string;
  }) => Promise<{ appointment: { id: string }; item: { id: string } }>;
};

async function createAccountingFixture(seed: string, timeZone = "Asia/Kolkata") {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);
  await api.settings.update({
    orgSlug: organization.slug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "GSTIN-TEST",
    currency: "INR",
    timeZone,
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 24,
  });

  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5553800",
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

  async function createOpdAppointment() {
    const booked = await api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      scheduledLocal: "2030-03-15T10:30",
    });

    return (
      await api.opd.checkIn({
        orgSlug: organization.slug,
        appointmentId: booked.id,
      })
    ).appointment;
  }

  async function addOtherCharge(
    appointmentId: string,
    unitPrice: bigint,
    taxRatePercent = "0",
    description = `${seed} Other Charge`,
    taxCode?: string,
  ) {
    const item = await api.catalog.create({
      orgSlug: organization.slug,
      name: description,
      code: `ACCT-${uniqueSuffix().toUpperCase()}`,
      category: "other",
      unitPrice,
      taxRatePercent,
      taxCode,
    });

    const charge = await addPendingCatalogCharge({
      orgId: organization.id,
      userId: owner.user.id,
      appointmentId,
      catalogItemId: item.id,
    });

    return charge;
  }

  async function createConsultationAppointment(options: {
    name: string;
    unitPrice: bigint;
    taxRatePercent: string;
    taxCode?: string;
  }) {
    const item = await api.catalog.create({
      orgSlug: organization.slug,
      name: options.name,
      code: `ACCT-${uniqueSuffix().toUpperCase()}`,
      category: "consultation",
      unitPrice: options.unitPrice,
      taxRatePercent: options.taxRatePercent,
      taxCode: options.taxCode,
    });

    const consultant = await api.staff.createPractitioner({
      orgSlug: organization.slug,
      name: `Dr. ${options.name}`,
      departmentId: department.id,
      consultFeeItemId: item.id,
    });

    const booked = await api.opd.book({
      orgSlug: organization.slug,
      patientId: patient.id,
      practitionerId: consultant.id,
      scheduledLocal: "2030-03-15T10:30",
    });

    const checkedIn = await api.opd.checkIn({
      orgSlug: organization.slug,
      appointmentId: booked.id,
    });

    return { appointment: checkedIn.appointment, item };
  }

  async function addCatalogCharge(
    appointmentId: string,
    options: {
      name: string;
      category: "consultation" | "procedure" | "lab" | "radiology" | "other";
      unitPrice: bigint;
      taxRatePercent: string;
      taxCode?: string;
    },
  ) {
    const item = await api.catalog.create({
      orgSlug: organization.slug,
      name: options.name,
      code: `ACCT-${uniqueSuffix().toUpperCase()}`,
      category: options.category,
      unitPrice: options.unitPrice,
      taxRatePercent: options.taxRatePercent,
      taxCode: options.taxCode,
    });

    const charge = await addPendingCatalogCharge({
      orgId: organization.id,
      userId: owner.user.id,
      appointmentId,
      catalogItemId: item.id,
    });

    return { item, charge };
  }

  return {
    owner,
    organization,
    api,
    patient,
    createOpdAppointment,
    addOtherCharge,
    addCatalogCharge,
    createConsultationAppointment,
  };
}

test("dashboard collection trend labels the organization's Business Dates", async () => {
  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10);

  // These fixed-offset extremes never share a calendar date.
  const timeZone = ["Pacific/Kiritimati", "Etc/GMT+12"].find(
    (candidate) => businessDate(now, candidate) !== utcDate,
  );

  if (!timeZone) {
    throw new Error("Expected an extreme time zone to differ from the UTC date");
  }

  const fixture = await createAccountingFixture("dashboard-business-date", timeZone);

  const collections = await fixture.api.dashboard.collections({
    orgSlug: fixture.organization.slug,
  });

  expect(collections.trend).toHaveLength(14);
  expect(collections.trend.at(-1)?.day).toBe(businessDate(new Date(), timeZone));
});

async function journalFor(fixture: AccountingFixture, sourceType: string, sourceId: string) {
  const entries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, fixture.organization.id),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );

  if (entries.length !== 1) {
    return { entries, lines: [] };
  }

  const lines = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(
      accounts,
      and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, fixture.organization.id)),
    )
    .where(
      and(
        eq(journalLines.orgId, fixture.organization.id),
        eq(journalLines.entryId, entries[0]!.id),
      ),
    );

  return { entries, lines };
}

function expectBalanced(lines: Array<{ debit: bigint; credit: bigint }>) {
  expect(sumMoney(lines.map((line) => line.debit))).toBe(
    sumMoney(lines.map((line) => line.credit)),
  );
}

function lineByCode(lines: Array<{ code: string; debit: bigint; credit: bigint }>, code: string) {
  const line = lines.find((candidate) => candidate.code === code);

  if (!line) {
    throw new Error(`expected journal line for account ${code}`);
  }

  return line;
}

async function issueConsultationInvoice(fixture: AccountingFixture, seed: string) {
  const { appointment } = await fixture.createConsultationAppointment({
    name: `${seed} Consultation`,
    unitPrice: 100_00n,
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  return { appointment, ...issued };
}

test("issuing an invoice posts one balanced entry split across receivables, revenue, and GST", async () => {
  const fixture = await createAccountingFixture("accounting-invoice");

  const { appointment } = await fixture.createConsultationAppointment({
    name: "Taxable Consultation",
    unitPrice: 100_00n,
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });

  await fixture.addOtherCharge(appointment.id, 50_00n, "0", "Other Service");

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  expect(issued.invoice).toMatchObject({
    subtotal: 150_00n,
    taxTotal: 18_00n,
    grandTotal: 168_00n,
  });

  const journal = await journalFor(fixture, "invoice", issued.invoice.id);
  expect(journal.entries).toHaveLength(1);
  expect(journal.lines).toHaveLength(4);
  expectBalanced(journal.lines);
  expect(lineByCode(journal.lines, "1200")).toMatchObject({
    debit: issued.invoice.grandTotal,
    credit: 0n,
  });
  expect(lineByCode(journal.lines, "4100")).toMatchObject({
    debit: 0n,
    credit: 100_00n,
  });
  expect(lineByCode(journal.lines, "4900")).toMatchObject({
    debit: 0n,
    credit: 50_00n,
  });
  expect(lineByCode(journal.lines, "2100")).toMatchObject({
    debit: 0n,
    credit: issued.invoice.taxTotal,
  });
});

test("a desk-added consultation charge posts to consultation revenue", async () => {
  const fixture = await createAccountingFixture("accounting-desk-consultation");
  const appointment = await fixture.createOpdAppointment();

  const { charge } = await fixture.addCatalogCharge(appointment.id, {
    name: "Desk Consultation",
    category: "consultation",
    unitPrice: 75_00n,
    taxRatePercent: "0",
  });

  expect(charge).toMatchObject({
    sourceType: "catalog",
    revenueCategory: "consultation",
  });

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  const journal = await journalFor(fixture, "invoice", issued.invoice.id);
  expect(lineByCode(journal.lines, "4100")).toMatchObject({
    debit: 0n,
    credit: 75_00n,
  });
  expect(journal.lines.map((line) => line.code)).not.toContain("4900");
  expectBalanced(journal.lines);
});

test("zero-rated invoices omit GST and zero-total invoices do not post", async () => {
  const fixture = await createAccountingFixture("accounting-zero");
  const zeroRateOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(zeroRateOpdAppointment.id, 25_00n, "0", "Zero-rated Service");

  const zeroRate = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: zeroRateOpdAppointment.id,
  });

  const zeroRateJournal = await journalFor(fixture, "invoice", zeroRate.invoice.id);
  expect(zeroRateJournal.entries).toHaveLength(1);
  expect(zeroRateJournal.lines.map((line) => line.code)).not.toContain("2100");
  expect(lineByCode(zeroRateJournal.lines, "1200").debit).toBe(25_00n);
  expect(lineByCode(zeroRateJournal.lines, "4900").credit).toBe(25_00n);
  expectBalanced(zeroRateJournal.lines);

  const zeroTotalOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(zeroTotalOpdAppointment.id, 0n, "0", "No-charge Service");

  const zeroTotal = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: zeroTotalOpdAppointment.id,
  });

  expect(zeroTotal.invoice.grandTotal).toBe(0n);
  expect((await journalFor(fixture, "invoice", zeroTotal.invoice.id)).entries).toHaveLength(0);
});

test("payments, credits, and refunds post exactly and reconcile in the OPD register", async () => {
  const fixture = await createAccountingFixture("accounting-settlement");
  const issued = await issueConsultationInvoice(fixture, "Settlement");
  await expectORPCCode(
    fixture.api.billing.recordPayments({
      orgSlug: fixture.organization.slug,
      invoiceId: issued.invoice.id,
      payments: [{ method: "bank", amount: 18_00n }],
    }),
    "BAD_REQUEST",
  );

  const [cash] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "cash", amount: 100_00n }],
  });

  const [bank] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "bank", amount: 18_00n, reference: "BANK-LEDGER" }],
  });

  if (!cash || !bank) throw new Error("expected both payments");

  const cashJournal = await journalFor(fixture, "payment", cash.id);
  expect(cashJournal.entries).toHaveLength(1);
  expect(lineByCode(cashJournal.lines, "1000")).toMatchObject({ debit: 100_00n, credit: 0n });
  expect(lineByCode(cashJournal.lines, "1200")).toMatchObject({ debit: 0n, credit: 100_00n });
  expectBalanced(cashJournal.lines);

  const bankJournal = await journalFor(fixture, "payment", bank.id);
  expect(bankJournal.entries).toHaveLength(1);
  expect(lineByCode(bankJournal.lines, "1100")).toMatchObject({ debit: 18_00n, credit: 0n });
  expect(lineByCode(bankJournal.lines, "1200")).toMatchObject({ debit: 0n, credit: 18_00n });
  expectBalanced(bankJournal.lines);

  const collections = await fixture.api.dashboard.collections({
    orgSlug: fixture.organization.slug,
  });

  expect(collections.collected).toBe(118_00n);
  expect(collections.byMethod).toEqual([
    { method: "cash", amount: 100_00n },
    { method: "bank", amount: 18_00n },
  ]);

  const [invoiceLine] = issued.lines;

  if (!invoiceLine) {
    throw new Error("expected an invoice line");
  }

  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial reversal",
    lines: [{ invoiceLineId: invoiceLine.id, gross: 59_00n }],
  });

  const creditJournal = await journalFor(fixture, "credit_note", credited.creditNote.id);
  expect(creditJournal.entries).toHaveLength(1);
  expect(lineByCode(creditJournal.lines, "4100")).toMatchObject({ debit: 50_00n, credit: 0n });
  expect(lineByCode(creditJournal.lines, "2100")).toMatchObject({ debit: 9_00n, credit: 0n });
  expect(lineByCode(creditJournal.lines, "1200")).toMatchObject({ debit: 0n, credit: 59_00n });
  expectBalanced(creditJournal.lines);

  const refund = await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credited.creditNote.id,
    method: "upi",
    amount: 59_00n,
    reference: "UPI-REFUND-LEDGER",
  });

  const refundJournal = await journalFor(fixture, "refund", refund.id);
  expect(refundJournal.entries).toHaveLength(1);
  expect(lineByCode(refundJournal.lines, "1200")).toMatchObject({ debit: 59_00n, credit: 0n });
  expect(lineByCode(refundJournal.lines, "1100")).toMatchObject({ debit: 0n, credit: 59_00n });
  expectBalanced(refundJournal.lines);

  const refundedCollections = await fixture.api.dashboard.collections({
    orgSlug: fixture.organization.slug,
  });

  expect(refundedCollections.collected).toBe(59_00n);

  const worklist = await fixture.api.billing.worklist({ orgSlug: fixture.organization.slug });

  expect(worklist.summary.collectedToday).toBe(59_00n);

  const { appointment } = await fixture.api.opd.get({
    orgSlug: fixture.organization.slug,
    appointmentId: issued.appointment.id,
  });

  const register = await fixture.api.report.opdRegister({
    orgSlug: fixture.organization.slug,
    from: appointment.businessDate,
    to: appointment.businessDate,
  });

  expect(register.rows).toHaveLength(1);
  expect(register.rows[0]).toMatchObject({
    appointmentId: appointment.id,
    billed: 118_00n,
    paid: 118_00n,
    credits: 59_00n,
    refunds: 59_00n,
    outstanding: 0n,
  });
  expect(register.totals).toMatchObject({
    billed: 118_00n,
    paid: 118_00n,
    credits: 59_00n,
    refunds: 59_00n,
    outstanding: 0n,
  });
});

test("daily collections nets payments and refunds by Business Date and method", async () => {
  const fixture = await createAccountingFixture("accounting-daily-collections");
  const issued = await issueConsultationInvoice(fixture, "Daily Collections");
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [
      { method: "cash", amount: 70_00n },
      { method: "upi", amount: 48_00n, reference: "UPI-COLLECTIONS" },
    ],
  });
  const [invoiceLine] = issued.lines;

  if (!invoiceLine) throw new Error("expected an invoice line");

  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial collection reversal",
    lines: [{ invoiceLineId: invoiceLine.id, gross: 20_00n }],
  });

  await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credited.creditNote.id,
    method: "cash",
    amount: 20_00n,
  });

  const advance = await fixture.api.billing.recordAdvance({
    orgSlug: fixture.organization.slug,
    patientId: fixture.patient.id,
    method: "bank",
    amount: 30_00n,
    reference: "BANK-COLLECTIONS",
  });

  await fixture.api.billing.recordAdvanceRefund({
    orgSlug: fixture.organization.slug,
    advanceReceiptId: advance.id,
    method: "bank",
    amount: 10_00n,
    reference: "BANK-ADVANCE-REFUND",
  });

  const today = reportDate();
  const collectionDay = addDays(today, -1);
  await Promise.all([
    db
      .update(payments)
      .set({ businessDate: collectionDay })
      .where(
        and(eq(payments.orgId, fixture.organization.id), eq(payments.invoiceId, issued.invoice.id)),
      ),
    db
      .update(refunds)
      .set({ businessDate: collectionDay })
      .where(eq(refunds.orgId, fixture.organization.id)),
    db
      .update(advanceReceipts)
      .set({ businessDate: collectionDay })
      .where(
        and(eq(advanceReceipts.orgId, fixture.organization.id), eq(advanceReceipts.id, advance.id)),
      ),
  ]);

  const report = await fixture.api.report.dailyCollections({
    orgSlug: fixture.organization.slug,
    from: collectionDay,
    to: collectionDay,
  });

  expect(report.rows).toEqual([
    {
      businessDate: collectionDay,
      byMethod: {
        cash: 50_00n,
        upi: 48_00n,
        card: 0n,
        bank: 20_00n,
      },
      payments: 118_00n,
      advances: 30_00n,
      refunds: 20_00n,
      advanceRefunds: 10_00n,
      net: 118_00n,
    },
  ]);
  expect(report.byMethod.find((row) => row.method === "cash")?.net).toBe(50_00n);
  expect(report.totals.net).toBe(118_00n);

  const dashboard = await fixture.api.dashboard.collections({
    orgSlug: fixture.organization.slug,
  });

  expect(dashboard.collected).toBe(0n);
  expect(dashboard.trend.find((row) => row.day === collectionDay)?.amount).toBe(118_00n);
  await expectORPCCode(
    fixture.api.report.dailyCollections({
      orgSlug: fixture.organization.slug,
      from: collectionDay,
      to: addDays(collectionDay, 92),
    }),
    "BAD_REQUEST",
  );
});

test("trial balance is balanced, agrees with invoice outstanding, and carries prior activity into opening", async () => {
  const fixture = await createAccountingFixture("accounting-trial");
  const issued = await issueConsultationInvoice(fixture, "Trial");
  const today = reportDate();

  const balance = await invoiceBalanceFor(db, fixture.organization.id, {
    ...issued.invoice,
    grandTotal: issued.invoice.grandTotal,
  });

  const active = await fixture.api.report.trialBalance({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });

  expect(active.totals.debit).toBe(active.totals.credit);
  expect(active.totals.debit).toBe(118_00n);
  expect(active.totals.openingDebit).toBe(active.totals.openingCredit);
  expect(active.totals.closingDebit).toBe(active.totals.closingCredit);
  expect(active.totals.closingDebit).toBe(118_00n);
  const receivables = active.rows.find((row) => row.code === "1200");
  const revenue = active.rows.find((row) => row.code === "4100");
  expect(receivables?.openingDebit).toBe(0n);
  expect(receivables?.openingCredit).toBe(0n);
  expect(receivables?.debit).toBe(118_00n);
  expect(receivables?.closingDebit).toBe(balance.outstanding);
  expect(receivables?.closingCredit).toBe(0n);
  expect(revenue?.closingDebit).toBe(0n);
  expect(revenue?.closingCredit).toBe(100_00n);

  await db
    .update(journalEntries)
    .set({ entryDate: addDays(today, -1) })
    .where(
      and(
        eq(journalEntries.orgId, fixture.organization.id),
        eq(journalEntries.sourceType, "invoice"),
        eq(journalEntries.sourceId, issued.invoice.id),
      ),
    );

  const afterRange = await fixture.api.report.trialBalance({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });

  expect(afterRange.totals.debit).toBe(0n);
  expect(afterRange.totals.credit).toBe(0n);
  expect(afterRange.totals.openingDebit).toBe(afterRange.totals.openingCredit);
  expect(afterRange.totals.closingDebit).toBe(afterRange.totals.closingCredit);
  const carriedReceivables = afterRange.rows.find((row) => row.code === "1200");
  expect(carriedReceivables?.openingDebit).toBe(balance.outstanding);
  expect(carriedReceivables?.openingCredit).toBe(0n);
  expect(carriedReceivables?.debit).toBe(0n);
  expect(carriedReceivables?.closingDebit).toBe(balance.outstanding);
  expect(carriedReceivables?.closingCredit).toBe(0n);
});

test("balance sheet balances GST output and current surplus against assets", async () => {
  const fixture = await createAccountingFixture("accounting-balance-sheet");
  const issued = await issueConsultationInvoice(fixture, "Balance Sheet");

  const advance = await fixture.api.billing.recordAdvance({
    orgSlug: fixture.organization.slug,
    patientId: fixture.patient.id,
    method: "cash",
    amount: 30_00n,
  });

  // An allocation and an advance refund both balance whichever accounts they name, so
  // the only proof they named the right ones is the account balances they leave behind.
  await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [],
    applyCredit: 10_00n,
  });

  await fixture.api.billing.recordAdvanceRefund({
    orgSlug: fixture.organization.slug,
    advanceReceiptId: advance.id,
    method: "cash",
    amount: 5_00n,
  });

  const report = await fixture.api.report.balanceSheet({
    orgSlug: fixture.organization.slug,
    asOf: reportDate(),
  });

  expect(report.totals.assets).toBe(133_00n);
  expect(report.totals.assets).toBe(report.totals.liabilitiesAndEquity);
  expect(report.assets).toContainEqual({
    code: "1000",
    name: "Cash in Hand",
    balance: 25_00n,
  });
  expect(report.assets).toContainEqual({
    code: "1200",
    name: "Patient Receivables",
    balance: 108_00n,
  });
  expect(report.liabilities).toContainEqual({
    code: "2100",
    name: "GST Output Payable",
    balance: 18_00n,
  });
  expect(report.liabilities).toContainEqual({
    code: "2200",
    name: "Patient Advances",
    balance: 15_00n,
  });
  expect(report.equity).toContainEqual({
    code: "3900",
    name: "Current surplus",
    balance: 100_00n,
  });
});

test("GST register reconciles invoice and credit-note documents, rates, HSN, and date filters", async () => {
  const fixture = await createAccountingFixture("accounting-gst");

  const { appointment } = await fixture.createConsultationAppointment({
    name: "GST Consultation",
    unitPrice: 100_00n,
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });

  await fixture.addOtherCharge(appointment.id, 50_00n, "0", "Nil-rated Service", "NIL");

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    discountAmount: 15_00n,
    note: "Package discount",
  });

  const taxableLine = issued.lines.find((line) => line.taxRatePercent === "18.00");

  if (!taxableLine) {
    throw new Error("expected a taxable invoice line");
  }

  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Consultation reversal",
    lines: [{ invoiceLineId: taxableLine.id, full: true }],
  });

  const outsideOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(outsideOpdAppointment.id, 25_00n, "0", "Outside-range Service");

  const outside = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: outsideOpdAppointment.id,
  });

  const today = reportDate();
  const yesterday = addDays(today, -1);
  await db
    .update(invoices)
    .set({ businessDate: yesterday })
    .where(and(eq(invoices.orgId, fixture.organization.id), eq(invoices.id, outside.invoice.id)));

  const report = await fixture.api.report.gst({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });

  expect(report.documents).toHaveLength(2);
  expect(report.documents.map((document) => document.number)).not.toContain(
    outside.invoice.invoiceNumber,
  );

  const invoiceDocument = report.documents.find((document) => document.docType === "invoice");
  expect(invoiceDocument).toMatchObject({
    number: issued.invoice.invoiceNumber,
    date: today,
    patientName: fixture.patient.name,
    patientMrn: fixture.patient.mrn,
    taxableValue: issued.invoice.subtotal - issued.invoice.discountAmount,
    taxAmount: issued.invoice.taxTotal,
    gross: issued.invoice.grandTotal,
  });
  expect(sumMoney([invoiceDocument!.cgst, invoiceDocument!.sgst])).toBe(issued.invoice.taxTotal);

  const creditDocument = report.documents.find((document) => document.docType === "credit_note");
  expect(creditDocument).toMatchObject({
    number: credited.creditNote.creditNoteNumber,
    date: today,
    taxableValue: -credited.creditNote.subtotal,
    taxAmount: -credited.creditNote.taxTotal,
    gross: -credited.creditNote.total,
  });
  expect(sumMoney([creditDocument!.cgst, creditDocument!.sgst])).toBe(
    -credited.creditNote.taxTotal,
  );

  expect(sumMoney(report.documents.map((document) => document.taxableValue))).toBe(
    report.totals.taxableValue,
  );
  expect(sumMoney(report.documents.map((document) => document.cgst))).toBe(report.totals.cgst);
  expect(sumMoney(report.documents.map((document) => document.sgst))).toBe(report.totals.sgst);
  expect(sumMoney(report.documents.map((document) => document.taxAmount))).toBe(
    report.totals.taxAmount,
  );
  expect(sumMoney(report.documents.map((document) => document.gross))).toBe(report.totals.gross);
  expect(sumMoney(report.rateSummary.map((row) => row.taxableValue))).toBe(
    report.totals.taxableValue,
  );
  expect(sumMoney(report.rateSummary.map((row) => row.cgst))).toBe(report.totals.cgst);
  expect(sumMoney(report.rateSummary.map((row) => row.sgst))).toBe(report.totals.sgst);
  expect(sumMoney(report.rateSummary.map((row) => row.taxAmount))).toBe(report.totals.taxAmount);
  expect(sumMoney(report.hsnSummary.map((row) => row.taxableValue))).toBe(
    report.totals.taxableValue,
  );
  expect(sumMoney(report.hsnSummary.map((row) => row.taxAmount))).toBe(report.totals.taxAmount);
});

test("trial balance rejects an inverted date range", async () => {
  const fixture = await createAccountingFixture("accounting-validation");
  const today = reportDate();
  await expectORPCCode(
    fixture.api.report.trialBalance({
      orgSlug: fixture.organization.slug,
      from: today,
      to: addDays(today, -1),
    }),
    "BAD_REQUEST",
  );
});

test("invoice and credit note keep the revenue category captured when the charge was created", async () => {
  const fixture = await createAccountingFixture("accounting-category-snapshot");

  const { appointment, item } = await fixture.createConsultationAppointment({
    name: "Snapshot Consultation",
    unitPrice: 100_00n,
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });

  await fixture.api.catalog.update({
    orgSlug: fixture.organization.slug,
    itemId: item.id,
    name: item.name,
    code: item.code,
    category: "lab",
    unitPrice: item.unitPrice,
    customRate: false,
    taxRatePercent: item.taxRatePercent,
    taxCode: item.taxCode,
  });

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });

  const invoiceJournal = await journalFor(fixture, "invoice", issued.invoice.id);
  expect(lineByCode(invoiceJournal.lines, "4100").credit).toBe(100_00n);
  expect(invoiceJournal.lines.some((line) => line.code === "4300")).toBe(false);

  const [invoiceLine] = issued.lines;

  if (!invoiceLine) {
    throw new Error("expected an invoice line");
  }

  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Category changed after charge creation",
    lines: [{ invoiceLineId: invoiceLine.id, full: true }],
  });

  const creditJournal = await journalFor(fixture, "credit_note", credited.creditNote.id);
  expect(lineByCode(creditJournal.lines, "4100")).toMatchObject({
    debit: 100_00n,
    credit: 0n,
  });
  expect(creditJournal.lines.some((line) => line.code === "4300")).toBe(false);
  expectBalanced(creditJournal.lines);
});

test("concurrent first invoices seed one complete chart and both post", async () => {
  const fixture = await createAccountingFixture("accounting-concurrent-chart");
  const firstOpdAppointment = await fixture.createOpdAppointment();
  const secondOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(firstOpdAppointment.id, 10_00n);
  await fixture.addOtherCharge(secondOpdAppointment.id, 20_00n);

  const [first, second] = await Promise.all([
    settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: firstOpdAppointment.id,
    }),
    settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: secondOpdAppointment.id,
    }),
  ]);

  expect((await journalFor(fixture, "invoice", first.invoice.id)).entries).toHaveLength(1);
  expect((await journalFor(fixture, "invoice", second.invoice.id)).entries).toHaveLength(1);

  const chart = await db
    .select({ systemKey: accounts.systemKey })
    .from(accounts)
    .where(eq(accounts.orgId, fixture.organization.id));

  expect(chart).toHaveLength(10);
  expect(new Set(chart.map((row) => row.systemKey)).size).toBe(10);
});

test("journal lines reject accounts and entries from another organization", async () => {
  const [ownerA, ownerB] = await Promise.all([
    createTestUser("accounting-journal-tenant-a"),
    createTestUser("accounting-journal-tenant-b"),
  ]);

  const [organizationA, organizationB] = await Promise.all([
    createOrganization(ownerA, "accounting-journal-tenant-a"),
    createOrganization(ownerB, "accounting-journal-tenant-b"),
  ]);

  const accountAId = Bun.randomUUIDv7();
  const accountBId = Bun.randomUUIDv7();
  const entryAId = Bun.randomUUIDv7();
  const entryBId = Bun.randomUUIDv7();

  await db.insert(accounts).values([
    {
      id: accountAId,
      orgId: organizationA.id,
      code: "TENANT-A",
      name: "Tenant A account",
      type: "asset",
    },
    {
      id: accountBId,
      orgId: organizationB.id,
      code: "TENANT-B",
      name: "Tenant B account",
      type: "asset",
    },
  ]);
  await db.insert(journalEntries).values([
    {
      id: entryAId,
      orgId: organizationA.id,
      entryDate: "2030-03-15",
      sourceType: "tenant-integrity",
      sourceId: "tenant-a",
      narration: "Tenant A entry",
      createdBy: ownerA.user.id,
    },
    {
      id: entryBId,
      orgId: organizationB.id,
      entryDate: "2030-03-15",
      sourceType: "tenant-integrity",
      sourceId: "tenant-b",
      narration: "Tenant B entry",
      createdBy: ownerB.user.id,
    },
  ]);

  await expect(
    db
      .insert(journalLines)
      .values({
        id: Bun.randomUUIDv7(),
        orgId: organizationB.id,
        entryId: entryBId,
        accountId: accountAId,
        debit: 100n,
        credit: 0n,
      })
      .execute(),
  ).rejects.toThrow();
  await expect(
    db
      .insert(journalLines)
      .values({
        id: Bun.randomUUIDv7(),
        orgId: organizationB.id,
        entryId: entryAId,
        accountId: accountBId,
        debit: 100n,
        credit: 0n,
      })
      .execute(),
  ).rejects.toThrow();
});

test("duplicate source posting is rejected", async () => {
  const fixture = await createAccountingFixture("accounting-duplicate-source");
  const issued = await issueConsultationInvoice(fixture, "Duplicate source");

  await expect(
    db.transaction((tx) =>
      postJournalEntry(tx, {
        orgId: fixture.organization.id,
        sourceType: "invoice",
        sourceId: issued.invoice.id,
        narration: "Duplicate",
        createdBy: fixture.owner.user.id,
        now: new Date(),
        timeZone: "Asia/Kolkata",
        lines: [
          { account: "patient_receivables", debit: 100n },
          { account: "revenue_other", credit: 100n },
        ],
      }),
    ),
  ).rejects.toThrow();
  expect((await journalFor(fixture, "invoice", issued.invoice.id)).entries).toHaveLength(1);
});

test("posting failure rolls back the invoice and charge transition", async () => {
  const fixture = await createAccountingFixture("accounting-posting-rollback");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(appointment.id, 25_00n);
  await db.insert(accounts).values({
    id: Bun.randomUUIDv7(),
    orgId: fixture.organization.id,
    code: "1000",
    name: "Conflicting custom account",
    type: "asset",
  });

  await expect(
    settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    }),
  ).rejects.toThrow();

  expect(
    await fixture.api.billing.listInvoices({
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    }),
  ).toHaveLength(0);

  const pending = await db
    .select({ status: charges.status, invoiceId: charges.invoiceId })
    .from(charges)
    .where(
      and(eq(charges.orgId, fixture.organization.id), eq(charges.opdAppointmentId, appointment.id)),
    );

  expect(pending).toEqual([{ status: "pending", invoiceId: null }]);
});

test("GST summaries reconcile odd-paise tax buckets", async () => {
  const fixture = await createAccountingFixture("accounting-gst-rounding");

  for (const suffix of ["first", "second"]) {
    const appointment = await fixture.createOpdAppointment();
    await fixture.addOtherCharge(appointment.id, 1_00n, "5.00", `${suffix} odd-paise tax service`);
    await settlePendingCharges(fixture.api, {
      orgSlug: fixture.organization.slug,
      appointmentId: appointment.id,
    });
  }

  const today = reportDate();

  const report = await fixture.api.report.gst({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });

  const invoiceDocuments = report.documents.filter((document) => document.docType === "invoice");

  expect(invoiceDocuments).toHaveLength(2);
  expect(invoiceDocuments.map((document) => document.taxAmount)).toEqual([5n, 5n]);
  expect(report.totals.cgst).toBe(
    invoiceDocuments.reduce((sum, document) => sum + document.cgst, 0n),
  );
  expect(report.totals.sgst).toBe(
    invoiceDocuments.reduce((sum, document) => sum + document.sgst, 0n),
  );
  expect(report.rateSummary.reduce((sum, row) => sum + row.cgst, 0n)).toBe(report.totals.cgst);
  expect(report.rateSummary.reduce((sum, row) => sum + row.sgst, 0n)).toBe(report.totals.sgst);

  for (const document of invoiceDocuments) {
    expect(document.cgst + document.sgst).toBe(document.taxAmount);
  }

  expect(report.totals.cgst + report.totals.sgst).toBe(report.totals.taxAmount);
});
