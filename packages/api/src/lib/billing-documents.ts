import { nextCounter, type DbTransaction } from "@hms/db/counter";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { advanceRemaining } from "./advance-credit";
import { businessDate, businessDateAnchor } from "./business-date";
import { impossible } from "./conflict";
import { invoiceBalanceFor } from "./invoice-balance";
import {
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  InvoiceDiscountExceededError,
  fiscalYearLabel,
} from "./invoice-math";
import {
  postJournalEntries,
  revenueAccountFor,
  settlementAccountFor,
  type SystemAccountKey,
} from "./ledger";
import type { PaymentMethod } from "./schemas";
import { readOrgSettings, type OrgSettings } from "./settings-cache";

export type BillingDocumentContext = {
  settings: OrgSettings;
  now: Date;
  fiscalYear: string;
};

export async function billingDocumentContext(orgId: string): Promise<BillingDocumentContext> {
  const settings = await readOrgSettings(orgId);
  const now = new Date();

  const fiscalYear = fiscalYearLabel(
    businessDateAnchor(now, settings.timeZone),
    settings.fiscalYearStartMonth,
  );

  return { settings, now, fiscalYear };
}

export type LockedInvoice = {
  id: string;
  invoiceNumber: string;
  grandTotal: bigint;
  roundOff: bigint;
  patientId: string | null;
  stream: "opd" | "pharmacy";
  treatmentPlanId: string | null;
};

/** The OPD Appointment is a left join: a pharmacy invoice has no appointment. */
export async function lockInvoice(
  tx: DbTransaction,
  orgId: string,
  invoiceId: string,
): Promise<LockedInvoice> {
  const [invoice] = await tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      grandTotal: invoices.grandTotal,
      roundOff: invoices.roundOff,
      patientId: invoices.patientId,
      stream: invoices.stream,
      treatmentPlanId: opdAppointments.treatmentPlanId,
    })
    .from(invoices)
    .leftJoin(
      opdAppointments,
      and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, invoices.opdAppointmentId)),
    )
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .limit(1)
    .for("update", { of: invoices });

  if (!invoice) {
    throw new ORPCError("NOT_FOUND", { message: "That invoice no longer exists." });
  }

  return invoice;
}

async function applyPatientCreditTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    invoice: LockedInvoice;
    amount: bigint;
    now: Date;
    timeZone: string;
  },
) {
  const { scope, invoice } = args;

  if (args.amount === 0n) return;

  const { patientId } = invoice;

  if (patientId === null) {
    throw new ORPCError("CONFLICT", {
      message: "Patient credit needs a patient on the invoice.",
    });
  }

  // Lock in one stable order, then read balances in a new statement: under READ COMMITTED
  // only a statement that starts after the lock sees allocations committed while it waited.
  // Credit only shrinks, so a receipt already spent in this snapshot is never locked.
  const locked = await tx
    .select({ id: advanceReceipts.id })
    .from(advanceReceipts)
    .where(
      and(
        eq(advanceReceipts.orgId, scope.orgId),
        eq(advanceReceipts.patientId, patientId),
        sql`${advanceRemaining(scope.orgId)} > 0`,
      ),
    )
    .orderBy(asc(advanceReceipts.createdAt), asc(advanceReceipts.id))
    .for("update");

  const receipts = await tx
    .select({
      id: advanceReceipts.id,
      treatmentPlanId: advanceReceipts.treatmentPlanId,
      remaining: advanceRemaining(scope.orgId),
    })
    .from(advanceReceipts)
    .where(
      and(
        eq(advanceReceipts.orgId, scope.orgId),
        eq(advanceReceipts.patientId, patientId),
        inArray(
          advanceReceipts.id,
          locked.map((receipt) => receipt.id),
        ),
      ),
    )
    .orderBy(asc(advanceReceipts.createdAt), asc(advanceReceipts.id));

  const available = receipts.reduce((sum, receipt) => sum + receipt.remaining, 0n);

  if (args.amount > available) {
    throw new ORPCError("CONFLICT", { message: "That credit is no longer available." });
  }

  // This visit's plan first, then untagged credit, and another plan's advance only last:
  // money taken for one course is never the first to pay for something else. The sort
  // is stable, so each group stays oldest-first.
  const rank = (receipt: { treatmentPlanId: string | null }) =>
    receipt.treatmentPlanId === invoice.treatmentPlanId
      ? 0
      : receipt.treatmentPlanId === null
        ? 1
        : 2;

  receipts.sort((first, second) => rank(first) - rank(second));

  let due = args.amount;
  const rows: Array<typeof advanceAllocations.$inferInsert> = [];

  for (const receipt of receipts) {
    const amount = receipt.remaining < due ? receipt.remaining : due;

    if (amount === 0n) continue;

    rows.push({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      advanceReceiptId: receipt.id,
      invoiceId: invoice.id,
      amount,
      allocatedBy: scope.userId,
      createdAt: args.now,
    });
    due -= amount;
  }

  const inserted = await tx.insert(advanceAllocations).values(rows).returning();

  await postJournalEntries(
    tx,
    scope.orgId,
    inserted.map((allocation) => ({
      sourceType: "advance_allocation",
      sourceId: allocation.id,
      narration: `Advance allocation · Invoice ${invoice.invoiceNumber}`,
      createdBy: scope.userId,
      now: args.now,
      timeZone: args.timeZone,
      lines: [
        { account: "patient_advances", debit: allocation.amount },
        { account: "patient_receivables", credit: allocation.amount },
      ],
    })),
  );
}

/**
 * Which care record the invoice and its charges hang off, plus the buyer printed on it.
 * A pharmacy counter sale has no Patient record unless the pharmacist named one.
 */
export type InvoiceParent =
  | {
      stream: "opd";
      opdAppointmentId: string;
      patient: {
        id: string;
        name: string;
        mrn: string;
        phone: string;
        address: string | null;
        guardian: string | null;
      };
    }
  | {
      stream: "pharmacy";
      pharmacySaleId: string;
      patient: {
        id: string | null;
        name: string;
        mrn: string | null;
        phone: string | null;
        address: null;
        guardian: null;
      };
    };

/**
 * Numbers, stores, and posts one Invoice from its parent's pending Charges. It owns
 * documents and money only: parent eligibility belongs to the caller's desk.
 */
export async function issueInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    parent: InvoiceParent;
    discountAmount: bigint;
    note?: string;
    settings: OrgSettings;
    now: Date;
    fiscalYear: string;
    invoiceId: string;
  },
) {
  const { scope, parent, settings, now, fiscalYear, invoiceId } = args;

  if (args.discountAmount > 0n && !args.note) {
    throw new ORPCError("BAD_REQUEST", { message: "Add a reason for the discount" });
  }

  const parentCharges =
    parent.stream === "opd"
      ? eq(charges.opdAppointmentId, parent.opdAppointmentId)
      : eq(charges.pharmacySaleId, parent.pharmacySaleId);

  const pendingCharges = await tx
    .select({
      chargeId: charges.id,
      revenueCategory: charges.revenueCategory,
      description: charges.description,
      qty: charges.qty,
      unitPrice: charges.unitPrice,
      priceUnits: charges.priceUnits,
      taxRatePercent: charges.taxRatePercent,
      taxCode: charges.taxCode,
    })
    .from(charges)
    .where(and(eq(charges.orgId, scope.orgId), parentCharges, eq(charges.status, "pending")))
    .orderBy(asc(charges.createdAt), asc(charges.id))
    .for("update");

  if (pendingCharges.length === 0) {
    throw new ORPCError("CONFLICT", {
      message: "These charges were already settled or voided.",
    });
  }

  let computed: ReturnType<typeof computeInvoiceLines>;

  try {
    computed = computeInvoiceLines(pendingCharges, args.discountAmount, parent.stream);
  } catch (error) {
    if (!(error instanceof InvoiceDiscountExceededError)) throw error;
    throw new ORPCError("BAD_REQUEST", {
      message: "The charges changed. Review the invoice and try again",
    });
  }

  const categoryByChargeId = new Map(
    pendingCharges.map((charge) => [charge.chargeId, charge.revenueCategory]),
  );

  const computedWithRevenue = computed.lines.map((line) => {
    const revenueCategory = categoryByChargeId.get(line.chargeId);

    if (revenueCategory === undefined) {
      throw new Error(`Revenue category missing for charge ${line.chargeId}`);
    }

    return { ...line, revenueCategory };
  });

  const sequence = await nextCounter(
    tx,
    scope.orgId,
    parent.stream === "opd" ? `invoice:${fiscalYear}` : `invoice:pharmacy:${fiscalYear}`,
  );

  const invoiceNumber = documentNumber(
    parent.stream === "opd" ? settings.invoicePrefix : settings.pharmacyInvoicePrefix,
    fiscalYear,
    sequence,
  );

  const [invoice] = await tx
    .insert(invoices)
    .values({
      id: invoiceId,
      orgId: scope.orgId,
      stream: parent.stream,
      opdAppointmentId: parent.stream === "opd" ? parent.opdAppointmentId : null,
      pharmacySaleId: parent.stream === "pharmacy" ? parent.pharmacySaleId : null,
      patientId: parent.patient.id,
      invoiceNumber,
      fiscalYear,
      businessDate: businessDate(now, settings.timeZone),
      discountAmount: args.discountAmount,
      note: args.note ?? null,
      subtotal: computed.subtotal,
      taxTotal: computed.taxTotal,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal,
      orgLegalName: settings.legalName,
      orgAddress: settings.address,
      orgTaxId: settings.taxId,
      currency: settings.currency,
      patientName: parent.patient.name,
      patientMrn: parent.patient.mrn,
      patientPhone: parent.patient.phone,
      patientAddress: parent.patient.address,
      patientGuardian: parent.patient.guardian,
      issuedBy: scope.userId,
      createdAt: now,
    })
    .returning();

  if (!invoice) throw impossible("invoice insert returned no row");

  const insertedLines = await tx
    .insert(invoiceLines)
    .values(
      computedWithRevenue.map((line) => ({
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        invoiceId,
        ...line,
      })),
    )
    .returning();

  const flippedCharges = await tx
    .update(charges)
    .set({ status: "invoiced", invoiceId, updatedAt: now })
    .where(
      and(
        eq(charges.orgId, scope.orgId),
        parentCharges,
        inArray(
          charges.id,
          computedWithRevenue.map((line) => line.chargeId),
        ),
        eq(charges.status, "pending"),
      ),
    )
    .returning({ id: charges.id });

  // The charges were locked FOR UPDATE above, so nothing can have flipped them since.
  if (flippedCharges.length !== computedWithRevenue.length) {
    throw impossible("locked pending charges changed status mid-transaction");
  }

  const revenueByAccount = new Map<SystemAccountKey, bigint>();

  for (const line of computedWithRevenue) {
    const account = revenueAccountFor(line.revenueCategory);
    revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0n) + line.taxableValue);
  }

  if (computed.grandTotal > 0n || computed.roundOff !== 0n) {
    await postJournalEntries(tx, scope.orgId, [
      {
        sourceType: "invoice",
        sourceId: invoiceId,
        narration: `Invoice ${invoiceNumber}`,
        createdBy: scope.userId,
        now,
        timeZone: settings.timeZone,
        lines: [
          { account: "patient_receivables", debit: computed.grandTotal },
          ...[...revenueByAccount].map(([account, amount]) => ({
            account,
            credit: amount,
          })),
          ...(computed.taxTotal > 0n
            ? [{ account: "gst_output" as const, credit: computed.taxTotal }]
            : []),
          ...(computed.roundOff > 0n
            ? [{ account: "round_off" as const, credit: computed.roundOff }]
            : computed.roundOff < 0n
              ? [{ account: "round_off" as const, debit: -computed.roundOff }]
              : []),
        ],
      },
    ]);
  }

  return { invoice, lines: insertedLines };
}

export async function recordPaymentsTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    invoiceId: string;
    payments: Array<{ method: PaymentMethod; amount: bigint; reference?: string }>;
    applyCredit: bigint;
    settings: OrgSettings;
    now: Date;
    fiscalYear: string;
  },
) {
  const { scope, settings, now, fiscalYear } = args;
  const invoice = await lockInvoice(tx, scope.orgId, args.invoiceId);

  const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
  const collectedPaise = args.payments.reduce((sum, payment) => sum + payment.amount, 0n);
  const outstanding = balance.outstanding > 0n ? balance.outstanding : 0n;

  if (args.applyCredit > outstanding) {
    throw new ORPCError("CONFLICT", {
      message: "That credit is more than the invoice still owes.",
    });
  }

  if (collectedPaise > outstanding - args.applyCredit) {
    throw new ORPCError("CONFLICT", {
      message: "That payment is more than the invoice still owes.",
    });
  }

  await applyPatientCreditTx(tx, {
    scope,
    invoice,
    amount: args.applyCredit,
    now,
    timeZone: settings.timeZone,
  });

  if (args.payments.length === 0) return [];

  const firstSequence = await nextCounter(
    tx,
    scope.orgId,
    `receipt:${fiscalYear}`,
    args.payments.length,
  );

  const recorded = await tx
    .insert(payments)
    .values(
      args.payments.map((payment, index) => ({
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        invoiceId: args.invoiceId,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
        receiptNumber: documentNumber(settings.receiptPrefix, fiscalYear, firstSequence + index),
        fiscalYear,
        businessDate: businessDate(now, settings.timeZone),
        receivedBy: scope.userId,
        createdAt: now,
      })),
    )
    .returning();

  await postJournalEntries(
    tx,
    scope.orgId,
    recorded.map((payment) => ({
      sourceType: "payment",
      sourceId: payment.id,
      narration: `Receipt ${payment.receiptNumber} · Invoice ${invoice.invoiceNumber}`,
      createdBy: scope.userId,
      now,
      timeZone: settings.timeZone,
      lines: [
        { account: settlementAccountFor(payment.method), debit: payment.amount },
        { account: "patient_receivables", credit: payment.amount },
      ],
    })),
  );

  return recorded;
}

/**
 * What the caller wants credited on one invoice line: the whole remainder, a gross amount
 * whose tax this helper extracts, or exact amounts a pharmacy return already apportioned.
 */
export type CreditNoteLineRequest =
  | { invoiceLineId: string; full: true }
  | { invoiceLineId: string; gross: bigint }
  | { invoiceLineId: string; taxableValue: bigint; taxAmount: bigint; gross: bigint };

/** Numbers, stores, and posts one Credit Note once its caller has decided which lines. */
export async function postCreditNoteTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    invoiceId: string;
    reason: string;
    lines: CreditNoteLineRequest[];
    roundOff: bigint;
    settings: OrgSettings;
    now: Date;
    fiscalYear: string;
    creditNoteId: string;
  },
) {
  const { scope, settings, now, fiscalYear, creditNoteId } = args;
  const invoice = await lockInvoice(tx, scope.orgId, args.invoiceId);
  const requestedIds = args.lines.map((line) => line.invoiceLineId);

  const [sourceLines, [priorCredit], priorLines] = await Promise.all([
    tx
      .select({
        id: invoiceLines.id,
        revenueCategory: invoiceLines.revenueCategory,
        taxRatePercent: invoiceLines.taxRatePercent,
        taxableValue: invoiceLines.taxableValue,
        taxAmount: invoiceLines.taxAmount,
        gross: invoiceLines.gross,
      })
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.orgId, scope.orgId),
          eq(invoiceLines.invoiceId, args.invoiceId),
          inArray(invoiceLines.id, requestedIds),
        ),
      ),
    tx
      .select({ total: sql`coalesce(sum(${creditNotes.total}), 0)::bigint`.mapWith(BigInt) })
      .from(creditNotes)
      .where(and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, args.invoiceId))),
    tx
      .select({
        invoiceLineId: creditNoteLines.invoiceLineId,
        taxableValue: creditNoteLines.taxableValue,
        taxAmount: creditNoteLines.taxAmount,
        gross: creditNoteLines.gross,
      })
      .from(creditNoteLines)
      .innerJoin(
        creditNotes,
        and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.id, creditNoteLines.creditNoteId)),
      )
      .where(
        and(eq(creditNoteLines.orgId, scope.orgId), eq(creditNotes.invoiceId, args.invoiceId)),
      ),
  ]);

  if (sourceLines.length !== requestedIds.length) {
    throw new ORPCError("NOT_FOUND", {
      message: "One of those invoice lines no longer exists.",
    });
  }

  const creditedByLine = new Map<
    string,
    { taxableValue: bigint; taxAmount: bigint; gross: bigint }
  >();

  for (const line of priorLines) {
    const credited = creditedByLine.get(line.invoiceLineId) ?? {
      taxableValue: 0n,
      taxAmount: 0n,
      gross: 0n,
    };

    credited.taxableValue += line.taxableValue;
    credited.taxAmount += line.taxAmount;
    credited.gross += line.gross;
    creditedByLine.set(line.invoiceLineId, credited);
  }

  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));

  const computedLines = args.lines.map((requested) => {
    const source = sourceById.get(requested.invoiceLineId)!;

    const prior = creditedByLine.get(source.id) ?? {
      taxableValue: 0n,
      taxAmount: 0n,
      gross: 0n,
    };

    let values: { taxableValue: bigint; taxAmount: bigint; gross: bigint };

    if ("full" in requested) {
      const remainingGross = source.gross - prior.gross;

      if (remainingGross <= 0n) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This line is already fully credited.",
        });
      }

      values = {
        taxableValue: source.taxableValue - prior.taxableValue,
        taxAmount: source.taxAmount - prior.taxAmount,
        gross: remainingGross,
      };
    } else if ("taxableValue" in requested) {
      values = {
        taxableValue: requested.taxableValue,
        taxAmount: requested.taxAmount,
        gross: requested.gross,
      };
    } else {
      values = derivePartialCredit(requested.gross, source.taxRatePercent);
    }

    if (
      prior.taxableValue + values.taxableValue > source.taxableValue ||
      prior.taxAmount + values.taxAmount > source.taxAmount ||
      prior.gross + values.gross > source.gross
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That credit is more than the invoice line is worth.",
      });
    }

    return { invoiceLineId: source.id, revenueCategory: source.revenueCategory, ...values };
  });

  const subtotalPaise = computedLines.reduce((sum, line) => sum + line.taxableValue, 0n);
  const taxTotalPaise = computedLines.reduce((sum, line) => sum + line.taxAmount, 0n);
  const totalPaise = computedLines.reduce((sum, line) => sum + line.gross, args.roundOff);
  const priorCreditPaise = priorCredit?.total ?? 0n;

  if (priorCreditPaise + totalPaise > invoice.grandTotal) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Total credits would exceed the invoice.",
    });
  }

  const sequence = await nextCounter(tx, scope.orgId, `creditNote:${fiscalYear}`);
  const creditNoteNumber = documentNumber(settings.creditNotePrefix, fiscalYear, sequence);

  const [creditNote] = await tx
    .insert(creditNotes)
    .values({
      id: creditNoteId,
      orgId: scope.orgId,
      invoiceId: args.invoiceId,
      creditNoteNumber,
      fiscalYear,
      businessDate: businessDate(now, settings.timeZone),
      reason: args.reason,
      subtotal: subtotalPaise,
      taxTotal: taxTotalPaise,
      roundOff: args.roundOff,
      total: totalPaise,
      issuedBy: scope.userId,
      createdAt: now,
    })
    .returning();

  if (!creditNote) throw impossible("credit note insert returned no row");

  const insertedLines =
    computedLines.length === 0
      ? []
      : await tx
          .insert(creditNoteLines)
          .values(
            computedLines.map(({ revenueCategory: _revenueCategory, ...line }) => ({
              id: Bun.randomUUIDv7(),
              orgId: scope.orgId,
              creditNoteId,
              ...line,
            })),
          )
          .returning();

  const revenueByAccount = new Map<SystemAccountKey, bigint>();

  for (const line of computedLines) {
    const account = revenueAccountFor(line.revenueCategory);
    revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0n) + line.taxableValue);
  }

  await postJournalEntries(tx, scope.orgId, [
    {
      sourceType: "credit_note",
      sourceId: creditNoteId,
      narration: `Credit note ${creditNoteNumber} · Invoice ${invoice.invoiceNumber}`,
      createdBy: scope.userId,
      now,
      timeZone: settings.timeZone,
      lines: [
        ...[...revenueByAccount].map(([account, amount]) => ({
          account,
          debit: amount,
        })),
        ...(taxTotalPaise > 0n ? [{ account: "gst_output" as const, debit: taxTotalPaise }] : []),
        ...(args.roundOff > 0n
          ? [{ account: "round_off" as const, debit: args.roundOff }]
          : args.roundOff < 0n
            ? [{ account: "round_off" as const, credit: -args.roundOff }]
            : []),
        { account: "patient_receivables", credit: totalPaise },
      ],
    },
  ]);

  return { creditNote, lines: insertedLines, invoice };
}

/** Numbers, stores, and posts one Refund once its caller has locked and capped the source. */
export async function insertRefundTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    settings: { timeZone: string };
    now: Date;
    fiscalYear: string;
    refundId: string;
    line: { method: PaymentMethod; amount: bigint; reference?: string };
    source: {
      invoiceId: string | null;
      creditNoteId: string | null;
      advanceReceiptId: string | null;
    };
    debit: "patient_advances" | "patient_receivables";
    narration: string;
  },
) {
  const { scope, fiscalYear, now } = args;
  const sequence = await nextCounter(tx, scope.orgId, `refund:${fiscalYear}`);
  const refundNumber = documentNumber("RF", fiscalYear, sequence);

  const [inserted] = await tx
    .insert(refunds)
    .values({
      id: args.refundId,
      orgId: scope.orgId,
      ...args.source,
      method: args.line.method,
      amount: args.line.amount,
      reference: args.line.reference ?? null,
      refundNumber,
      fiscalYear,
      businessDate: businessDate(now, args.settings.timeZone),
      refundedBy: scope.userId,
      createdAt: now,
    })
    .returning();

  if (!inserted) throw impossible("refund insert returned no row");

  await postJournalEntries(tx, scope.orgId, [
    {
      sourceType: "refund",
      sourceId: args.refundId,
      narration: `Refund ${refundNumber} · ${args.narration}`,
      createdBy: scope.userId,
      now,
      timeZone: args.settings.timeZone,
      lines: [
        { account: args.debit, debit: inserted.amount },
        { account: settlementAccountFor(args.line.method), credit: inserted.amount },
      ],
    },
  ]);

  return inserted;
}
