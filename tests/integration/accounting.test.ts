import { beforeAll, expect, test } from "bun:test";

import { businessDate } from "@hms/api/lib/business-date";
import { invoiceBalanceFor } from "@hms/api/lib/invoice-balance";
import { postJournalEntry } from "@hms/api/lib/ledger";
import type { AppRouterClient } from "@hms/api/routers/index";

import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
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

function toPaise(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new Error(`invalid money value: ${value}`);
  }
  const amount = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -amount : amount;
}

function fromPaise(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function sumMoney(values: string[]): string {
  return fromPaise(values.reduce((total, value) => total + toPaise(value), 0n));
}

type AccountingFixture = {
  organization: { id: string; slug: string };
  api: AppRouterClient;
  patient: { name: string; mrn: string };
  createOpdAppointment: () => Promise<{ id: string }>;
  addOtherCharge: (
    appointmentId: string,
    unitPrice: string,
    taxRatePercent?: string,
    description?: string,
    taxCode?: string,
  ) => Promise<unknown>;
  addCatalogCharge: (
    appointmentId: string,
    options: {
      name: string;
      category: "consultation" | "procedure" | "lab" | "radiology" | "other";
      unitPrice: string;
      taxRatePercent: string;
      taxCode?: string;
    },
  ) => Promise<{
    item: { id: string };
    charge: { sourceType: string; revenueCategory: string };
  }>;
  createConsultationAppointment: (options: {
    name: string;
    unitPrice: string;
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
    creditNotePrefix: "CN",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
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
    unitPrice: string,
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
    unitPrice: string;
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
      unitPrice: string;
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
  // These fixed-offset extremes overlap around UTC noon, so one is always on a
  // different calendar date. America/Adak's DST offset made this time-dependent.
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

function expectBalanced(lines: Array<{ debit: string; credit: string }>) {
  expect(sumMoney(lines.map((line) => line.debit))).toBe(
    sumMoney(lines.map((line) => line.credit)),
  );
}

function lineByCode(lines: Array<{ code: string; debit: string; credit: string }>, code: string) {
  const line = lines.find((candidate) => candidate.code === code);
  if (!line) {
    throw new Error(`expected journal line for account ${code}`);
  }
  return line;
}

async function issueConsultationInvoice(fixture: AccountingFixture, seed: string) {
  const { appointment } = await fixture.createConsultationAppointment({
    name: `${seed} Consultation`,
    unitPrice: "100.00",
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
    unitPrice: "100.00",
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });
  await fixture.addOtherCharge(appointment.id, "50.00", "0", "Other Service");

  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });
  expect(issued.invoice).toMatchObject({
    subtotal: "150.00",
    taxTotal: "18.00",
    grandTotal: "168.00",
  });

  const journal = await journalFor(fixture, "invoice", issued.invoice.id);
  expect(journal.entries).toHaveLength(1);
  expect(journal.lines).toHaveLength(4);
  expectBalanced(journal.lines);
  expect(lineByCode(journal.lines, "1200")).toMatchObject({
    debit: issued.invoice.grandTotal,
    credit: "0.00",
  });
  expect(lineByCode(journal.lines, "4100")).toMatchObject({
    debit: "0.00",
    credit: "100.00",
  });
  expect(lineByCode(journal.lines, "4900")).toMatchObject({
    debit: "0.00",
    credit: "50.00",
  });
  expect(lineByCode(journal.lines, "2100")).toMatchObject({
    debit: "0.00",
    credit: issued.invoice.taxTotal,
  });
});

test("a desk-added consultation charge posts to consultation revenue", async () => {
  const fixture = await createAccountingFixture("accounting-desk-consultation");
  const appointment = await fixture.createOpdAppointment();
  const { charge } = await fixture.addCatalogCharge(appointment.id, {
    name: "Desk Consultation",
    category: "consultation",
    unitPrice: "75.00",
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
    debit: "0.00",
    credit: "75.00",
  });
  expect(journal.lines.map((line) => line.code)).not.toContain("4900");
  expectBalanced(journal.lines);
});

test("zero-rated invoices omit GST and zero-total invoices do not post", async () => {
  const fixture = await createAccountingFixture("accounting-zero");
  const zeroRateOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(zeroRateOpdAppointment.id, "25.00", "0", "Zero-rated Service");
  const zeroRate = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: zeroRateOpdAppointment.id,
  });
  const zeroRateJournal = await journalFor(fixture, "invoice", zeroRate.invoice.id);
  expect(zeroRateJournal.entries).toHaveLength(1);
  expect(zeroRateJournal.lines.map((line) => line.code)).not.toContain("2100");
  expect(lineByCode(zeroRateJournal.lines, "1200").debit).toBe("25.00");
  expect(lineByCode(zeroRateJournal.lines, "4900").credit).toBe("25.00");
  expectBalanced(zeroRateJournal.lines);

  const zeroTotalOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(zeroTotalOpdAppointment.id, "0.00", "0", "No-charge Service");
  const zeroTotal = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: zeroTotalOpdAppointment.id,
  });
  expect(zeroTotal.invoice.grandTotal).toBe("0.00");
  expect((await journalFor(fixture, "invoice", zeroTotal.invoice.id)).entries).toHaveLength(0);
});

test("payments, credit notes, and refunds post to their exact settlement accounts", async () => {
  const fixture = await createAccountingFixture("accounting-settlement");
  const issued = await issueConsultationInvoice(fixture, "Settlement");
  const [cash] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "cash", amount: "100.00" }],
  });
  const [upi] = await fixture.api.billing.recordPayments({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    payments: [{ method: "upi", amount: "18.00", reference: "UPI-LEDGER" }],
  });
  if (!cash || !upi) throw new Error("expected both payments");

  const cashJournal = await journalFor(fixture, "payment", cash.id);
  expect(cashJournal.entries).toHaveLength(1);
  expect(lineByCode(cashJournal.lines, "1000")).toMatchObject({ debit: "100.00", credit: "0.00" });
  expect(lineByCode(cashJournal.lines, "1200")).toMatchObject({ debit: "0.00", credit: "100.00" });
  expectBalanced(cashJournal.lines);

  const upiJournal = await journalFor(fixture, "payment", upi.id);
  expect(upiJournal.entries).toHaveLength(1);
  expect(lineByCode(upiJournal.lines, "1100")).toMatchObject({ debit: "18.00", credit: "0.00" });
  expect(lineByCode(upiJournal.lines, "1200")).toMatchObject({ debit: "0.00", credit: "18.00" });
  expectBalanced(upiJournal.lines);

  const [invoiceLine] = issued.lines;
  if (!invoiceLine) {
    throw new Error("expected an invoice line");
  }
  const credited = await fixture.api.billing.issueCreditNote({
    orgSlug: fixture.organization.slug,
    invoiceId: issued.invoice.id,
    reason: "Partial reversal",
    lines: [{ invoiceLineId: invoiceLine.id, gross: "59.00" }],
  });
  const creditJournal = await journalFor(fixture, "credit_note", credited.creditNote.id);
  expect(creditJournal.entries).toHaveLength(1);
  expect(lineByCode(creditJournal.lines, "4100")).toMatchObject({ debit: "50.00", credit: "0.00" });
  expect(lineByCode(creditJournal.lines, "2100")).toMatchObject({ debit: "9.00", credit: "0.00" });
  expect(lineByCode(creditJournal.lines, "1200")).toMatchObject({ debit: "0.00", credit: "59.00" });
  expectBalanced(creditJournal.lines);

  const refund = await fixture.api.billing.recordRefund({
    orgSlug: fixture.organization.slug,
    creditNoteId: credited.creditNote.id,
    method: "upi",
    amount: "59.00",
    reference: "UPI-REFUND-LEDGER",
  });
  const refundJournal = await journalFor(fixture, "refund", refund.id);
  expect(refundJournal.entries).toHaveLength(1);
  expect(lineByCode(refundJournal.lines, "1200")).toMatchObject({ debit: "59.00", credit: "0.00" });
  expect(lineByCode(refundJournal.lines, "1100")).toMatchObject({ debit: "0.00", credit: "59.00" });
  expectBalanced(refundJournal.lines);
});

test("trial balance is balanced, agrees with invoice outstanding, and carries prior activity into opening", async () => {
  const fixture = await createAccountingFixture("accounting-trial");
  const issued = await issueConsultationInvoice(fixture, "Trial");
  const today = reportDate();
  const balance = await invoiceBalanceFor(db, fixture.organization.id, issued.invoice);

  const active = await fixture.api.report.trialBalance({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });
  expect(active.totals.debit).toBe(active.totals.credit);
  expect(active.totals.debit).toBe("118.00");
  expect(active.totals.openingDebit).toBe(active.totals.openingCredit);
  expect(active.totals.closingDebit).toBe(active.totals.closingCredit);
  expect(active.totals.closingDebit).toBe("118.00");
  const receivables = active.rows.find((row) => row.code === "1200");
  const revenue = active.rows.find((row) => row.code === "4100");
  expect(receivables?.openingDebit).toBe("0.00");
  expect(receivables?.openingCredit).toBe("0.00");
  expect(receivables?.debit).toBe("118.00");
  expect(receivables?.closingDebit).toBe(balance.outstanding);
  expect(receivables?.closingCredit).toBe("0.00");
  expect(revenue?.closingDebit).toBe("0.00");
  expect(revenue?.closingCredit).toBe("100.00");

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
  expect(afterRange.totals.debit).toBe("0.00");
  expect(afterRange.totals.credit).toBe("0.00");
  expect(afterRange.totals.openingDebit).toBe(afterRange.totals.openingCredit);
  expect(afterRange.totals.closingDebit).toBe(afterRange.totals.closingCredit);
  const carriedReceivables = afterRange.rows.find((row) => row.code === "1200");
  expect(carriedReceivables?.openingDebit).toBe(balance.outstanding);
  expect(carriedReceivables?.openingCredit).toBe("0.00");
  expect(carriedReceivables?.debit).toBe("0.00");
  expect(carriedReceivables?.closingDebit).toBe(balance.outstanding);
  expect(carriedReceivables?.closingCredit).toBe("0.00");
});

test("balance sheet balances GST output and current surplus against assets", async () => {
  const fixture = await createAccountingFixture("accounting-balance-sheet");
  await issueConsultationInvoice(fixture, "Balance Sheet");

  const report = await fixture.api.report.balanceSheet({
    orgSlug: fixture.organization.slug,
    asOf: reportDate(),
  });
  expect(report.totals.assets).toBe("118.00");
  expect(report.totals.assets).toBe(report.totals.liabilitiesAndEquity);
  expect(report.liabilities).toContainEqual({
    code: "2100",
    name: "GST Output Payable",
    balance: "18.00",
  });
  expect(report.equity).toContainEqual({
    code: "3900",
    name: "Current surplus",
    balance: "100.00",
  });
});

test("GST register reconciles invoice and credit-note documents, rates, HSN, and date filters", async () => {
  const fixture = await createAccountingFixture("accounting-gst");
  const { appointment } = await fixture.createConsultationAppointment({
    name: "GST Consultation",
    unitPrice: "100.00",
    taxRatePercent: "18.00",
    taxCode: "SVC18",
  });
  await fixture.addOtherCharge(appointment.id, "50.00", "0", "Nil-rated Service", "NIL");
  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
    discountAmount: "15.00",
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
  await fixture.addOtherCharge(outsideOpdAppointment.id, "25.00", "0", "Outside-range Service");
  const outside = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: outsideOpdAppointment.id,
  });
  const today = reportDate();
  const yesterday = addDays(today, -1);
  await db
    .update(invoices)
    .set({ createdAt: new Date(`${yesterday}T12:00:00+05:30`) })
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
    taxableValue: fromPaise(
      toPaise(issued.invoice.subtotal) - toPaise(issued.invoice.discountAmount),
    ),
    taxAmount: issued.invoice.taxTotal,
    gross: issued.invoice.grandTotal,
  });
  expect(sumMoney([invoiceDocument!.cgst, invoiceDocument!.sgst])).toBe(issued.invoice.taxTotal);

  const creditDocument = report.documents.find((document) => document.docType === "credit_note");
  expect(creditDocument).toMatchObject({
    number: credited.creditNote.creditNoteNumber,
    date: today,
    taxableValue: `-${credited.creditNote.subtotal}`,
    taxAmount: `-${credited.creditNote.taxTotal}`,
    gross: `-${credited.creditNote.total}`,
  });
  expect(sumMoney([creditDocument!.cgst, creditDocument!.sgst])).toBe(
    `-${credited.creditNote.taxTotal}`,
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
    unitPrice: "100.00",
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
    taxRatePercent: item.taxRatePercent,
    taxCode: item.taxCode,
    active: item.active,
  });
  const issued = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: appointment.id,
  });
  const invoiceJournal = await journalFor(fixture, "invoice", issued.invoice.id);
  expect(lineByCode(invoiceJournal.lines, "4100").credit).toBe("100.00");
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
    debit: "100.00",
    credit: "0.00",
  });
  expect(creditJournal.lines.some((line) => line.code === "4300")).toBe(false);
  expectBalanced(creditJournal.lines);
});

test("concurrent first invoices seed one complete chart and both post", async () => {
  const fixture = await createAccountingFixture("accounting-concurrent-chart");
  const firstOpdAppointment = await fixture.createOpdAppointment();
  const secondOpdAppointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(firstOpdAppointment.id, "10.00");
  await fixture.addOtherCharge(secondOpdAppointment.id, "20.00");

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
  expect(chart).toHaveLength(9);
  expect(new Set(chart.map((row) => row.systemKey)).size).toBe(9);
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
          { account: "patient_receivables", debit: "1.00" },
          { account: "revenue_other", credit: "1.00" },
        ],
      }),
    ),
  ).rejects.toThrow();
  expect((await journalFor(fixture, "invoice", issued.invoice.id)).entries).toHaveLength(1);
});

test("posting failure rolls back the invoice and charge transition", async () => {
  const fixture = await createAccountingFixture("accounting-posting-rollback");
  const appointment = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(appointment.id, "25.00");
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
    await fixture.addOtherCharge(appointment.id, "1.00", "5.00", `${suffix} odd-paise tax service`);
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
  expect(invoiceDocuments.map((document) => document.taxAmount)).toEqual(["0.05", "0.05"]);
  expect(toPaise(report.totals.cgst)).toBe(
    invoiceDocuments.reduce((sum, document) => sum + toPaise(document.cgst), 0n),
  );
  expect(toPaise(report.totals.sgst)).toBe(
    invoiceDocuments.reduce((sum, document) => sum + toPaise(document.sgst), 0n),
  );
  expect(report.rateSummary.reduce((sum, row) => sum + toPaise(row.cgst), 0n)).toBe(
    toPaise(report.totals.cgst),
  );
  expect(report.rateSummary.reduce((sum, row) => sum + toPaise(row.sgst), 0n)).toBe(
    toPaise(report.totals.sgst),
  );
  for (const document of invoiceDocuments) {
    expect(toPaise(document.cgst) + toPaise(document.sgst)).toBe(toPaise(document.taxAmount));
  }
  expect(toPaise(report.totals.cgst) + toPaise(report.totals.sgst)).toBe(
    toPaise(report.totals.taxAmount),
  );
});
