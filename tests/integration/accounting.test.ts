import { beforeAll, expect, test } from "bun:test";

import { invoiceBalanceFor } from "@hms/api/lib/invoice-balance";
import { postJournalEntries } from "@hms/api/lib/ledger";
import type { AppRouterClient } from "@hms/api/routers/index";

import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
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
import { UNPRICED } from "../support/pharmacy";
import { sumMoney } from "../support/unique";

async function workbookSheets(file: File) {
  // Static import cannot resolve this API-only dependency from the root tests.
  // Bun resolves the existing package at runtime without another dependency.
  const {
    readXlsx,
  }: {
    readXlsx: (
      input: ArrayBuffer,
    ) => Promise<{ sheets: Array<{ name: string; rows: unknown[][] }> }>;
  } = await import(
    Bun.resolveSync("hucre/xlsx", new URL("../../packages/api/", import.meta.url).pathname)
  );

  const workbook = await readXlsx(await file.arrayBuffer());

  return new Map(
    workbook.sheets.map((sheet) => {
      const [headers = [], ...rows] = sheet.rows;

      return [
        sheet.name,
        rows.map((row) =>
          Object.fromEntries(headers.map((header, index) => [String(header), row[index]])),
        ),
      ] as const;
    }),
  );
}

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

async function createAccountingFixture(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);
  await api.settings.update({
    orgSlug: organization.slug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "GSTIN-TEST",
    gstin: "",
    drugLicence20: "",
    drugLicence21: "",
    currency: "INR",
    timeZone: REPORT_TIME_ZONE,
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    pharmacyInvoicePrefix: "PH",
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

test("issuing invoices posts balanced entries by revenue category and GST, and zero totals do not post", async () => {
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

  const deskAppointment = await fixture.createOpdAppointment();

  const { charge } = await fixture.addCatalogCharge(deskAppointment.id, {
    name: "Desk Consultation",
    category: "consultation",
    unitPrice: 75_00n,
    taxRatePercent: "0",
  });

  expect(charge).toMatchObject({
    sourceType: "catalog",
    revenueCategory: "consultation",
  });

  const desk = await settlePendingCharges(fixture.api, {
    orgSlug: fixture.organization.slug,
    appointmentId: deskAppointment.id,
  });

  const deskJournal = await journalFor(fixture, "invoice", desk.invoice.id);
  expect(lineByCode(deskJournal.lines, "4100")).toMatchObject({
    debit: 0n,
    credit: 75_00n,
  });
  expect(deskJournal.lines.map((line) => line.code)).not.toContain("4900");
  expectBalanced(deskJournal.lines);

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
  expect(collections.bySource).toEqual([{ source: "opd", amount: 118_00n }]);

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
  expect(register.nextCursor).toBeNull();
  expect(register.totals).toMatchObject({
    billed: 118_00n,
    paid: 118_00n,
    credits: 59_00n,
    refunds: 59_00n,
    outstanding: 0n,
  });
});

test("OPD register keyset pages return every visit once, totals on the first page", async () => {
  const fixture = await createAccountingFixture("accounting-opd-register-pages");

  const visits = [
    await fixture.createOpdAppointment(),
    await fixture.createOpdAppointment(),
    await fixture.createOpdAppointment(),
  ];

  const range = {
    orgSlug: fixture.organization.slug,
    from: visits[0]!.businessDate,
    to: visits[2]!.businessDate,
  };

  const full = await fixture.api.report.opdRegister(range);
  const first = await fixture.api.report.opdRegister({ ...range, limit: 2 });

  const second = await fixture.api.report.opdRegister({
    ...range,
    limit: 2,
    cursor: first.nextCursor!,
  });

  expect(full.rows).toHaveLength(3);
  expect(first.totals).toEqual(full.totals);
  expect(first.totals!.appointments).toBe(3);
  expect(second.totals).toBeNull();
  expect(second.nextCursor).toBeNull();
  expect([...first.rows, ...second.rows]).toEqual(full.rows);
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

  const trend = await fixture.api.dashboard.trend({ orgSlug: fixture.organization.slug });

  expect(trend.find((row) => row.day === collectionDay)).toEqual({
    day: collectionDay,
    amount: 118_00n,
    cash: 50_00n,
    digital: 68_00n,
  });
  await expectORPCCode(
    fixture.api.report.dailyCollections({
      orgSlug: fixture.organization.slug,
      from: collectionDay,
      to: addDays(collectionDay, 92),
    }),
    "BAD_REQUEST",
  );
});

test("trial balance is balanced, carries prior activity into opening, and rejects an inverted range", async () => {
  const fixture = await createAccountingFixture("accounting-trial");
  const issued = await issueConsultationInvoice(fixture, "Trial");
  const today = reportDate();

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
  expect(receivables?.closingDebit).toBe(118_00n);
  expect(receivables?.closingCredit).toBe(0n);
  expect(revenue?.closingDebit).toBe(0n);
  expect(revenue?.closingCredit).toBe(100_00n);

  const workbook = await fixture.api.export.trialBalanceXlsx({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
  });

  expect(workbook.name).toBe(`trial-balance-${today}-to-${today}.xlsx`);
  // An .xlsx is a zip archive, which opens with "PK".
  expect(new TextDecoder().decode((await workbook.arrayBuffer()).slice(0, 2))).toBe("PK");

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
  expect(carriedReceivables?.openingDebit).toBe(118_00n);
  expect(carriedReceivables?.openingCredit).toBe(0n);
  expect(carriedReceivables?.debit).toBe(0n);
  expect(carriedReceivables?.closingDebit).toBe(118_00n);
  expect(carriedReceivables?.closingCredit).toBe(0n);
  await expectORPCCode(
    fixture.api.report.trialBalance({
      orgSlug: fixture.organization.slug,
      from: today,
      to: addDays(today, -1),
    }),
    "BAD_REQUEST",
  );
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
  expect(report.assets).toContainEqual(expect.objectContaining({ code: "1000", balance: 25_00n }));
  expect(report.assets).toContainEqual(expect.objectContaining({ code: "1200", balance: 108_00n }));
  expect(report.liabilities).toContainEqual(
    expect.objectContaining({ code: "2100", balance: 18_00n }),
  );
  expect(report.liabilities).toContainEqual(
    expect.objectContaining({ code: "2200", balance: 15_00n }),
  );
  expect(report.equity).toContainEqual(expect.objectContaining({ code: "3900", balance: 100_00n }));
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
  expect(report.nextCursor).toBeNull();

  const first = await fixture.api.report.gst({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
    limit: 1,
  });

  const second = await fixture.api.report.gst({
    orgSlug: fixture.organization.slug,
    from: today,
    to: today,
    limit: 1,
    cursor: first.nextCursor!,
  });

  expect(second.summary).toBeNull();
  expect(second.nextCursor).toBeNull();
  expect([...first.documents, ...second.documents]).toEqual(report.documents);

  const summary = report.summary!;
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
    summary.totals.taxableValue,
  );
  expect(sumMoney(report.documents.map((document) => document.cgst))).toBe(summary.totals.cgst);
  expect(sumMoney(report.documents.map((document) => document.sgst))).toBe(summary.totals.sgst);
  expect(sumMoney(report.documents.map((document) => document.taxAmount))).toBe(
    summary.totals.taxAmount,
  );
  expect(sumMoney(report.documents.map((document) => document.gross))).toBe(summary.totals.gross);
  expect(sumMoney(summary.rateSummary.map((row) => row.taxableValue))).toBe(
    summary.totals.taxableValue,
  );
  expect(sumMoney(summary.rateSummary.map((row) => row.cgst))).toBe(summary.totals.cgst);
  expect(sumMoney(summary.rateSummary.map((row) => row.sgst))).toBe(summary.totals.sgst);
  expect(sumMoney(summary.rateSummary.map((row) => row.taxAmount))).toBe(summary.totals.taxAmount);
  expect(sumMoney(summary.hsnSummary.map((row) => row.taxableValue))).toBe(
    summary.totals.taxableValue,
  );
  expect(sumMoney(summary.hsnSummary.map((row) => row.taxAmount))).toBe(summary.totals.taxAmount);
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

  const revenue = await fixture.api.report.revenueBreakdown({
    orgSlug: fixture.organization.slug,
    from: issued.invoice.businessDate,
    to: issued.invoice.businessDate,
  });

  expect(revenue.byCategory).toEqual([
    expect.objectContaining({
      id: "consultation",
      issuedTaxableValue: 100_00n,
      creditedTaxableValue: 100_00n,
      netTaxableValue: 0n,
      tax: 0n,
    }),
  ]);
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

  expect(chart).toHaveLength(12);
  expect(new Set(chart.map((row) => row.systemKey)).size).toBe(12);
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
      postJournalEntries(tx, fixture.organization.id, [
        {
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
        },
      ]),
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

test("revenue control reconciles all-stream current balances, event credits, attribution and gross collection shares", async () => {
  const fixture = await createAccountingFixture("accounting-revenue-control");
  const { api, organization, patient } = fixture;
  const orgSlug = organization.slug;
  const today = reportDate();
  const olderDay = addDays(today, -14);
  const laterDay = addDays(today, 1);

  const oldAttendance = await fixture.createConsultationAppointment({
    name: "Older consultation",
    unitPrice: 50_00n,
    taxRatePercent: "0",
  });

  const old = await settlePendingCharges(api, {
    orgSlug,
    appointmentId: oldAttendance.appointment.id,
  });

  const attendance = await fixture.createOpdAppointment();
  await fixture.addCatalogCharge(attendance.id, {
    name: "Procedure snapshot",
    category: "procedure",
    unitPrice: 60_00n,
    taxRatePercent: "0",
  });
  await fixture.addCatalogCharge(attendance.id, {
    name: "Lab snapshot",
    category: "lab",
    unitPrice: 40_00n,
    taxRatePercent: "0",
  });

  const opd = await settlePendingCharges(api, {
    orgSlug,
    appointmentId: attendance.id,
    discountAmount: 10_00n,
    note: "Approved package concession",
  });

  const advance = await api.billing.recordAdvance({
    orgSlug,
    patientId: patient.id,
    method: "bank",
    amount: 100_00n,
    reference: "REVENUE-ADVANCE",
  });

  await api.billing.recordPayments({
    orgSlug,
    invoiceId: opd.invoice.id,
    applyCredit: 40_00n,
    payments: [
      { method: "cash", amount: 30_00n },
      { method: "upi", amount: 20_00n, reference: "REVENUE-UPI" },
    ],
  });
  await api.billing.recordAdvanceRefund({
    orgSlug,
    advanceReceiptId: advance.id,
    method: "bank",
    amount: 10_00n,
    reference: "ADVANCE-RETURN",
  });

  const product = await api.pharmacy.createProduct({
    orgSlug,
    name: "Revenue medicine",
    sold: true,
    active: true,
    taxRatePercent: "0",
    stockUnit: "tablet",
    unitsPerPack: 1,
    expires: false,
    pack: "One tablet",
  });

  const receipt = await api.pharmacy.receiveGoods({
    orgSlug,
    supplierName: "Revenue supplier",
    receivedOn: today,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "REVENUE-BATCH",
        mrp: 100_00n,
        pricedPer: "unit",
        qty: 2,
        cost: UNPRICED,
      },
    ],
  });

  const batchId = receipt.batches[0]!.batchId;

  const linked = await api.pharmacy.sell({
    orgSlug,
    lines: [{ batchId, qty: 1 }],
    buyer: { patientId: patient.id },
    opdAppointmentId: attendance.id,
    payments: [{ method: "cash", amount: 100_00n }],
    expectedGrandTotal: 100_00n,
  });

  const counter = await api.pharmacy.sell({
    orgSlug,
    lines: [{ batchId, qty: 1 }],
    buyer: { name: "Counter snapshot" },
    prescriberName: "Dr. accounting-revenue-control",
    payments: [{ method: "card", amount: 100_00n, reference: "REVENUE-CARD" }],
    expectedGrandTotal: 100_00n,
  });

  const linkedDetail = await api.pharmacy.getSale({ orgSlug, saleId: linked.saleId });
  const counterDetail = await api.pharmacy.getSale({ orgSlug, saleId: counter.saleId });

  const oldCredit = await api.billing.issueCreditNote({
    orgSlug,
    invoiceId: old.invoice.id,
    reason: "Older invoice correction",
    lines: [{ invoiceLineId: old.lines[0]!.id, gross: 10_00n }],
  });

  const laterCredit = await api.billing.issueCreditNote({
    orgSlug,
    invoiceId: opd.invoice.id,
    reason: "Next-day correction",
    lines: [{ invoiceLineId: opd.lines[0]!.id, gross: 20_00n }],
  });

  const refund = await api.billing.recordRefund({
    orgSlug,
    creditNoteId: laterCredit.creditNote.id,
    method: "cash",
    amount: 5_00n,
  });

  const periodInvoices = [opd.invoice, linkedDetail.invoice, counterDetail.invoice];
  const tiedTime = new Date(`${today}T10:00:00+05:30`);
  await Promise.all([
    db
      .update(invoices)
      .set({ businessDate: olderDay })
      .where(and(eq(invoices.orgId, organization.id), eq(invoices.id, old.invoice.id))),
    db
      .update(opdAppointments)
      .set({ businessDate: olderDay })
      .where(
        and(
          eq(opdAppointments.orgId, organization.id),
          eq(opdAppointments.id, oldAttendance.appointment.id),
        ),
      ),
    db
      .update(creditNotes)
      .set({ businessDate: laterDay })
      .where(
        and(eq(creditNotes.orgId, organization.id), eq(creditNotes.id, laterCredit.creditNote.id)),
      ),
    db
      .update(refunds)
      .set({ businessDate: laterDay })
      .where(and(eq(refunds.orgId, organization.id), eq(refunds.id, refund.id))),
    ...periodInvoices.map((invoice) =>
      db
        .update(invoices)
        .set({ createdAt: tiedTime })
        .where(and(eq(invoices.orgId, organization.id), eq(invoices.id, invoice.id))),
    ),
  ]);
  const input = { orgSlug, from: today, to: today };
  const register = await api.report.invoiceRegister({ ...input, limit: 1 });
  expect(register.rows).toHaveLength(1);
  expect(register.summary!.totals).toMatchObject({
    count: 3,
    subtotal: 300_00n,
    discountAmount: 10_00n,
    taxableValue: 290_00n,
    taxTotal: 0n,
    roundOff: 0n,
    grandTotal: 290_00n,
    creditTotal: 20_00n,
    netBilled: 270_00n,
    paymentsTotal: 250_00n,
    allocationsTotal: 40_00n,
    refundsTotal: 5_00n,
    outstanding: -15_00n,
  });
  const seen = [...register.rows];
  let cursor = register.nextCursor;

  while (cursor) {
    const page = await api.report.invoiceRegister({ ...input, limit: 1, cursor });
    expect(page.summary).toBeNull();
    seen.push(...page.rows);
    cursor = page.nextCursor;

    if (seen.length > 3) throw new Error("register cursor did not advance");
  }

  expect(seen.map((row) => row.id)).toEqual(
    periodInvoices
      .map((invoice) => invoice.id)
      .sort()
      .reverse(),
  );

  for (const row of seen) {
    const invoice = periodInvoices.find((candidate) => candidate.id === row.id)!;
    const balance = await invoiceBalanceFor(db, organization.id, invoice);
    expect(row).toMatchObject({
      creditTotal: balance.creditTotal,
      paymentsTotal: balance.paymentsTotal,
      allocationsTotal: balance.allocationsTotal,
      refundsTotal: balance.refundsTotal,
      outstanding: balance.outstanding,
    });
  }

  expect(seen.find((row) => row.id === opd.invoice.id)?.source).toEqual({
    type: "opd",
    id: attendance.id,
  });
  expect(seen.find((row) => row.id === linkedDetail.invoice.id)?.source).toEqual({
    type: "pharmacy",
    id: linked.saleId,
  });
  expect(register.summary!.series.find((series) => series.stream === "opd")).toMatchObject({
    count: 1,
    fiscalYear: opd.invoice.fiscalYear,
    firstNumber: opd.invoice.invoiceNumber,
    lastNumber: opd.invoice.invoiceNumber,
  });

  const pharmacyOrder = [linkedDetail.invoice, counterDetail.invoice].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  expect(register.summary!.series.find((series) => series.stream === "pharmacy")).toMatchObject({
    count: 2,
    firstNumber: pharmacyOrder[0]!.invoiceNumber,
    lastNumber: pharmacyOrder[1]!.invoiceNumber,
  });
  expect(
    (await api.report.invoiceRegister({ ...input, stream: "pharmacy" })).summary!.totals.count,
  ).toBe(2);
  expect(
    (await api.report.invoiceRegister({ ...input, query: opd.invoice.invoiceNumber })).rows.map(
      (row) => row.id,
    ),
  ).toEqual([opd.invoice.id]);
  expect(
    (await api.report.invoiceRegister({ ...input, query: patient.mrn })).summary!.totals.count,
  ).toBe(2);
  expect(
    (await api.report.invoiceRegister({ ...input, query: "Counter snapshot" })).rows.map(
      (row) => row.id,
    ),
  ).toEqual([counterDetail.invoice.id]);
  const revenue = await api.report.revenueBreakdown(input);
  expect(revenue.totals).toMatchObject({
    issuedTaxableValue: 290_00n,
    creditedTaxableValue: 10_00n,
    netTaxableValue: 280_00n,
    tax: 0n,
    roundOff: 0n,
  });
  expect(revenue.bridge).toEqual({
    creditsToOlderInvoices: 10_00n,
    laterCreditsAgainstPeriodInvoices: 20_00n,
    registerNetTaxableValue: 270_00n,
  });
  expect(revenue.byStream.find((row) => row.id === "opd")?.netTaxableValue).toBe(80_00n);
  expect(revenue.byStream.find((row) => row.id === "pharmacy")?.netTaxableValue).toBe(200_00n);
  expect(revenue.byCategory.find((row) => row.id === "procedure")?.netTaxableValue).toBe(54_00n);
  expect(revenue.byCategory.find((row) => row.id === "lab")?.netTaxableValue).toBe(36_00n);
  expect(revenue.byCategory.find((row) => row.id === "consultation")?.netTaxableValue).toBe(
    -10_00n,
  );
  expect(revenue.byPractitioner.find((row) => row.id === null)?.netTaxableValue).toBe(100_00n);
  expect(revenue.byPractitioner.map((row) => row.netTaxableValue).sort()).toEqual(
    [-10_00n, 100_00n, 190_00n].sort(),
  );
  expect(revenue.byPractitioner.every((row) => row.roundOff === 0n)).toBe(true);

  const correctionOnly = await api.report.revenueBreakdown({
    orgSlug,
    from: laterDay,
    to: laterDay,
  });

  expect(correctionOnly.totals.netTaxableValue).toBe(-20_00n);
  expect(correctionOnly.bridge.creditsToOlderInvoices).toBe(20_00n);
  const discounts = await api.report.revenueSignals({ ...input, kind: "discount" });
  expect(discounts.summary).toMatchObject({ count: 1, amount: 10_00n });
  expect(discounts.summary!.groups).toEqual([
    expect.objectContaining({
      actorId: fixture.owner.user.id,
      reason: "Approved package concession",
      count: 1,
      amount: 10_00n,
    }),
  ]);
  expect(discounts.rows[0]).toMatchObject({
    invoiceId: opd.invoice.id,
    actorName: fixture.owner.user.name,
    reason: "Approved package concession",
  });
  const credits = await api.report.revenueSignals({ ...input, kind: "credit_note" });
  expect(credits.summary).toMatchObject({ count: 1, amount: 10_00n });
  expect(credits.summary!.groups).toEqual([
    expect.objectContaining({
      actorId: fixture.owner.user.id,
      reason: "Older invoice correction",
      count: 1,
      amount: 10_00n,
    }),
  ]);
  expect(credits.rows[0]).toMatchObject({
    id: oldCredit.creditNote.id,
    reason: "Older invoice correction",
  });
  const advanceRefunds = await api.report.revenueSignals({ ...input, kind: "refund" });
  expect(advanceRefunds.rows[0]).toMatchObject({
    invoiceId: null,
    source: { type: "advance", id: advance.id },
    amount: 10_00n,
    reason: null,
  });

  const invoiceRefunds = await api.report.revenueSignals({
    orgSlug,
    from: laterDay,
    to: laterDay,
    kind: "refund",
  });

  expect(invoiceRefunds.rows[0]).toMatchObject({
    invoiceId: opd.invoice.id,
    source: { type: "opd", id: attendance.id },
    amount: 5_00n,
    reason: "Next-day correction",
  });
  const registerBook = await workbookSheets(await api.export.invoiceRegisterXlsx(input));
  const registerRows = registerBook.get("Invoice register")!;
  expect(
    registerRows.find((row) => row["Invoice number"] === opd.invoice.invoiceNumber),
  ).toMatchObject({
    "Issued line value": 90,
    "Invoice total": 90,
    "Credit notes": 20,
    "Net billed": 70,
    Paid: 50,
    "Allocated credit": 40,
    Refunds: 5,
    Outstanding: -15,
  });
  expect(registerRows.find((row) => row["Invoice number"] === "Total")).toMatchObject({
    "Issued line value": 290,
    "Credit notes": 20,
    Paid: 250,
    "Allocated credit": 40,
    Outstanding: -15,
  });

  const workbook = await workbookSheets(
    await api.export.revenueControlXlsx({ ...input, horizonDays: 90 }),
  );

  expect(workbook.get("Revenue by stream")!.find((row) => row.Group === "Total")).toMatchObject({
    "Issued line value": 290,
    "Credited line value": 10,
    "Net billed revenue": 280,
  });
  expect(workbook.get("Correction bridge")!.map((row) => row.Amount)).toEqual([270, 10, 20, 280]);
  expect(workbook.get("Credit notes")![0]).toMatchObject({
    Record: `${oldCredit.creditNote.creditNoteNumber} · ${old.invoice.invoiceNumber}`,
    Amount: 10,
  });
  expect(workbook.get("Refunds")![0]).toMatchObject({ Amount: 10 });
  await expectORPCCode(
    api.export.revenueControlXlsx({ orgSlug, from: today, to: addDays(today, 92) }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    api.report.invoiceRegister({ orgSlug, from: today, to: addDays(today, 366) }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    api.report.revenueBreakdown({ orgSlug, from: laterDay, to: today }),
    "BAD_REQUEST",
  );
});

test("review signals distinguish free care, voided care and zero-priced Charges without mutating past bookings", async () => {
  const fixture = await createAccountingFixture("accounting-free-care-review");
  const { api, organization } = fixture;
  const orgSlug = organization.slug;
  const today = reportDate();
  const yesterday = addDays(today, -1);
  const free = await fixture.createOpdAppointment();
  const voided = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(voided.id, 70_00n);
  const zero = await fixture.createOpdAppointment();
  await fixture.addOtherCharge(zero.id, 0n);
  const details = await api.opd.get({ orgSlug, appointmentId: voided.id });
  const charge = details.charges[0]!;
  await api.billing.voidCharge({ orgSlug, chargeId: charge.id, reason: "Authorized free care" });

  const past = await api.opd.book({
    orgSlug,
    patientId: fixture.patient.id,
    practitionerId: details.appointment.practitionerId,
    scheduledLocal: "2030-03-16T10:30",
  });

  await db
    .update(opdAppointments)
    .set({
      businessDate: yesterday,
      scheduledFor: new Date(`${yesterday}T10:30:00+05:30`),
    })
    .where(and(eq(opdAppointments.orgId, organization.id), eq(opdAppointments.id, past.id)));
  // Last update is yesterday UTC but today in the organization's timezone.
  await db
    .update(charges)
    .set({ updatedAt: new Date(`${yesterday}T22:00:00Z`) })
    .where(and(eq(charges.orgId, organization.id), eq(charges.id, charge.id)));

  const snapshot = () =>
    Promise.all([
      db
        .select()
        .from(opdAppointments)
        .where(eq(opdAppointments.orgId, organization.id))
        .orderBy(opdAppointments.id),
      db.select().from(charges).where(eq(charges.orgId, organization.id)).orderBy(charges.id),
      db.select().from(invoices).where(eq(invoices.orgId, organization.id)).orderBy(invoices.id),
      db.select().from(payments).where(eq(payments.orgId, organization.id)).orderBy(payments.id),
      db.select().from(refunds).where(eq(refunds.orgId, organization.id)).orderBy(refunds.id),
    ]);

  const before = await snapshot();
  const input = { orgSlug, from: yesterday, to: today };
  const signals = await api.report.revenueSignals({ ...input, kind: "no_charge", limit: 1 });
  expect(signals.summary).toMatchObject({ count: 2, amount: null });
  expect(signals.rows).toHaveLength(1);

  if (!signals.nextCursor) throw new Error("expected a second no-Charge page");

  const next = await api.report.revenueSignals({
    ...input,
    kind: "no_charge",
    limit: 1,
    cursor: signals.nextCursor,
  });

  expect(next.nextCursor).toBeNull();
  expect(next.summary).toBeNull();
  const rows = [...signals.rows, ...next.rows];
  expect(rows.find((row) => row.id === free.id)).toMatchObject({
    classification: "never_charged",
    amount: null,
    reason: null,
    source: { type: "opd", id: free.id },
  });
  expect(rows.find((row) => row.id === voided.id)).toMatchObject({
    classification: "all_charges_voided",
    amount: null,
  });
  expect(rows.some((row) => row.id === zero.id || row.id === past.id)).toBe(false);
  const voids = await api.report.revenueSignals({ ...input, kind: "voided_charge" });
  expect(voids.rows[0]).toMatchObject({
    id: charge.id,
    eventDate: today,
    amount: 70_00n,
    quantity: 1,
    reason: "Authorized free care",
    creatorName: fixture.owner.user.name,
    actorName: null,
  });
  expect(
    (
      await api.report.revenueSignals({
        orgSlug,
        from: yesterday,
        to: yesterday,
        kind: "voided_charge",
      })
    ).rows,
  ).toEqual([]);
  await Promise.all([
    api.report.invoiceRegister(input),
    api.report.revenueBreakdown(input),
    api.report.expiryExposure({ orgSlug }),
  ]);
  expect(await snapshot()).toEqual(before);
  expect(before[0].find((row) => row.id === past.id)?.status).toBe("booked");
  await expectORPCCode(
    api.report.revenueSignals({
      orgSlug,
      from: yesterday,
      to: addDays(yesterday, 92),
      kind: "no_charge",
    }),
    "BAD_REQUEST",
  );
});
