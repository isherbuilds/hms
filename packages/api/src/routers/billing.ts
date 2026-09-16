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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { formatDecimal } from "../core/money";
import { audit } from "../audit";
import { businessDate, businessDateAnchor } from "../lib/business-date";
import { advanceRemaining } from "../lib/advance-credit";
import { impossible } from "../lib/conflict";
import { invoiceBalanceFor, invoiceBalancesFor } from "../lib/invoice-balance";
import { planLabel } from "../lib/treatment-label";
import {
  calculateInvoiceBalance,
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  fiscalYearLabel,
} from "../lib/invoice-math";
import {
  postJournalEntry,
  revenueAccountFor,
  settlementAccountFor,
  type SystemAccountKey,
} from "../lib/ledger";
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
import { readOrgSettings } from "../lib/settings-cache";
import { billingWorklistRouter } from "./billing-worklist";

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
      patientId: invoices.patientId,
      treatmentPlanId: opdAppointments.treatmentPlanId,
    })
    .from(invoices)
    .innerJoin(
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
    invoice: Awaited<ReturnType<typeof lockInvoice>>;
    amount: bigint;
    now: Date;
    timeZone: string;
  },
) {
  const { scope, invoice } = args;

  if (args.amount === 0n) return;

  // Lock in one stable order, then read balances in a new statement: under READ COMMITTED
  // only a statement that starts after the lock sees allocations committed while it waited.
  const locked = await tx
    .select({ id: advanceReceipts.id })
    .from(advanceReceipts)
    .where(
      and(eq(advanceReceipts.orgId, scope.orgId), eq(advanceReceipts.patientId, invoice.patientId)),
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
        eq(advanceReceipts.patientId, invoice.patientId),
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

  // Credit taken for this visit's plan goes first; a visit with no plan spends untagged
  // credit first. The sort is stable, so each group stays oldest-first.
  receipts.sort(
    (first, second) =>
      Number(second.treatmentPlanId === invoice.treatmentPlanId) -
      Number(first.treatmentPlanId === invoice.treatmentPlanId),
  );

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

  for (const allocation of inserted) {
    await postJournalEntry(tx, {
      orgId: scope.orgId,
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
    });
  }
}

async function issueInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    discountAmount: bigint;
    note?: string;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
    now: Date;
    fiscalYear: string;
    invoiceId: string;
    expectedChargeRevision: number | "fresh";
  },
) {
  const { scope, settings, now, fiscalYear, invoiceId } = args;

  if (args.discountAmount > 0n && !args.note) {
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
    throw new ORPCError("CONFLICT", {
      message: "These charges were already settled or voided.",
    });
  }

  const subtotalPaise = pendingCharges.reduce(
    (sum, charge) => sum + BigInt(charge.qty) * charge.unitPrice,
    0n,
  );

  if (args.discountAmount > subtotalPaise) {
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

  const guardian = guardianLabel({
    guardianRelation: appointmentAndPatient.patientGuardianRelation,
    guardianName: appointmentAndPatient.patientGuardianName,
  });

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
      patientGuardian: guardian ? `${guardian.relation} ${guardian.name}` : null,
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

  const revenueByAccount = new Map<SystemAccountKey, bigint>();

  for (const line of computedWithRevenue) {
    const account = revenueAccountFor(line.revenueCategory);
    revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0n) + line.taxableValue);
  }

  if (computed.grandTotal > 0n) {
    await postJournalEntry(tx, {
      orgId: scope.orgId,
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
    payments: Array<{ method: PaymentMethod; amount: bigint; reference?: string }>;
    applyCredit: bigint;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
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

export async function settleInvoiceTx(
  tx: DbTransaction,
  args: {
    scope: { orgId: string; userId: string };
    appointmentId: string;
    discountAmount: bigint;
    note?: string;
    payments: Array<{ method: PaymentMethod; amount: bigint; reference?: string }>;
    applyCredit: bigint;
    settings: Awaited<ReturnType<typeof billingDocumentContext>>["settings"];
    now: Date;
    fiscalYear: string;
    invoiceId: string;
    expectedGrandTotal: bigint;
    // "fresh" means the care row was created in this transaction, so no concurrent charge writer exists.
    expectedChargeRevision: number | "fresh";
  },
) {
  const issued = await issueInvoiceTx(tx, args);

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

  if (args.payments.length === 0 && args.applyCredit === 0n) {
    return { ...issued, payments: [] };
  }

  const recorded = await recordPaymentsTx(tx, {
    scope: args.scope,
    invoiceId: args.invoiceId,
    payments: args.payments,
    applyCredit: args.applyCredit,
    settings: args.settings,
    now: args.now,
    fiscalYear: args.fiscalYear,
  });

  return { ...issued, payments: recorded };
}

/** Numbers, stores, and posts one Refund once its caller has locked and capped the source. */
async function insertRefundTx(
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

  await postJournalEntry(tx, {
    orgId: scope.orgId,
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
  });

  return inserted;
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
        .select({ appointmentId: charges.opdAppointmentId })
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
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const advanceId = Bun.randomUUIDv7();

    const [patient] = await db
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
      .limit(1);

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

      await postJournalEntry(tx, {
        orgId: scope.orgId,
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
      });

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
    orgInput.extend({ patientId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [credit] = await db
      .select({
        total: sql<bigint>`coalesce(sum(${advanceRemaining(scope.orgId)}), 0)`.mapWith(BigInt),
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

    const recorded = await db.transaction((tx) =>
      recordPaymentsTx(tx, {
        scope,
        invoiceId: input.invoiceId,
        payments: input.payments,
        applyCredit: input.applyCredit,
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
      const invoice = await lockInvoice(tx, scope.orgId, input.invoiceId);

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
              eq(invoiceLines.invoiceId, input.invoiceId),
              inArray(invoiceLines.id, requestedIds),
            ),
          ),
        tx
          .select({ total: sql`coalesce(sum(${creditNotes.total}), 0)::bigint`.mapWith(BigInt) })
          .from(creditNotes)
          .where(
            and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, input.invoiceId)),
          ),
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
            and(
              eq(creditNotes.orgId, scope.orgId),
              eq(creditNotes.id, creditNoteLines.creditNoteId),
            ),
          )
          .where(
            and(eq(creditNoteLines.orgId, scope.orgId), eq(creditNotes.invoiceId, input.invoiceId)),
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

      const computedLines = input.lines.map((requested) => {
        const source = sourceById.get(requested.invoiceLineId)!;

        const prior = creditedByLine.get(source.id) ?? {
          taxableValue: 0n,
          taxAmount: 0n,
          gross: 0n,
        };

        let values: ReturnType<typeof derivePartialCredit>;

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
      const totalPaise = computedLines.reduce((sum, line) => sum + line.gross, 0n);
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
          invoiceId: input.invoiceId,
          creditNoteNumber,
          fiscalYear,
          businessDate: businessDate(now, settings.timeZone),
          reason: input.reason,
          subtotal: subtotalPaise,
          taxTotal: taxTotalPaise,
          total: totalPaise,
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

      const revenueByAccount = new Map<SystemAccountKey, bigint>();

      for (const line of computedLines) {
        const account = revenueAccountFor(line.revenueCategory);
        revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0n) + line.taxableValue);
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
            debit: amount,
          })),
          ...(taxTotalPaise > 0n ? [{ account: "gst_output" as const, debit: taxTotalPaise }] : []),
          { account: "patient_receivables", credit: totalPaise },
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
