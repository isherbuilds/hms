import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  buildBalanceSheet,
  buildGstReport,
  buildTrialBalance,
  type AccountAggregate,
  type GstBucket,
} from "../lib/report-math";

const reportDate = z.iso.date();
const periodInput = orgInput.extend({ from: reportDate, to: reportDate });
const asOfInput = orgInput.extend({ asOf: reportDate });

const DAY_MS = 24 * 60 * 60 * 1_000;

// `maxDays` belongs only to reports whose row count grows with the period. Trial
// balance and balance sheet return one row per account whatever the range, and the
// pool's statement timeout already bounds a long scan.
const MAX_FILING_DAYS = 366;

function assertValidPeriod(from: string, to: string, maxDays?: number): void {
  if (from > to) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The start date must not be after the end date",
    });
  }
  if (maxDays === undefined) return;

  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (days > maxDays) {
    throw new ORPCError("BAD_REQUEST", {
      message: `The GST register covers at most ${maxDays} days`,
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
  trialBalance: orgProcedure({ report: ["read"] }, periodInput).handler(
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

  balanceSheet: orgProcedure({ report: ["read"] }, asOfInput).handler(
    async ({ context, input }) => {
      const aggregates = await accountAggregates(
        context.scope.orgId,
        lte(journalEntries.entryDate, input.asOf),
      );

      return buildBalanceSheet({ asOf: input.asOf, aggregates });
    },
  ),

  gst: orgProcedure({ report: ["read"] }, periodInput).handler(async ({ context, input }) => {
    assertValidPeriod(input.from, input.to, MAX_FILING_DAYS);
    const orgId = context.scope.orgId;
    const { timeZone } = await readOrgSettings(orgId);

    const invoiceDate = sql<string>`(${invoices.createdAt} AT TIME ZONE ${timeZone})::date`;
    const creditNoteDate = sql<string>`(${creditNotes.createdAt} AT TIME ZONE ${timeZone})::date`;

    const [invoiceBuckets, creditNoteBuckets] = await Promise.all([
      db
        .select({
          documentId: invoices.id,
          number: invoices.invoiceNumber,
          date: invoiceDate,
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
            sql`(${invoices.createdAt} AT TIME ZONE ${timeZone})::date between ${input.from}::date and ${input.to}::date`,
          ),
        )
        .groupBy(
          invoices.id,
          invoices.invoiceNumber,
          invoiceDate,
          invoices.patientName,
          invoices.patientMrn,
          invoiceLines.taxRatePercent,
          invoiceLines.taxCode,
        ),
      db
        .select({
          documentId: creditNotes.id,
          number: creditNotes.creditNoteNumber,
          date: creditNoteDate,
          patientName: invoices.patientName,
          patientMrn: invoices.patientMrn,
          taxRatePercent: invoiceLines.taxRatePercent,
          taxCode: invoiceLines.taxCode,
          taxableValue: sql<string>`sum(${creditNoteLines.taxableValue})::text`,
          taxAmount: sql<string>`sum(${creditNoteLines.taxAmount})::text`,
          gross: sql<string>`sum(${creditNoteLines.gross})::text`,
        })
        .from(creditNotes)
        .innerJoin(invoices, and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.orgId, orgId)))
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
            sql`(${creditNotes.createdAt} AT TIME ZONE ${timeZone})::date between ${input.from}::date and ${input.to}::date`,
          ),
        )
        .groupBy(
          creditNotes.id,
          creditNotes.creditNoteNumber,
          creditNoteDate,
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
  }),
};
