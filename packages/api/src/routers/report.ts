import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
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
import { paymentMethod, type PaymentMethod } from "../lib/schemas";

const reportDate = z.iso.date();

const periodInput = orgInput.extend({ from: reportDate, to: reportDate });

const asOfInput = orgInput.extend({ asOf: reportDate });

const DAY_MS = 24 * 60 * 60 * 1_000;

const GST_BOUND = { report: "GST register", maxDays: 366 };

const COLLECTIONS_BOUND = { report: "Daily collections", maxDays: 92 };

const REGISTER_BOUND = { report: "OPD register", maxDays: 31 };

const PAYMENT_METHODS = paymentMethod.options;

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
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql`coalesce(sum(${journalLines.debit}), 0)::bigint`.mapWith(BigInt),
      credit: sql`coalesce(sum(${journalLines.credit}), 0)::bigint`.mapWith(BigInt),
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

  return rows;
}

function perMethod<T>(value: (method: PaymentMethod) => T): Record<PaymentMethod, T> {
  // SAFETY: the entries are keyed by every PAYMENT_METHODS member.
  return Object.fromEntries(PAYMENT_METHODS.map((method) => [method, value(method)])) as Record<
    PaymentMethod,
    T
  >;
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

      // One row per date, method, and kind; a refund's kind follows its source document.
      const movements = await db.execute<{
        businessDate: string;
        method: PaymentMethod;
        kind: "payments" | "advances" | "refunds" | "advanceRefunds";
        amount: string;
      }>(sql`
        select business_date::text as "businessDate", method, kind, sum(amount)::bigint as amount
        from (
          select ${payments.businessDate} as business_date, ${payments.method} as method,
                 'payments'::text as kind, ${payments.amount} as amount
          from ${payments}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${input.from} and ${input.to}
          union all
          select ${advanceReceipts.businessDate}, ${advanceReceipts.method}, 'advances',
                 ${advanceReceipts.amount}
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${input.from} and ${input.to}
          union all
          select ${refunds.businessDate}, ${refunds.method},
                 case when ${refunds.advanceReceiptId} is null then 'refunds' else 'advanceRefunds' end,
                 ${refunds.amount}
          from ${refunds}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${input.from} and ${input.to}
        ) movement
        group by business_date, method, kind
        order by business_date
      `);

      const empty = () => ({ payments: 0n, advances: 0n, refunds: 0n, advanceRefunds: 0n });

      const net = (amounts: ReturnType<typeof empty>) =>
        amounts.payments + amounts.advances - amounts.refunds - amounts.advanceRefunds;

      const totals = empty();
      const methodTotals = perMethod(empty);

      const days = new Map<
        string,
        { businessDate: string; byMethod: Record<PaymentMethod, bigint> } & ReturnType<typeof empty>
      >();

      for (const row of movements.rows) {
        const amount = BigInt(row.amount);

        const day = days.get(row.businessDate) ?? {
          businessDate: row.businessDate,
          byMethod: perMethod(() => 0n),
          ...empty(),
        };

        day[row.kind] += amount;
        day.byMethod[row.method] +=
          row.kind === "payments" || row.kind === "advances" ? amount : -amount;
        methodTotals[row.method][row.kind] += amount;
        totals[row.kind] += amount;
        days.set(row.businessDate, day);
      }

      return {
        from: input.from,
        to: input.to,
        rows: [...days.values()].map((day) => ({ ...day, net: net(day) })),
        byMethod: PAYMENT_METHODS.map((method) => ({
          method,
          ...methodTotals[method],
          net: net(methodTotals[method]),
        })),
        totals: { ...totals, net: net(totals) },
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

      const billed = sql`coalesce((select sum(${invoices.grandTotal}) from ${invoices}
        where ${invoices.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`.mapWith(BigInt);

      // Credit applied from an advance settles a visit the same way a payment does.
      const paid = sql`(coalesce((select sum(${payments.amount}) from ${payments}
        inner join ${invoices}
          on ${invoices.id} = ${payments.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${payments.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)
        + coalesce((select sum(${advanceAllocations.amount}) from ${advanceAllocations}
        inner join ${invoices}
          on ${invoices.id} = ${advanceAllocations.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${advanceAllocations.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0))::bigint`.mapWith(BigInt);

      const credits = sql`coalesce((select sum(${creditNotes.total}) from ${creditNotes}
        inner join ${invoices}
          on ${invoices.id} = ${creditNotes.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${creditNotes.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`.mapWith(BigInt);

      const refunded = sql`coalesce((select sum(${refunds.amount}) from ${refunds}
        inner join ${invoices}
          on ${invoices.id} = ${refunds.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${refunds.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`.mapWith(BigInt);

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
      let billedTotal = 0n;
      let paidTotal = 0n;
      let creditsTotal = 0n;
      let refundsTotal = 0n;

      const rows = selected.map((row) => {
        billedTotal += row.billed;
        paidTotal += row.paid;
        creditsTotal += row.credits;
        refundsTotal += row.refunds;
        byStatus[row.status] += 1;

        return {
          ...row,
          outstanding: row.billed - row.credits - row.paid + row.refunds,
        };
      });

      return {
        from: input.from,
        to: input.to,
        rows,
        totals: {
          appointments: rows.length,
          byStatus,
          billed: billedTotal,
          paid: paidTotal,
          credits: creditsTotal,
          refunds: refundsTotal,
          outstanding: billedTotal - creditsTotal - paidTotal + refundsTotal,
        },
      };
    },
  ),

  gst: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, GST_BOUND);
      const orgId = context.scope.orgId;

      // The stored Business Date, never `createdAt` reinterpreted through the current timezone.
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
            taxableValue: sql`sum(${invoiceLines.taxableValue})::bigint`.mapWith(BigInt),
            taxAmount: sql`sum(${invoiceLines.taxAmount})::bigint`.mapWith(BigInt),
            gross: sql`sum(${invoiceLines.gross})::bigint`.mapWith(BigInt),
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
            taxableValue: sql`sum(${creditNoteLines.taxableValue})::bigint`.mapWith(BigInt),
            taxAmount: sql`sum(${creditNoteLines.taxAmount})::bigint`.mapWith(BigInt),
            gross: sql`sum(${creditNoteLines.gross})::bigint`.mapWith(BigInt),
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
        ...invoiceBuckets.map((row) => ({
          ...row,
          docType: "invoice" as const,
        })),
        ...creditNoteBuckets.map((row) => ({
          ...row,
          docType: "credit_note" as const,
        })),
      ];

      return buildGstReport({
        from: input.from,
        to: input.to,
        buckets,
      });
    },
  ),
};
