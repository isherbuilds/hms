import { db } from "@hms/db";
import { nextCounter, type DbTransaction } from "@hms/db/counter";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { patients } from "@hms/db/schema/patients";
import { guardianLabel } from "@hms/db/schema/patient-relations";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { user } from "@hms/db/schema/auth";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { formatDecimal } from "../core/money";
import { audit } from "../audit";
import { businessDate } from "../lib/business-date";
import { advanceRemaining } from "../lib/advance-credit";
import {
  billingDocumentContext,
  insertRefundTx,
  issueInvoiceTx,
  lockInvoice,
  postCreditNoteTx,
  recordPaymentsTx,
} from "../lib/billing-documents";
import { impossible } from "../lib/conflict";
import { invoiceBalanceFor, invoiceBalancesFor } from "../lib/invoice-balance";
import { voidPendingCharges } from "../lib/opd-close";
import { planLabel } from "../lib/treatment-label";
import { calculateInvoiceBalance, documentNumber } from "../lib/invoice-math";
import { postJournalEntries, settlementAccountFor } from "../lib/ledger";
import {
  money,
  note,
  paymentLine,
  positiveMoney,
  reason,
  requirePaymentReference,
  type PaymentMethod,
} from "../lib/schemas";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import type { OrgSettings } from "../lib/settings-cache";
import { billingWorklistRouter } from "./billing-worklist";

const creditLineInput = z.union([
  z.strictObject({ invoiceLineId: z.string(), full: z.literal(true) }),
  z.strictObject({ invoiceLineId: z.string(), gross: positiveMoney }),
]);

/**
 * The OPD desk's settlement: it owns appointment eligibility and the charge revision,
 * and leaves the document and the money to the shared helpers.
 */
export async function settleInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    discountAmount: bigint;
    note?: string;
    payments: Array<{ method: PaymentMethod; amount: bigint; reference?: string }>;
    applyCredit: bigint;
    settings: OrgSettings;
    now: Date;
    fiscalYear: string;
    invoiceId: string;
    expectedGrandTotal: bigint;
    // "fresh" means the care row was created in this transaction, so no concurrent charge writer exists.
    expectedChargeRevision: number | "fresh";
  },
) {
  const { scope } = args;

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
      patientGuardianRelation: patients.guardianRelation,
      patientGuardianName: patients.guardianName,
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

  if (appointmentAndPatient.appointmentStatus !== "checked_in") {
    throw new ORPCError("CONFLICT", { message: "This appointment can no longer be billed." });
  }

  if (
    args.expectedChargeRevision !== "fresh" &&
    appointmentAndPatient.chargeRevision !== args.expectedChargeRevision
  ) {
    throw new ORPCError("CONFLICT", {
      message: "The charges changed. Review the invoice and try again",
    });
  }

  const guardian = guardianLabel({
    guardianRelation: appointmentAndPatient.patientGuardianRelation,
    guardianName: appointmentAndPatient.patientGuardianName,
  });

  const issued = await issueInvoiceTx(tx, {
    scope,
    parent: {
      stream: "opd",
      opdAppointmentId: appointmentAndPatient.opdAppointmentId,
      patient: {
        id: appointmentAndPatient.patientId,
        name: appointmentAndPatient.patientName,
        mrn: appointmentAndPatient.patientMrn,
        phone: appointmentAndPatient.patientPhone,
        address: appointmentAndPatient.patientAddress,
        guardian: guardian ? `${guardian.relation} ${guardian.name}` : null,
      },
    },
    discountAmount: args.discountAmount,
    note: args.note,
    settings: args.settings,
    now: args.now,
    fiscalYear: args.fiscalYear,
    invoiceId: args.invoiceId,
  });

  if (issued.invoice.grandTotal !== args.expectedGrandTotal) {
    throw new ORPCError("CONFLICT", {
      message: "The charges changed. Review the invoice and try again",
    });
  }

  const collected = args.payments.reduce((sum, payment) => sum + payment.amount, 0n);
  const due = issued.invoice.grandTotal;

  if (args.applyCredit > due) {
    throw new ORPCError("CONFLICT", {
      message: "That credit is more than the invoice still owes.",
    });
  }

  if (collected > due - args.applyCredit) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Collected amount cannot exceed the invoice total",
    });
  }

  if (collected + args.applyCredit < due && !args.note) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Add a reason for the outstanding balance",
    });
  }

  const recorded =
    args.payments.length === 0 && args.applyCredit === 0n
      ? []
      : await recordPaymentsTx(tx, {
          scope,
          invoiceId: args.invoiceId,
          payments: args.payments,
          applyCredit: args.applyCredit,
          settings: args.settings,
          now: args.now,
          fiscalYear: args.fiscalYear,
        });

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

  return {
    ...issued,
    chargeRevision: versionedAppointment.chargeRevision,
    payments: recorded,
  };
}

export const billingRouter = {
  ...billingWorklistRouter,
  voidCharge: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({ chargeId: z.string(), reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const charge = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ appointmentId: opdAppointments.id })
        .from(charges)
        .innerJoin(
          opdAppointments,
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, charges.opdAppointmentId),
          ),
        )
        .where(and(eq(charges.orgId, scope.orgId), eq(charges.id, input.chargeId)))
        .limit(1)
        .for("update", { of: opdAppointments });

      if (!candidate) {
        throw new ORPCError("NOT_FOUND", { message: "That charge no longer exists." });
      }

      const [voided] = await voidPendingCharges({
        tx,
        orgId: scope.orgId,
        where: eq(charges.id, input.chargeId),
        reason: input.reason,
        now: new Date(),
      });

      if (!voided) {
        throw new ORPCError("CONFLICT", {
          message: "This charge was already settled or voided.",
        });
      }

      await tx
        .update(opdAppointments)
        .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, candidate.appointmentId),
          ),
        );

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

  recordAdvance: orgProcedure(
    { billing: ["write"] },
    orgInput
      .extend({
        patientId: z.string(),
        treatmentPlanId: z.string().optional(),
        method: paymentLine.shape.method,
        amount: positiveMoney,
        reference: paymentLine.shape.reference,
        note,
      })
      .superRefine(requirePaymentReference),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [{ settings, now, fiscalYear }, [patient]] = await Promise.all([
      billingDocumentContext(scope.orgId),
      db
        .select({
          id: patients.id,
          name: patients.name,
          mrn: patients.mrn,
          phone: patients.phone,
          address: patients.address,
          guardianRelation: patients.guardianRelation,
          guardianName: patients.guardianName,
        })
        .from(patients)
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
        .limit(1),
    ]);

    const advanceId = Bun.randomUUIDv7();

    if (!patient) {
      throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
    }

    const guardian = guardianLabel({
      guardianRelation: patient.guardianRelation,
      guardianName: patient.guardianName,
    });

    const advance = await db.transaction(async (tx) => {
      const plan = input.treatmentPlanId
        ? await tx
            .select({ id: treatmentPlans.id, label: planLabel(scope.orgId) })
            .from(treatmentPlans)
            .where(
              and(
                eq(treatmentPlans.orgId, scope.orgId),
                eq(treatmentPlans.id, input.treatmentPlanId),
                eq(treatmentPlans.patientId, patient.id),
                eq(treatmentPlans.status, "open"),
              ),
            )
            .limit(1)
            .for("update")
            .then((rows) => rows[0])
        : undefined;

      if (input.treatmentPlanId && !plan) {
        throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer available." });
      }

      const sequence = await nextCounter(tx, scope.orgId, `advance:${fiscalYear}`);
      const receiptNumber = documentNumber(settings.advanceReceiptPrefix, fiscalYear, sequence);

      const [inserted] = await tx
        .insert(advanceReceipts)
        .values({
          id: advanceId,
          orgId: scope.orgId,
          patientId: patient.id,
          treatmentPlanId: plan?.id ?? null,
          method: input.method,
          amount: input.amount,
          reference: input.reference ?? null,
          note: input.note ?? null,
          purpose: plan?.label ?? "Future services",
          receiptNumber,
          fiscalYear,
          businessDate: businessDate(now, settings.timeZone),
          orgLegalName: settings.legalName,
          orgAddress: settings.address,
          orgTaxId: settings.taxId,
          currency: settings.currency,
          patientName: patient.name,
          patientMrn: patient.mrn,
          patientPhone: patient.phone,
          patientAddress: patient.address,
          patientGuardian: guardian ? `${guardian.relation} ${guardian.name}` : null,
          receivedBy: scope.userId,
          createdAt: now,
        })
        .returning();

      if (!inserted) throw impossible("advance receipt insert returned no row");

      await postJournalEntries(tx, scope.orgId, [
        {
          sourceType: "advance_receipt",
          sourceId: advanceId,
          narration: `Advance receipt ${receiptNumber}`,
          createdBy: scope.userId,
          now,
          timeZone: settings.timeZone,
          lines: [
            { account: settlementAccountFor(input.method), debit: input.amount },
            { account: "patient_advances", credit: input.amount },
          ],
        },
      ]);

      return inserted;
    });

    audit({
      action: "advance.record",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `advance:${advanceId}`,
      meta: { receiptNumber: advance.receiptNumber, amount: formatDecimal(advance.amount) },
    });

    return advance;
  }),

  patientCredit: orgProcedure(
    { billing: ["read"] },
    // The plan of the bill being settled, or null for a bill outside any plan.
    orgInput.extend({ patientId: z.string(), treatmentPlanId: z.string().nullable() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const remaining = advanceRemaining(scope.orgId);
    const untagged = isNull(advanceReceipts.treatmentPlanId);

    const usableReceipt =
      input.treatmentPlanId === null
        ? untagged
        : or(untagged, eq(advanceReceipts.treatmentPlanId, input.treatmentPlanId));

    // `usable` is what the desk offers on this bill: untagged credit plus this plan's
    // own advance. Another plan's advance stays out of the default (it is spent last).
    const [credit] = await db
      .select({
        total: sql<bigint>`coalesce(sum(${remaining}), 0)`.mapWith(BigInt),
        usable: sql<bigint>`coalesce(sum(${remaining}) filter (where ${usableReceipt}), 0)`.mapWith(
          BigInt,
        ),
      })
      .from(patients)
      .leftJoin(
        advanceReceipts,
        and(eq(advanceReceipts.orgId, scope.orgId), eq(advanceReceipts.patientId, patients.id)),
      )
      .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
      .groupBy(patients.id);

    if (!credit) {
      throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
    }

    return credit;
  }),

  getAdvanceReceipt: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ advanceId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [[row], advanceRefunds] = await Promise.all([
      db
        .select({ receipt: advanceReceipts, receivedByName: user.name })
        .from(advanceReceipts)
        .innerJoin(user, eq(user.id, advanceReceipts.receivedBy))
        .where(and(eq(advanceReceipts.orgId, scope.orgId), eq(advanceReceipts.id, input.advanceId)))
        .limit(1),
      db
        .select()
        .from(refunds)
        .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.advanceReceiptId, input.advanceId)))
        .orderBy(asc(refunds.createdAt), asc(refunds.id)),
    ]);

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "That advance receipt no longer exists." });
    }

    return {
      receipt: { ...row.receipt, receivedByName: row.receivedByName },
      refunds: advanceRefunds,
    };
  }),

  settleCharges: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      appointmentId: z.string(),
      expectedChargeRevision: z.number().int().nonnegative(),
      expectedGrandTotal: money,
      discountAmount: money.default(0n),
      note,
      payments: z.array(paymentLine).max(4).default([]),
      applyCredit: money.default(0n),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const invoiceId = Bun.randomUUIDv7();

    const result = await db.transaction((tx) =>
      settleInvoiceTx(tx, {
        scope,
        appointmentId: input.appointmentId,
        discountAmount: input.discountAmount,
        note: input.note,
        settings,
        now,
        fiscalYear,
        invoiceId,
        payments: input.payments,
        applyCredit: input.applyCredit,
        expectedGrandTotal: input.expectedGrandTotal,
        expectedChargeRevision: input.expectedChargeRevision,
      }),
    );

    audit({
      action: "invoice.issue",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `invoice:${invoiceId}`,
      meta: {
        invoiceNumber: result.invoice.invoiceNumber,
        grandTotal: formatDecimal(result.invoice.grandTotal),
      },
    });

    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: formatDecimal(payment.amount) },
      });
    }

    return result;
  }),

  recordPayments: orgProcedure(
    { billing: ["write"] },
    orgInput
      .extend({
        invoiceId: z.string(),
        payments: z.array(paymentLine).max(4).default([]),
        applyCredit: money.default(0n),
      })
      .refine((value) => value.payments.length > 0 || value.applyCredit > 0n, {
        message: "Record a payment or apply patient credit",
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);

    const recorded = await db.transaction(async (tx) => {
      return recordPaymentsTx(tx, {
        scope,
        invoiceId: input.invoiceId,
        payments: input.payments,
        applyCredit: input.applyCredit,
        settings,
        now,
        fiscalYear,
      });
    });

    for (const payment of recorded) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: formatDecimal(payment.amount) },
      });
    }

    return recorded;
  }),

  issueCreditNote: orgProcedure(
    { billing: ["creditNote"] },
    orgInput.extend({
      invoiceId: z.string(),
      reason,
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
      // Checked before any write: a pharmacy correction has to bring the goods back.
      const invoice = await lockInvoice(tx, scope.orgId, input.invoiceId);

      if (invoice.stream !== "opd") {
        throw new ORPCError("CONFLICT", {
          message: "Pharmacy invoices are corrected by a return.",
        });
      }

      return postCreditNoteTx(tx, {
        scope,
        invoiceId: input.invoiceId,
        reason: input.reason,
        roundOff: 0n,
        lines: input.lines,
        settings,
        now,
        fiscalYear,
        creditNoteId,
      });
    });

    audit({
      action: "creditNote.issue",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `creditNote:${creditNoteId}`,
      meta: {
        creditNoteNumber: result.creditNote.creditNoteNumber,
        total: formatDecimal(result.creditNote.total),
      },
    });

    return { creditNote: result.creditNote, lines: result.lines };
  }),

  recordAdvanceRefund: orgProcedure(
    { billing: ["advanceRefund"] },
    orgInput
      .extend({
        advanceReceiptId: z.string(),
        ...paymentLine.shape,
      })
      .superRefine(requirePaymentReference),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const refundId = Bun.randomUUIDv7();

    const refund = await db.transaction(async (tx) => {
      const [advance] = await tx
        .select({ id: advanceReceipts.id, receiptNumber: advanceReceipts.receiptNumber })
        .from(advanceReceipts)
        .where(
          and(
            eq(advanceReceipts.orgId, scope.orgId),
            eq(advanceReceipts.id, input.advanceReceiptId),
          ),
        )
        .limit(1)
        .for("update");

      if (!advance) {
        throw new ORPCError("NOT_FOUND", {
          message: "That advance receipt no longer exists.",
        });
      }

      // A new statement after the lock, so it sees allocations committed while this waited.
      const [balance] = await tx
        .select({ remaining: advanceRemaining(scope.orgId) })
        .from(advanceReceipts)
        .where(and(eq(advanceReceipts.orgId, scope.orgId), eq(advanceReceipts.id, advance.id)));

      if (!balance) throw impossible("locked advance receipt vanished before its balance read");

      if (input.amount > balance.remaining) {
        throw new ORPCError("CONFLICT", {
          message: "That refund is more than the advance credit available.",
        });
      }

      return insertRefundTx(tx, {
        scope,
        settings,
        now,
        fiscalYear,
        refundId,
        line: input,
        source: { invoiceId: null, creditNoteId: null, advanceReceiptId: advance.id },
        debit: "patient_advances",
        narration: `Advance ${advance.receiptNumber}`,
      });
    });

    audit({
      action: "refund.record",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `refund:${refundId}`,
      meta: { refundNumber: refund.refundNumber, amount: formatDecimal(refund.amount) },
    });

    return refund;
  }),

  recordRefund: orgProcedure(
    { billing: ["creditNote"] },
    orgInput
      .extend({
        creditNoteId: z.string(),
        ...paymentLine.shape,
      })
      .superRefine(requirePaymentReference),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const refundId = Bun.randomUUIDv7();

    const refund = await db.transaction(async (tx) => {
      const [creditNote] = await tx
        .select({
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

      const [balance, [noteRefunded]] = await Promise.all([
        invoiceBalanceFor(tx, scope.orgId, invoice),
        tx
          .select({ amount: sql`coalesce(sum(${refunds.amount}), 0)::bigint`.mapWith(BigInt) })
          .from(refunds)
          .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.creditNoteId, input.creditNoteId))),
      ]);

      const refundDuePaise = balance.outstanding < 0n ? -balance.outstanding : 0n;

      if (input.amount > refundDuePaise) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than the invoice owes back.",
        });
      }

      if ((noteRefunded?.amount ?? 0n) + input.amount > creditNote.total) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than this credit note is worth.",
        });
      }

      return insertRefundTx(tx, {
        scope,
        settings,
        now,
        fiscalYear,
        refundId,
        line: input,
        source: {
          invoiceId: creditNote.invoiceId,
          creditNoteId: input.creditNoteId,
          advanceReceiptId: null,
        },
        debit: "patient_receivables",
        narration: `Invoice ${invoice.invoiceNumber}`,
      });
    });

    audit({
      action: "refund.record",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `refund:${refundId}`,
      meta: { refundNumber: refund.refundNumber, amount: formatDecimal(refund.amount) },
    });

    return refund;
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
      .select({
        id: invoices.id,
        patientId: invoices.patientId,
        invoiceNumber: invoices.invoiceNumber,
        currency: invoices.currency,
        grandTotal: invoices.grandTotal,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.opdAppointmentId, appointment.id)))
      .orderBy(asc(invoices.createdAt), asc(invoices.id));

    const balances = await invoiceBalancesFor(db, scope.orgId, rows);

    return rows.map((invoice) => {
      const balance = balances.get(invoice.id);

      if (!balance) throw impossible(`balance missing for invoice ${invoice.id}`);

      return {
        ...invoice,
        paymentsTotal: balance.paymentsTotal,
        allocationsTotal: balance.allocationsTotal,
        outstanding: balance.outstanding,
      };
    });
  }),

  getInvoice: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ invoiceId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    // `user` is the global auth table: attribution only; the org predicate stays on `invoices`.
    const [row] = await db
      .select({ invoice: invoices, issuedByName: user.name })
      .from(invoices)
      .innerJoin(user, eq(user.id, invoices.issuedBy))
      .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.id, input.invoiceId)))
      .limit(1);

    const invoice = row && { ...row.invoice, issuedByName: row.issuedByName };

    if (!invoice) {
      throw new ORPCError("NOT_FOUND", { message: "That invoice no longer exists." });
    }

    const [lines, invoicePayments, invoiceAllocations, noteRows, invoiceRefunds] =
      await Promise.all([
        db
          .select()
          .from(invoiceLines)
          .where(
            and(eq(invoiceLines.orgId, scope.orgId), eq(invoiceLines.invoiceId, input.invoiceId)),
          )
          .orderBy(asc(invoiceLines.id)),
        db
          .select()
          .from(payments)
          .where(and(eq(payments.orgId, scope.orgId), eq(payments.invoiceId, input.invoiceId)))
          .orderBy(asc(payments.createdAt), asc(payments.id)),
        db
          .select()
          .from(advanceAllocations)
          .where(
            and(
              eq(advanceAllocations.orgId, scope.orgId),
              eq(advanceAllocations.invoiceId, input.invoiceId),
            ),
          )
          .orderBy(asc(advanceAllocations.createdAt), asc(advanceAllocations.id)),
        db
          .select({ creditNote: creditNotes, line: creditNoteLines })
          .from(creditNotes)
          .leftJoin(
            creditNoteLines,
            and(
              eq(creditNoteLines.orgId, scope.orgId),
              eq(creditNotes.id, creditNoteLines.creditNoteId),
            ),
          )
          .where(
            and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, input.invoiceId)),
          )
          .orderBy(asc(creditNotes.createdAt), asc(creditNotes.id), asc(creditNoteLines.id)),
        db
          .select()
          .from(refunds)
          .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.invoiceId, input.invoiceId)))
          .orderBy(asc(refunds.createdAt), asc(refunds.id)),
      ]);

    type NoteRow = (typeof noteRows)[number];

    const notesById = new Map<
      string,
      NoteRow["creditNote"] & { lines: NonNullable<NoteRow["line"]>[] }
    >();

    for (const { creditNote, line } of noteRows) {
      const note = notesById.get(creditNote.id) ?? { ...creditNote, lines: [] };

      if (line) note.lines.push(line);
      notesById.set(creditNote.id, note);
    }

    const notesWithLines = [...notesById.values()];

    const balance = calculateInvoiceBalance({
      grandTotal: invoice.grandTotal,
      creditTotal: notesWithLines.reduce((sum, note) => sum + note.total, 0n),
      paymentsTotal: invoicePayments.reduce((sum, payment) => sum + payment.amount, 0n),
      allocationsTotal: invoiceAllocations.reduce((sum, allocation) => sum + allocation.amount, 0n),
      refundsTotal: invoiceRefunds.reduce((sum, refund) => sum + refund.amount, 0n),
    });

    return {
      invoice,
      lines,
      payments: invoicePayments,
      allocations: invoiceAllocations,
      creditNotes: notesWithLines,
      refunds: invoiceRefunds,
      balance,
    };
  }),
};
