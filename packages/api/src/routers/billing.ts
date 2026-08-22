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
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { businessDateAnchor } from "../lib/business-date";
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

// Money attaches only after arrival: these statuses guarantee a linked patient
// via the schema's arrived check, while `booked` rows may still have none and
// closed rows must not accumulate charges.
const BILLABLE_STATUSES: (typeof opdAppointments.$inferSelect)["status"][] = [
  "waiting",
  "in_consult",
  "completed",
];

const addChargeInput = orgInput.extend({
  appointmentId: z.string(),
  catalogItemId: z.string(),
  qty: z.number().int().min(1).max(999).default(1),
});

const creditLineInput = z.union([
  z.object({ invoiceLineId: z.string(), full: z.literal(true) }).strict(),
  z.object({ invoiceLineId: z.string(), gross: positiveMoney }).strict(),
]);

async function throwForMissingOrStaleCharge(chargeId: string, orgId: string): Promise<never> {
  const [existing] = await db
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.id, chargeId)))
    .limit(1);

  throw new ORPCError(existing ? "CONFLICT" : "NOT_FOUND");
}

async function billingDocumentContext(orgId: string) {
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
    throw new ORPCError("NOT_FOUND");
  }
  return invoice;
}

export const billingRouter = {
  ...billingWorklistRouter,
  listPendingCharges: orgProcedure(
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
      throw new ORPCError("NOT_FOUND");
    }

    return db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.orgId, scope.orgId),
          eq(charges.opdAppointmentId, appointment.id),
          eq(charges.status, "pending"),
        ),
      )
      .orderBy(asc(charges.createdAt));
  }),

  addCharge: orgProcedure({ billing: ["write"] }, addChargeInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      return db.transaction(async (tx) => {
        // Cancellation updates this row before voiding pending charges. Taking
        // the same lock makes the state check and insert one serial decision.
        const [appointment] = await tx
          .select({
            status: opdAppointments.status,
            id: opdAppointments.id,
          })
          .from(opdAppointments)
          .where(
            and(
              eq(opdAppointments.orgId, scope.orgId),
              eq(opdAppointments.id, input.appointmentId),
            ),
          )
          .limit(1)
          .for("update");

        if (!appointment) {
          throw new ORPCError("NOT_FOUND");
        }
        if (!BILLABLE_STATUSES.includes(appointment.status)) {
          throw new ORPCError("CONFLICT");
        }

        const [catalogItem] = await tx
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
              eq(catalogItems.id, input.catalogItemId),
              eq(catalogItems.active, true),
            ),
          )
          .limit(1);

        if (!catalogItem) {
          throw new ORPCError("NOT_FOUND");
        }

        const [charge] = await tx
          .insert(charges)
          .values({
            id: crypto.randomUUID(),
            orgId: scope.orgId,
            opdAppointmentId: appointment.id,
            catalogItemId: catalogItem.id,
            description: catalogItem.name,
            qty: input.qty,
            unitPrice: catalogItem.unitPrice,
            taxRatePercent: catalogItem.taxRatePercent,
            taxCode: catalogItem.taxCode,
            revenueCategory: catalogItem.category,
            sourceType: "catalog",
            sourceId: null,
            status: "pending",
            createdBy: scope.userId,
          })
          .returning();

        if (!charge) {
          throw new ORPCError("INTERNAL_SERVER_ERROR");
        }
        return charge;
      });
    },
  ),

  voidCharge: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({ chargeId: z.string(), reason: z.string().trim().min(1).max(500) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [charge] = await db
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

    if (!charge) {
      return throwForMissingOrStaleCharge(input.chargeId, scope.orgId);
    }

    audit({
      action: "charge.void",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `charge:${input.chargeId}`,
      meta: { reason: input.reason },
    });
    return charge;
  }),

  issueInvoice: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      appointmentId: z.string(),
      discountAmount: money.default("0"),
      discountReason: z.string().trim().max(500).optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    if (toPaise(input.discountAmount) > 0 && !input.discountReason) {
      throw new ORPCError("BAD_REQUEST");
    }

    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const invoiceId = crypto.randomUUID();

    const result = await db.transaction(async (tx) => {
      const [appointmentAndPatient] = await tx
        .select({
          appointmentStatus: opdAppointments.status,
          opdAppointmentId: opdAppointments.id,
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
        .where(
          and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, input.appointmentId)),
        )
        .limit(1)
        .for("update", { of: opdAppointments });

      if (!appointmentAndPatient) {
        throw new ORPCError("NOT_FOUND");
      }
      if (!BILLABLE_STATUSES.includes(appointmentAndPatient.appointmentStatus)) {
        throw new ORPCError("CONFLICT");
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
        .orderBy(asc(charges.createdAt))
        .for("update");

      if (pendingCharges.length === 0) {
        throw new ORPCError("CONFLICT");
      }

      const subtotalPaise = pendingCharges.reduce(
        (sum, charge) => sum + charge.qty * toPaise(charge.unitPrice),
        0,
      );
      if (toPaise(input.discountAmount) > subtotalPaise) {
        throw new ORPCError("BAD_REQUEST");
      }

      const computed = computeInvoiceLines(pendingCharges, input.discountAmount);
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
          discountAmount: input.discountAmount,
          discountReason: input.discountReason ?? null,
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

      if (!invoice) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      const insertedLines = await tx
        .insert(invoiceLines)
        .values(
          computedWithRevenue.map((line) => ({
            id: crypto.randomUUID(),
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

      if (flippedCharges.length !== computedWithRevenue.length) {
        throw new ORPCError("CONFLICT");
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

      return { invoice, lines: insertedLines };
    });

    audit({
      action: "invoice.issue",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `invoice:${invoiceId}`,
      meta: { invoiceNumber: result.invoice.invoiceNumber, grandTotal: result.invoice.grandTotal },
    });
    return result;
  }),

  recordPayment: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      invoiceId: z.string(),
      method: paymentMethod,
      amount: positiveMoney,
      reference: z.string().optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const paymentId = crypto.randomUUID();

    const payment = await db.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, scope.orgId, input.invoiceId);

      const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
      const outstandingPaise = toSignedPaise(balance.outstanding);
      if (toPaise(input.amount) > Math.max(0, outstandingPaise)) {
        throw new ORPCError("CONFLICT");
      }

      const sequence = await nextCounter(tx, scope.orgId, `receipt:${fiscalYear}`);
      const receiptNumber = documentNumber(settings.receiptPrefix, fiscalYear, sequence);
      const [inserted] = await tx
        .insert(payments)
        .values({
          id: paymentId,
          orgId: scope.orgId,
          invoiceId: input.invoiceId,
          method: input.method,
          amount: input.amount,
          reference: input.reference ?? null,
          receiptNumber,
          fiscalYear,
          receivedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!inserted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      await postJournalEntry(tx, {
        orgId: scope.orgId,
        sourceType: "payment",
        sourceId: paymentId,
        narration: `Receipt ${receiptNumber} · Invoice ${invoice.invoiceNumber}`,
        createdBy: scope.userId,
        now,
        timeZone: settings.timeZone,
        lines: [
          { account: settlementAccountFor(input.method), debit: inserted.amount },
          { account: "patient_receivables", credit: inserted.amount },
        ],
      });
      return inserted;
    });

    audit({
      action: "payment.record",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `payment:${paymentId}`,
      meta: { receiptNumber: payment.receiptNumber, amount: payment.amount },
    });
    return payment;
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
      throw new ORPCError("BAD_REQUEST");
    }

    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const creditNoteId = crypto.randomUUID();

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
        throw new ORPCError("NOT_FOUND");
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
          throw new ORPCError("NOT_FOUND");
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
            throw new ORPCError("CONFLICT");
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
          throw new ORPCError("CONFLICT");
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
        throw new ORPCError("CONFLICT");
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
          reason: input.reason,
          subtotal: fromPaise(subtotalPaise),
          taxTotal: fromPaise(taxTotalPaise),
          total: fromPaise(totalPaise),
          issuedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!creditNote) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      const insertedLines = await tx
        .insert(creditNoteLines)
        .values(
          computedLines.map(({ revenueCategory: _revenueCategory, ...line }) => ({
            id: crypto.randomUUID(),
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
    orgInput.extend({
      creditNoteId: z.string(),
      method: paymentMethod,
      amount: positiveMoney,
      reference: z.string().optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const refundId = crypto.randomUUID();

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
        throw new ORPCError("NOT_FOUND");
      }

      const invoice = await lockInvoice(tx, scope.orgId, creditNote.invoiceId);

      const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
      const outstandingPaise = toSignedPaise(balance.outstanding);
      const refundDuePaise = Math.max(0, -outstandingPaise);
      if (toPaise(input.amount) > refundDuePaise) {
        throw new ORPCError("CONFLICT");
      }

      const noteRefunds = await tx
        .select({ amount: refunds.amount })
        .from(refunds)
        .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.creditNoteId, input.creditNoteId)));
      const noteRefundedPaise = noteRefunds.reduce((sum, row) => sum + toPaise(row.amount), 0);
      if (noteRefundedPaise + toPaise(input.amount) > toPaise(creditNote.total)) {
        throw new ORPCError("CONFLICT");
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
          refundedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!inserted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
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
      throw new ORPCError("NOT_FOUND");
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
      throw new ORPCError("NOT_FOUND");
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
      throw new ORPCError("NOT_FOUND");
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
