import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { departments } from "@hms/db/schema/departments";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { refunds } from "@hms/db/schema/refunds";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { businessDate } from "../lib/business-date";
import { fromPaise, toPaise } from "../lib/invoice-math";
import { closeExpiredBookings } from "../lib/opd-close";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  buildBalanceSheet,
  buildGstReport,
  buildTrialBalance,
  type AccountAggregate,
  type GstBucket,
} from "../lib/report-math";
import type { PaymentMethod } from "../lib/schemas";

const reportDate = z.iso.date();
const periodInput = orgInput.extend({ from: reportDate, to: reportDate });
const asOfInput = orgInput.extend({ asOf: reportDate });

const DAY_MS = 24 * 60 * 60 * 1_000;

// `maxDays` belongs only to reports whose row count grows with the period. Trial
// balance and balance sheet return one row per account whatever the range, and the
// pool's statement timeout already bounds a long scan.
const GST_BOUND = { report: "GST register", maxDays: 366 };
const COLLECTIONS_BOUND = { report: "Daily collections", maxDays: 92 };
const REGISTER_BOUND = { report: "OPD register", maxDays: 31 };
const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "upi", "card"];

function assertValidPeriod(
  from: string,
  to: string,
  bound?: { report: string; maxDays: number },
): void {
  if (from > to) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The start date must not be after the end date",
    });
  }
  if (!bound) return;

  const inclusiveDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (inclusiveDays > bound.maxDays) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${bound.report} covers at most ${bound.maxDays} days`,
    });
  }
}

async function accountAggregates(
  orgId: string,
  ...datePredicates: SQL<unknown>[]
): Promise<AccountAggregate[]> {
  return db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::text`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::text`,
    })
    .from(accounts)
    .innerJoin(
      journalLines,
      and(eq(journalLines.accountId, accounts.id), eq(journalLines.orgId, orgId)),
    )
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.id, journalLines.entryId), eq(journalEntries.orgId, orgId)),
    )
    .where(and(eq(accounts.orgId, orgId), ...datePredicates))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type);
}

export const reportRouter = {
  trialBalance: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to);

      const [openingRows, activityRows] = await Promise.all([
        accountAggregates(context.scope.orgId, lt(journalEntries.entryDate, input.from)),
        accountAggregates(
          context.scope.orgId,
          gte(journalEntries.entryDate, input.from),
          lte(journalEntries.entryDate, input.to),
        ),
      ]);

      return buildTrialBalance({
        from: input.from,
        to: input.to,
        openingRows,
        activityRows,
      });
    },
  ),

  balanceSheet: orgProcedure({ report: ["readFinancial"] }, asOfInput).handler(
    async ({ context, input }) => {
      const aggregates = await accountAggregates(
        context.scope.orgId,
        lte(journalEntries.entryDate, input.asOf),
      );

      return buildBalanceSheet({ asOf: input.asOf, aggregates });
    },
  ),

  dailyCollections: orgProcedure({ report: ["readDailyCollections"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, COLLECTIONS_BOUND);
      const orgId = context.scope.orgId;
      const [paymentRows, refundRows] = await Promise.all([
        db
          .select({
            businessDate: payments.businessDate,
            method: sql<PaymentMethod>`${payments.method}`,
            amount: sql<string>`sum(${payments.amount})::text`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.orgId, orgId),
              gte(payments.businessDate, input.from),
              lte(payments.businessDate, input.to),
            ),
          )
          .groupBy(payments.businessDate, payments.method),
        db
          .select({
            businessDate: refunds.businessDate,
            method: sql<PaymentMethod>`${refunds.method}`,
            amount: sql<string>`sum(${refunds.amount})::text`,
          })
          .from(refunds)
          .where(
            and(
              eq(refunds.orgId, orgId),
              gte(refunds.businessDate, input.from),
              lte(refunds.businessDate, input.to),
            ),
          )
          .groupBy(refunds.businessDate, refunds.method),
      ]);

      const buckets = new Map<
        string,
        { businessDate: string; method: PaymentMethod; payments: number; refunds: number }
      >();
      for (const row of paymentRows) {
        buckets.set(`${row.businessDate}:${row.method}`, {
          businessDate: row.businessDate,
          method: row.method,
          payments: toPaise(row.amount),
          refunds: 0,
        });
      }
      for (const row of refundRows) {
        const key = `${row.businessDate}:${row.method}`;
        const bucket = buckets.get(key) ?? {
          businessDate: row.businessDate,
          method: row.method,
          payments: 0,
          refunds: 0,
        };
        bucket.refunds += toPaise(row.amount);
        buckets.set(key, bucket);
      }

      const amounts = [...buckets.values()].sort(
        (left, right) =>
          left.businessDate.localeCompare(right.businessDate) ||
          left.method.localeCompare(right.method),
      );
      const methodTotals: Record<PaymentMethod, { payments: number; refunds: number }> = {
        cash: { payments: 0, refunds: 0 },
        upi: { payments: 0, refunds: 0 },
        card: { payments: 0, refunds: 0 },
      };
      const days = new Map<
        string,
        {
          businessDate: string;
          byMethod: Record<PaymentMethod, number>;
          payments: number;
          refunds: number;
        }
      >();
      let paymentsTotal = 0;
      let refundsTotal = 0;
      for (const row of amounts) {
        methodTotals[row.method].payments += row.payments;
        methodTotals[row.method].refunds += row.refunds;
        paymentsTotal += row.payments;
        refundsTotal += row.refunds;

        const day = days.get(row.businessDate) ?? {
          businessDate: row.businessDate,
          byMethod: { cash: 0, upi: 0, card: 0 },
          payments: 0,
          refunds: 0,
        };
        day.byMethod[row.method] += row.payments - row.refunds;
        day.payments += row.payments;
        day.refunds += row.refunds;
        days.set(row.businessDate, day);
      }
      const rows = [...days.values()].map((day) => ({
        businessDate: day.businessDate,
        byMethod: {
          cash: fromPaise(day.byMethod.cash),
          upi: fromPaise(day.byMethod.upi),
          card: fromPaise(day.byMethod.card),
        },
        payments: fromPaise(day.payments),
        refunds: fromPaise(day.refunds),
        net: fromPaise(day.payments - day.refunds),
      }));
      const byMethod = PAYMENT_METHODS.map((method) => ({
        method,
        payments: fromPaise(methodTotals[method].payments),
        refunds: fromPaise(methodTotals[method].refunds),
        net: fromPaise(methodTotals[method].payments - methodTotals[method].refunds),
      }));

      return {
        from: input.from,
        to: input.to,
        rows,
        byMethod,
        totals: {
          payments: fromPaise(paymentsTotal),
          refunds: fromPaise(refundsTotal),
          net: fromPaise(paymentsTotal - refundsTotal),
        },
      };
    },
  ),

  opdRegister: orgProcedure({ report: ["readOpdRegister"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, REGISTER_BOUND);
      const { scope } = context;
      const settings = await readOrgSettings(scope.orgId);
      const now = new Date();
      const currentDay = businessDate(now, settings.timeZone);
      if (input.from < currentDay) {
        await closeExpiredBookings({
          orgId: scope.orgId,
          actorId: scope.userId,
          currentDay,
          now,
        });
      }

      const billed = sql<string>`coalesce((select sum(${invoices.grandTotal}) from ${invoices}
        where ${invoices.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::text`;
      const paid = sql<string>`coalesce((select sum(${payments.amount}) from ${payments}
        inner join ${invoices}
          on ${invoices.id} = ${payments.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${payments.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::text`;
      const credits = sql<string>`coalesce((select sum(${creditNotes.total}) from ${creditNotes}
        inner join ${invoices}
          on ${invoices.id} = ${creditNotes.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${creditNotes.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::text`;
      const refunded = sql<string>`coalesce((select sum(${refunds.amount}) from ${refunds}
        inner join ${invoices}
          on ${invoices.id} = ${refunds.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${refunds.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::text`;

      const selected = await db
        .select({
          appointmentId: opdAppointments.id,
          businessDate: opdAppointments.businessDate,
          tokenNumber: opdAppointments.tokenNumber,
          patientName: patients.name,
          patientMrn: patients.mrn,
          callerName: opdAppointments.callerName,
          practitionerName: practitioners.name,
          departmentName: departments.name,
          arrivalMode: opdAppointments.arrivalMode,
          status: opdAppointments.status,
          arrivedAt: opdAppointments.arrivedAt,
          billed,
          paid,
          credits,
          refunds: refunded,
        })
        .from(opdAppointments)
        .leftJoin(
          patients,
          and(eq(patients.id, opdAppointments.patientId), eq(patients.orgId, scope.orgId)),
        )
        .innerJoin(
          practitioners,
          and(
            eq(practitioners.id, opdAppointments.practitionerId),
            eq(practitioners.orgId, scope.orgId),
          ),
        )
        .innerJoin(
          departments,
          and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, scope.orgId)),
        )
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            gte(opdAppointments.businessDate, input.from),
            lte(opdAppointments.businessDate, input.to),
          ),
        )
        .orderBy(
          asc(opdAppointments.businessDate),
          asc(opdAppointments.dayOrderAt),
          asc(opdAppointments.id),
        );

      const byStatus = { booked: 0, checked_in: 0, cancelled: 0, no_show: 0 };
      let billedTotal = 0;
      let paidTotal = 0;
      let creditsTotal = 0;
      let refundsTotal = 0;
      const rows = selected.map((row) => {
        const billedPaise = toPaise(row.billed);
        const paidPaise = toPaise(row.paid);
        const creditsPaise = toPaise(row.credits);
        const refundsPaise = toPaise(row.refunds);
        billedTotal += billedPaise;
        paidTotal += paidPaise;
        creditsTotal += creditsPaise;
        refundsTotal += refundsPaise;
        byStatus[row.status] += 1;
        return {
          ...row,
          billed: fromPaise(billedPaise),
          paid: fromPaise(paidPaise),
          credits: fromPaise(creditsPaise),
          refunds: fromPaise(refundsPaise),
          outstanding: fromPaise(billedPaise - creditsPaise - paidPaise + refundsPaise),
        };
      });

      return {
        from: input.from,
        to: input.to,
        rows,
        totals: {
          appointments: rows.length,
          byStatus,
          billed: fromPaise(billedTotal),
          paid: fromPaise(paidTotal),
          credits: fromPaise(creditsTotal),
          refunds: fromPaise(refundsTotal),
          outstanding: fromPaise(billedTotal - creditsTotal - paidTotal + refundsTotal),
        },
      };
    },
  ),

  gst: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, GST_BOUND);
      const orgId = context.scope.orgId;

      // The stored Business Date, never `createdAt` reinterpreted through the current
      // timezone: an issued document's date does not move when settings change.
      const [invoiceBuckets, creditNoteBuckets] = await Promise.all([
        db
          .select({
            documentId: invoices.id,
            number: invoices.invoiceNumber,
            date: invoices.businessDate,
            patientName: invoices.patientName,
            patientMrn: invoices.patientMrn,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql<string>`sum(${invoiceLines.taxableValue})::text`,
            taxAmount: sql<string>`sum(${invoiceLines.taxAmount})::text`,
            gross: sql<string>`sum(${invoiceLines.gross})::text`,
          })
          .from(invoices)
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.invoiceId, invoices.id), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(invoices.orgId, orgId),
              gte(invoices.businessDate, input.from),
              lte(invoices.businessDate, input.to),
            ),
          )
          .groupBy(
            invoices.id,
            invoices.invoiceNumber,
            invoices.businessDate,
            invoices.patientName,
            invoices.patientMrn,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
        db
          .select({
            documentId: creditNotes.id,
            number: creditNotes.creditNoteNumber,
            date: creditNotes.businessDate,
            patientName: invoices.patientName,
            patientMrn: invoices.patientMrn,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql<string>`sum(${creditNoteLines.taxableValue})::text`,
            taxAmount: sql<string>`sum(${creditNoteLines.taxAmount})::text`,
            gross: sql<string>`sum(${creditNoteLines.gross})::text`,
          })
          .from(creditNotes)
          .innerJoin(
            invoices,
            and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.orgId, orgId)),
          )
          .innerJoin(
            creditNoteLines,
            and(eq(creditNoteLines.creditNoteId, creditNotes.id), eq(creditNoteLines.orgId, orgId)),
          )
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.id, creditNoteLines.invoiceLineId), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(creditNotes.orgId, orgId),
              gte(creditNotes.businessDate, input.from),
              lte(creditNotes.businessDate, input.to),
            ),
          )
          .groupBy(
            creditNotes.id,
            creditNotes.creditNoteNumber,
            creditNotes.businessDate,
            invoices.patientName,
            invoices.patientMrn,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
      ]);

      const buckets: GstBucket[] = [
        ...invoiceBuckets.map((row) => ({ ...row, docType: "invoice" as const })),
        ...creditNoteBuckets.map((row) => ({ ...row, docType: "credit_note" as const })),
      ];

      return buildGstReport({
        from: input.from,
        to: input.to,
        buckets,
      });
    },
  ),
};
