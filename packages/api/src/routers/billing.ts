import { db } from "@hms/db";
import { nextCounter, type DbTransaction } from "@hms/db/counter";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { businessDate, businessDateAnchor } from "../lib/business-date";
import { conflict, impossible } from "../lib/conflict";
import { invoiceBalanceFor, invoiceBalancesFor } from "../lib/invoice-balance";
import {
  calculateInvoiceBalance,
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  fiscalYearLabel,
  fromPaise,
  toPaise,
  toSignedPaise,
} from "../lib/invoice-math";
import {
  postJournalEntry,
  revenueAccountFor,
  settlementAccountFor,
  type SystemAccountKey,
} from "../lib/ledger";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import { billingWorklistRouter } from "./billing-worklist";
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const positiveMoney = money.refine((value) => toPaise(value) > 0);
const paymentMethod = z.enum(["cash", "upi", "card"]);
type PaymentMethod = z.infer<typeof paymentMethod>;

// These statuses guarantee a linked patient via the schema's arrived check; booked
// rows may have none, and closed rows must not accumulate charges.
const BILLABLE_STATUSES: (typeof opdAppointments.$inferSelect)["status"][] = ["checked_in"];

const chargeLineInput = z.object({
  catalogItemId: z.string(),
  qty: z.number().int().min(1).max(999).default(1),
});

const chargeLinesInput = z
  .array(chargeLineInput)
  .max(20)
  .refine((lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length);

const paymentLineInput = z.object({
  method: paymentMethod,
  amount: positiveMoney,
  reference: z.string().trim().min(1).max(100).optional(),
});

const creditLineInput = z.union([
  z.object({ invoiceLineId: z.string(), full: z.literal(true) }).strict(),
  z.object({ invoiceLineId: z.string(), gross: positiveMoney }).strict(),
]);

export async function billingDocumentContext(orgId: string) {
  const settings = await readOrgSettings(orgId);
  const now = new Date();
  const fiscalYear = fiscalYearLabel(
    businessDateAnchor(now, settings.timeZone),
    settings.fiscalYearStartMonth,
  );
  return { settings, now, fiscalYear };
}

async function lockInvoice(tx: DbTransaction, orgId: string, invoiceId: string) {
  const [invoice] = await tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      grandTotal: invoices.grandTotal,
    })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, invoiceId)))
    .limit(1)
    .for("update");

  if (!invoice) {
    throw new ORPCError("NOT_FOUND", { message: "That invoice no longer exists." });
  }
  return invoice;
}

// The caller owns the transaction: the walk-in desk settles token, charge, invoice
// and receipt in one commit.
async function issueInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    discountAmount: string;
    note?: string;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
    now: Date;
    fiscalYear: string;
    invoiceId: string;
    expectedChargeRevision: number | "fresh";
  },
) {
  const { scope, settings, now, fiscalYear, invoiceId } = args;
  // Held here so every caller obeys it — no entry point may discount without a reason.
  if (toPaise(args.discountAmount) > 0 && !args.note) {
    throw new ORPCError("BAD_REQUEST", { message: "Add a reason for the discount" });
  }
  const [appointmentAndPatient] = await tx
    .select({
      appointmentStatus: opdAppointments.status,
      opdAppointmentId: opdAppointments.id,
      chargeRevision: opdAppointments.chargeRevision,
      patientId: patients.id,
      patientName: patients.name,
      patientMrn: patients.mrn,
      patientPhone: patients.phone,
      patientAddress: patients.address,
    })
    .from(opdAppointments)
    .innerJoin(
      patients,
      and(eq(patients.orgId, scope.orgId), eq(patients.id, opdAppointments.patientId)),
    )
    .where(and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, args.appointmentId)))
    .limit(1)
    .for("update", { of: opdAppointments });

  if (!appointmentAndPatient) {
    throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });
  }
  if (!BILLABLE_STATUSES.includes(appointmentAndPatient.appointmentStatus)) {
    throw conflict("not_billable", "This appointment can no longer be billed.");
  }
  if (
    args.expectedChargeRevision !== "fresh" &&
    appointmentAndPatient.chargeRevision !== args.expectedChargeRevision
  ) {
    throw conflict("raced", "The charges changed. Review the invoice and try again");
  }

  const pendingCharges = await tx
    .select({
      chargeId: charges.id,
      revenueCategory: charges.revenueCategory,
      description: charges.description,
      qty: charges.qty,
      unitPrice: charges.unitPrice,
      taxRatePercent: charges.taxRatePercent,
      taxCode: charges.taxCode,
    })
    .from(charges)
    .where(
      and(
        eq(charges.orgId, scope.orgId),
        eq(charges.opdAppointmentId, appointmentAndPatient.opdAppointmentId),
        eq(charges.status, "pending"),
      ),
    )
    .orderBy(asc(charges.createdAt), asc(charges.id))
    .for("update");

  if (pendingCharges.length === 0) {
    throw conflict("no_pending_charges", "These charges were already settled or voided.");
  }
  const subtotalPaise = pendingCharges.reduce(
    (sum, charge) => sum + charge.qty * toPaise(charge.unitPrice),
    0,
  );
  if (toPaise(args.discountAmount) > subtotalPaise) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The charges changed. Review the invoice and try again",
    });
  }

  const computed = computeInvoiceLines(pendingCharges, args.discountAmount);
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
  const sequence = await nextCounter(tx, scope.orgId, `invoice:${fiscalYear}`);
  const invoiceNumber = documentNumber(settings.invoicePrefix, fiscalYear, sequence);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      id: invoiceId,
      orgId: scope.orgId,
      opdAppointmentId: appointmentAndPatient.opdAppointmentId,
      patientId: appointmentAndPatient.patientId,
      invoiceNumber,
      fiscalYear,
      businessDate: businessDate(now, settings.timeZone),
      discountAmount: args.discountAmount,
      note: args.note ?? null,
      subtotal: computed.subtotal,
      taxTotal: computed.taxTotal,
      grandTotal: computed.grandTotal,
      orgLegalName: settings.legalName,
      orgAddress: settings.address,
      orgTaxId: settings.taxId,
      currency: settings.currency,
      patientName: appointmentAndPatient.patientName,
      patientMrn: appointmentAndPatient.patientMrn,
      patientPhone: appointmentAndPatient.patientPhone,
      patientAddress: appointmentAndPatient.patientAddress,
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
        eq(charges.opdAppointmentId, appointmentAndPatient.opdAppointmentId),
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
  const revenueByAccount = new Map<SystemAccountKey, number>();
  for (const line of computedWithRevenue) {
    const account = revenueAccountFor(line.revenueCategory);
    revenueByAccount.set(
      account,
      (revenueByAccount.get(account) ?? 0) + toPaise(line.taxableValue),
    );
  }

  const grandTotalPaise = toPaise(computed.grandTotal);
  if (grandTotalPaise > 0) {
    const taxTotalPaise = toPaise(computed.taxTotal);
    await postJournalEntry(tx, {
      orgId: scope.orgId,
      sourceType: "invoice",
      sourceId: invoiceId,
      narration: `Invoice ${invoiceNumber}`,
      createdBy: scope.userId,
      now,
      timeZone: settings.timeZone,
      lines: [
        { account: "patient_receivables", debit: fromPaise(grandTotalPaise) },
        ...[...revenueByAccount].map(([account, amount]) => ({
          account,
          credit: fromPaise(amount),
        })),
        ...(taxTotalPaise > 0
          ? [{ account: "gst_output" as const, credit: fromPaise(taxTotalPaise) }]
          : []),
      ],
    });
  }

  const [versionedAppointment] = await tx
    .update(opdAppointments)
    .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
    .where(
      and(
        eq(opdAppointments.orgId, scope.orgId),
        eq(opdAppointments.id, appointmentAndPatient.opdAppointmentId),
      ),
    )
    .returning({ chargeRevision: opdAppointments.chargeRevision });
  if (!versionedAppointment) throw impossible("locked appointment vanished before versioning");

  return { invoice, lines: insertedLines, chargeRevision: versionedAppointment.chargeRevision };
}

async function recordPaymentsTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    invoiceId: string;
    payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
    now: Date;
    fiscalYear: string;
  },
) {
  const { scope, settings, now, fiscalYear } = args;
  for (const payment of args.payments) {
    if (payment.method !== "cash" && !payment.reference?.trim()) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Add a transaction reference for this payment",
      });
    }
  }
  const invoice = await lockInvoice(tx, scope.orgId, args.invoiceId);

  const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
  const outstandingPaise = toSignedPaise(balance.outstanding);
  const collectedPaise = args.payments.reduce((sum, payment) => sum + toPaise(payment.amount), 0);
  if (collectedPaise > Math.max(0, outstandingPaise)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "That payment is more than the invoice still owes.",
    });
  }

  const recorded = [];
  for (const payment of args.payments) {
    const paymentId = Bun.randomUUIDv7();
    const sequence = await nextCounter(tx, scope.orgId, `receipt:${fiscalYear}`);
    const receiptNumber = documentNumber(settings.receiptPrefix, fiscalYear, sequence);
    const [inserted] = await tx
      .insert(payments)
      .values({
        id: paymentId,
        orgId: scope.orgId,
        invoiceId: args.invoiceId,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
        receiptNumber,
        fiscalYear,
        businessDate: businessDate(now, settings.timeZone),
        receivedBy: scope.userId,
        createdAt: now,
      })
      .returning();

    if (!inserted) throw impossible("payment insert returned no row");
    await postJournalEntry(tx, {
      orgId: scope.orgId,
      sourceType: "payment",
      sourceId: paymentId,
      narration: `Receipt ${receiptNumber} · Invoice ${invoice.invoiceNumber}`,
      createdBy: scope.userId,
      now,
      timeZone: settings.timeZone,
      lines: [
        { account: settlementAccountFor(payment.method), debit: inserted.amount },
        { account: "patient_receivables", credit: inserted.amount },
      ],
    });
    recorded.push(inserted);
  }
  return recorded;
}

// Billing owns the reviewed total, collection bounds and payment rules; the care
// workflow owns the records around them.
export async function settleInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    discountAmount: string;
    note?: string;
    payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
    now: Date;
    fiscalYear: string;
    invoiceId: string;
    expectedGrandTotal: string;
    // "fresh" declares the care row was created in this transaction, so no concurrent charge writer exists.
    expectedChargeRevision: number | "fresh";
  },
) {
  const issued = await issueInvoiceTx(tx, args);
  if (toPaise(issued.invoice.grandTotal) !== toPaise(args.expectedGrandTotal)) {
    throw conflict(
      "catalog_price_changed",
      "The charges changed. Review the invoice and try again",
    );
  }

  const collected = args.payments.reduce((sum, payment) => sum + toPaise(payment.amount), 0);
  const due = toPaise(issued.invoice.grandTotal);
  if (collected > due) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Collected amount cannot exceed the invoice total",
    });
  }
  if (collected < due && !args.note) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Add a reason for the outstanding balance",
    });
  }
  const recorded = await recordPaymentsTx(tx, {
    scope: args.scope,
    invoiceId: args.invoiceId,
    payments: args.payments,
    settings: args.settings,
    now: args.now,
    fiscalYear: args.fiscalYear,
  });
  return { ...issued, payments: recorded };
}

async function addChargesTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    lines: Array<{ catalogItemId: string; qty: number }>;
    expectedChargeRevision: number;
  },
) {
  const { scope } = args;
  // Cancellation updates this row before voiding pending charges. Taking the
  // same lock makes the state check and all inserts one serial decision.
  const [appointment] = await tx
    .select({
      status: opdAppointments.status,
      id: opdAppointments.id,
      chargeRevision: opdAppointments.chargeRevision,
    })
    .from(opdAppointments)
    .where(and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, args.appointmentId)))
    .limit(1)
    .for("update");

  if (!appointment)
    throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });
  if (!BILLABLE_STATUSES.includes(appointment.status)) {
    throw conflict("not_billable", "This appointment can no longer be billed.");
  }
  if (appointment.chargeRevision !== args.expectedChargeRevision) {
    throw conflict("raced", "The charges changed. Review the invoice and try again");
  }

  const requestedIds = args.lines.map((line) => line.catalogItemId);
  const catalog = await tx
    .select({
      id: catalogItems.id,
      name: catalogItems.name,
      category: catalogItems.category,
      unitPrice: catalogItems.unitPrice,
      taxRatePercent: catalogItems.taxRatePercent,
      taxCode: catalogItems.taxCode,
    })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.orgId, scope.orgId),
        inArray(catalogItems.id, requestedIds),
        eq(catalogItems.active, true),
      ),
    );

  if (catalog.length !== requestedIds.length)
    throw new ORPCError("NOT_FOUND", { message: "One of those services is no longer available." });
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const inserted = await tx
    .insert(charges)
    .values(
      args.lines.map((line) => {
        const item = catalogById.get(line.catalogItemId);
        if (!item)
          throw new ORPCError("NOT_FOUND", {
            message: "One of those services is no longer available.",
          });
        return {
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          opdAppointmentId: appointment.id,
          catalogItemId: item.id,
          description: item.name,
          qty: line.qty,
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          taxCode: item.taxCode,
          revenueCategory: item.category,
          sourceType: "catalog" as const,
          sourceId: null,
          status: "pending" as const,
          createdBy: scope.userId,
        };
      }),
    )
    .returning();

  if (inserted.length !== args.lines.length) throw impossible("charge insert dropped rows");
  const [versionedAppointment] = await tx
    .update(opdAppointments)
    .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
    .where(and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, appointment.id)))
    .returning({ chargeRevision: opdAppointments.chargeRevision });
  if (!versionedAppointment) throw impossible("locked appointment vanished before versioning");
  return { charges: inserted, chargeRevision: versionedAppointment.chargeRevision };
}

export const billingRouter = {
  ...billingWorklistRouter,
  voidCharge: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({ chargeId: z.string(), reason: z.string().trim().min(1).max(500) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const charge = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ appointmentId: charges.opdAppointmentId })
        .from(charges)
        .where(and(eq(charges.orgId, scope.orgId), eq(charges.id, input.chargeId)))
        .limit(1);
      if (!candidate)
        throw new ORPCError("NOT_FOUND", { message: "That charge no longer exists." });

      const [appointment] = await tx
        .select({ id: opdAppointments.id })
        .from(opdAppointments)
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, candidate.appointmentId),
          ),
        )
        .limit(1)
        .for("update");
      if (!appointment)
        throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });

      const [voided] = await tx
        .update(charges)
        .set({ status: "voided", voidReason: input.reason, updatedAt: new Date() })
        .where(
          and(
            eq(charges.orgId, scope.orgId),
            eq(charges.id, input.chargeId),
            eq(charges.status, "pending"),
          ),
        )
        .returning();
      if (!voided) throw conflict("raced", "This charge was already settled or voided.");

      await tx
        .update(opdAppointments)
        .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
        .where(and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, appointment.id)));
      return voided;
    });

    audit({
      action: "charge.void",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `charge:${input.chargeId}`,
      meta: { reason: input.reason },
    });
    return charge;
  }),

  settleCharges: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      appointmentId: z.string(),
      lines: chargeLinesInput.default([]),
      expectedChargeRevision: z.number().int().nonnegative(),
      expectedGrandTotal: money,
      discountAmount: money.default("0"),
      note: z.string().trim().max(500).optional(),
      payments: z.array(paymentLineInput).max(4).default([]),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const invoiceId = Bun.randomUUIDv7();

    const result = await db.transaction(async (tx) => {
      let chargeRevision = input.expectedChargeRevision;
      if (input.lines.length > 0) {
        const added = await addChargesTx(tx, {
          scope,
          appointmentId: input.appointmentId,
          lines: input.lines,
          expectedChargeRevision: chargeRevision,
        });
        chargeRevision = added.chargeRevision;
      }

      return settleInvoiceTx(tx, {
        scope,
        appointmentId: input.appointmentId,
        discountAmount: input.discountAmount,
        note: input.note,
        settings,
        now,
        fiscalYear,
        invoiceId,
        payments: input.payments,
        expectedGrandTotal: input.expectedGrandTotal,
        expectedChargeRevision: chargeRevision,
      });
    });

    audit({
      action: "invoice.issue",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `invoice:${invoiceId}`,
      meta: { invoiceNumber: result.invoice.invoiceNumber, grandTotal: result.invoice.grandTotal },
    });
    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: payment.amount },
      });
    }
    return {
      invoice: result.invoice,
      lines: result.lines,
      payments: result.payments,
      chargeRevision: result.chargeRevision,
    };
  }),

  recordPayments: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      invoiceId: z.string(),
      payments: z.array(paymentLineInput).min(1).max(4),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const recorded = await db.transaction((tx) =>
      recordPaymentsTx(tx, {
        scope,
        invoiceId: input.invoiceId,
        payments: input.payments,
        settings,
        now,
        fiscalYear,
      }),
    );

    for (const payment of recorded) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: payment.amount },
      });
    }
    return recorded;
  }),

  issueCreditNote: orgProcedure(
    { billing: ["creditNote"] },
    orgInput.extend({
      invoiceId: z.string(),
      reason: z.string().trim().min(1).max(500),
      lines: z.array(creditLineInput).min(1),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const requestedIds = input.lines.map((line) => line.invoiceLineId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new ORPCError("BAD_REQUEST", { message: "Credit each invoice line once" });
    }

    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const creditNoteId = Bun.randomUUIDv7();

    const result = await db.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, scope.orgId, input.invoiceId);

      const sourceLines = await tx
        .select()
        .from(invoiceLines)
        .where(
          and(
            eq(invoiceLines.orgId, scope.orgId),
            eq(invoiceLines.invoiceId, input.invoiceId),
            inArray(invoiceLines.id, requestedIds),
          ),
        );
      if (sourceLines.length !== requestedIds.length) {
        throw new ORPCError("NOT_FOUND", {
          message: "One of those invoice lines no longer exists.",
        });
      }

      const priorNotes = await tx
        .select({ id: creditNotes.id, total: creditNotes.total })
        .from(creditNotes)
        .where(and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, input.invoiceId)));
      const priorLines = await tx
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
          and(
            eq(creditNoteLines.orgId, scope.orgId),
            eq(creditNotes.orgId, scope.orgId),
            eq(creditNotes.invoiceId, input.invoiceId),
          ),
        );

      const creditedByLine = new Map<
        string,
        { taxableValue: number; taxAmount: number; gross: number }
      >();
      for (const line of priorLines) {
        const credited = creditedByLine.get(line.invoiceLineId) ?? {
          taxableValue: 0,
          taxAmount: 0,
          gross: 0,
        };
        credited.taxableValue += toPaise(line.taxableValue);
        credited.taxAmount += toPaise(line.taxAmount);
        credited.gross += toPaise(line.gross);
        creditedByLine.set(line.invoiceLineId, credited);
      }

      const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
      const computedLines = input.lines.map((requested) => {
        const source = sourceById.get(requested.invoiceLineId);
        if (!source) {
          throw new ORPCError("NOT_FOUND", {
            message: "One of those invoice lines no longer exists.",
          });
        }
        const prior = creditedByLine.get(source.id) ?? {
          taxableValue: 0,
          taxAmount: 0,
          gross: 0,
        };
        const sourcePaise = {
          taxableValue: toPaise(source.taxableValue),
          taxAmount: toPaise(source.taxAmount),
          gross: toPaise(source.gross),
        };

        let values: { taxableValue: string; taxAmount: string; gross: string };
        if ("full" in requested) {
          const remainingGross = sourcePaise.gross - prior.gross;
          if (remainingGross <= 0) {
            throw new ORPCError("BAD_REQUEST", {
              message: "This line is already fully credited.",
            });
          }
          values = {
            taxableValue: fromPaise(sourcePaise.taxableValue - prior.taxableValue),
            taxAmount: fromPaise(sourcePaise.taxAmount - prior.taxAmount),
            gross: fromPaise(remainingGross),
          };
        } else {
          values = derivePartialCredit(requested.gross, source.taxRatePercent);
        }

        if (
          prior.taxableValue + toPaise(values.taxableValue) > sourcePaise.taxableValue ||
          prior.taxAmount + toPaise(values.taxAmount) > sourcePaise.taxAmount ||
          prior.gross + toPaise(values.gross) > sourcePaise.gross
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "That credit is more than the invoice line is worth.",
          });
        }

        return { invoiceLineId: source.id, revenueCategory: source.revenueCategory, ...values };
      });

      const subtotalPaise = computedLines.reduce(
        (sum, line) => sum + toPaise(line.taxableValue),
        0,
      );
      const taxTotalPaise = computedLines.reduce((sum, line) => sum + toPaise(line.taxAmount), 0);
      const totalPaise = computedLines.reduce((sum, line) => sum + toPaise(line.gross), 0);
      const priorCreditPaise = priorNotes.reduce((sum, note) => sum + toPaise(note.total), 0);
      if (priorCreditPaise + totalPaise > toPaise(invoice.grandTotal)) {
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
          invoiceId: input.invoiceId,
          creditNoteNumber,
          fiscalYear,
          businessDate: businessDate(now, settings.timeZone),
          reason: input.reason,
          subtotal: fromPaise(subtotalPaise),
          taxTotal: fromPaise(taxTotalPaise),
          total: fromPaise(totalPaise),
          issuedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!creditNote) throw impossible("credit note insert returned no row");

      const insertedLines = await tx
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
      const revenueByAccount = new Map<SystemAccountKey, number>();
      for (const line of computedLines) {
        const account = revenueAccountFor(line.revenueCategory);
        revenueByAccount.set(
          account,
          (revenueByAccount.get(account) ?? 0) + toPaise(line.taxableValue),
        );
      }
      await postJournalEntry(tx, {
        orgId: scope.orgId,
        sourceType: "credit_note",
        sourceId: creditNoteId,
        narration: `Credit note ${creditNoteNumber} · Invoice ${invoice.invoiceNumber}`,
        createdBy: scope.userId,
        now,
        timeZone: settings.timeZone,
        lines: [
          ...[...revenueByAccount].map(([account, amount]) => ({
            account,
            debit: fromPaise(amount),
          })),
          ...(taxTotalPaise > 0
            ? [{ account: "gst_output" as const, debit: fromPaise(taxTotalPaise) }]
            : []),
          { account: "patient_receivables", credit: fromPaise(totalPaise) },
        ],
      });

      return { creditNote, lines: insertedLines };
    });

    audit({
      action: "creditNote.issue",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `creditNote:${creditNoteId}`,
      meta: {
        creditNoteNumber: result.creditNote.creditNoteNumber,
        total: result.creditNote.total,
      },
    });
    return result;
  }),

  recordRefund: orgProcedure(
    { billing: ["creditNote"] },
    orgInput
      .extend({
        creditNoteId: z.string(),
        method: paymentMethod,
        amount: positiveMoney,
        reference: z.string().trim().min(1).max(100).optional(),
      })
      .superRefine((value, context) => {
        if (value.method !== "cash" && !value.reference) {
          context.addIssue({
            code: "custom",
            path: ["reference"],
            message: "Add a transaction reference for this refund",
          });
        }
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const refundId = Bun.randomUUIDv7();

    const refund = await db.transaction(async (tx) => {
      const [creditNote] = await tx
        .select({
          id: creditNotes.id,
          invoiceId: creditNotes.invoiceId,
          total: creditNotes.total,
        })
        .from(creditNotes)
        .where(and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.id, input.creditNoteId)))
        .limit(1);

      if (!creditNote) {
        throw new ORPCError("NOT_FOUND", { message: "That credit note no longer exists." });
      }

      const invoice = await lockInvoice(tx, scope.orgId, creditNote.invoiceId);

      const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
      const outstandingPaise = toSignedPaise(balance.outstanding);
      const refundDuePaise = Math.max(0, -outstandingPaise);
      if (toPaise(input.amount) > refundDuePaise) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than the invoice owes back.",
        });
      }

      const noteRefunds = await tx
        .select({ amount: refunds.amount })
        .from(refunds)
        .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.creditNoteId, input.creditNoteId)));
      const noteRefundedPaise = noteRefunds.reduce((sum, row) => sum + toPaise(row.amount), 0);
      if (noteRefundedPaise + toPaise(input.amount) > toPaise(creditNote.total)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than this credit note is worth.",
        });
      }

      const sequence = await nextCounter(tx, scope.orgId, `refund:${fiscalYear}`);
      const refundNumber = documentNumber("RF", fiscalYear, sequence);
      const [inserted] = await tx
        .insert(refunds)
        .values({
          id: refundId,
          orgId: scope.orgId,
          invoiceId: creditNote.invoiceId,
          creditNoteId: input.creditNoteId,
          method: input.method,
          amount: input.amount,
          reference: input.reference ?? null,
          refundNumber,
          fiscalYear,
          businessDate: businessDate(now, settings.timeZone),
          refundedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!inserted) throw impossible("refund insert returned no row");
      await postJournalEntry(tx, {
        orgId: scope.orgId,
        sourceType: "refund",
        sourceId: refundId,
        narration: `Refund ${refundNumber} · Invoice ${invoice.invoiceNumber}`,
        createdBy: scope.userId,
        now,
        timeZone: settings.timeZone,
        lines: [
          { account: "patient_receivables", debit: inserted.amount },
          { account: settlementAccountFor(input.method), credit: inserted.amount },
        ],
      });
      return inserted;
    });

    audit({
      action: "refund.record",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `refund:${refundId}`,
      meta: { refundNumber: refund.refundNumber, amount: refund.amount },
    });
    return refund;
  }),

  invoiceBalance: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ invoiceId: z.string() }),
  ).handler(async ({ context, input }) => {
    const [invoice] = await db
      .select({ id: invoices.id, grandTotal: invoices.grandTotal })
      .from(invoices)
      .where(and(eq(invoices.orgId, context.scope.orgId), eq(invoices.id, input.invoiceId)))
      .limit(1);

    if (!invoice) {
      throw new ORPCError("NOT_FOUND", { message: "That invoice no longer exists." });
    }

    return invoiceBalanceFor(db, context.scope.orgId, invoice);
  }),

  listInvoices: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ appointmentId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [appointment] = await db
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(
        and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, input.appointmentId)),
      )
      .limit(1);

    if (!appointment) {
      throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });
    }

    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.opdAppointmentId, appointment.id)))
      .orderBy(asc(invoices.createdAt));

    const balances = await invoiceBalancesFor(db, scope.orgId, rows);

    return rows.map((invoice) => {
      const balance = balances.get(invoice.id);
      if (!balance) {
        throw new Error(`Balance missing for invoice ${invoice.id}`);
      }
      return { ...invoice, ...balance };
    });
  }),

  getInvoice: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ invoiceId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.id, input.invoiceId)))
      .limit(1);

    if (!invoice) {
      throw new ORPCError("NOT_FOUND", { message: "That invoice no longer exists." });
    }

    const [lines, invoicePayments, notes, invoiceRefunds] = await Promise.all([
      db
        .select()
        .from(invoiceLines)
        .where(
          and(eq(invoiceLines.orgId, scope.orgId), eq(invoiceLines.invoiceId, input.invoiceId)),
        ),
      db
        .select()
        .from(payments)
        .where(and(eq(payments.orgId, scope.orgId), eq(payments.invoiceId, input.invoiceId)))
        .orderBy(asc(payments.createdAt)),
      db
        .select()
        .from(creditNotes)
        .where(and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, input.invoiceId)))
        .orderBy(asc(creditNotes.createdAt)),
      db
        .select()
        .from(refunds)
        .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.invoiceId, input.invoiceId)))
        .orderBy(asc(refunds.createdAt)),
    ]);

    const notesWithLines = await Promise.all(
      notes.map(async (creditNote) => ({
        ...creditNote,
        lines: await db
          .select()
          .from(creditNoteLines)
          .where(
            and(
              eq(creditNoteLines.orgId, scope.orgId),
              eq(creditNoteLines.creditNoteId, creditNote.id),
            ),
          ),
      })),
    );

    return {
      invoice,
      lines,
      payments: invoicePayments,
      creditNotes: notesWithLines,
      refunds: invoiceRefunds,
      balance: calculateInvoiceBalance({
        grandTotal: invoice.grandTotal,
        credits: notes.map((note) => note.total),
        payments: invoicePayments.map((payment) => payment.amount),
        refunds: invoiceRefunds.map((refund) => refund.amount),
      }),
    };
  }),
};
