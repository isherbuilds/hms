import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { fromPaise, splitGst, toPaise } from "../lib/invoice-math";
import { orgInput, orgProcedure } from "../lib/procedures/factory";

const reportDate = z.iso.date();
const periodInput = orgInput.extend({ from: reportDate, to: reportDate });
const asOfInput = orgInput.extend({ asOf: reportDate });

type AccountAggregate = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  debit: string;
  credit: string;
};

type GstBucket = {
  docType: "invoice" | "credit_note";
  documentId: string;
  number: string;
  date: string;
  patientName: string;
  patientMrn: string;
  taxRatePercent: string;
  taxCode: string | null;
  taxableValue: string;
  taxAmount: string;
  gross: string;
};

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("Report amount exceeds the safe integer range");
  }
  return result;
}

function assertValidPeriod(from: string, to: string): void {
  if (from > to) {
    throw new ORPCError("BAD_REQUEST");
  }
}

function signedToPaise(value: string): number {
  if (value.startsWith("-")) {
    return -toPaise(value.slice(1));
  }
  return toPaise(value);
}

function moneySum(rows: readonly string[]): number {
  return rows.reduce((total, value) => checkedAdd(total, signedToPaise(value)), 0);
}

function splitSignedGstPaise(taxAmountPaise: number): { cgstPaise: number; sgstPaise: number } {
  const sign = taxAmountPaise < 0 ? -1 : 1;
  const split = splitGst(fromPaise(Math.abs(taxAmountPaise)));
  return {
    cgstPaise: sign * toPaise(split.cgst),
    sgstPaise: sign * toPaise(split.sgst),
  };
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
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
    .orderBy(asc(accounts.code));
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

      const byAccount = new Map<
        string,
        Omit<AccountAggregate, "debit" | "credit"> & {
          openingPaise: number;
          debitPaise: number;
          creditPaise: number;
        }
      >();

      for (const row of openingRows) {
        byAccount.set(row.accountId, {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          type: row.type,
          openingPaise: checkedAdd(toPaise(row.debit), -toPaise(row.credit)),
          debitPaise: 0,
          creditPaise: 0,
        });
      }
      for (const row of activityRows) {
        const existing = byAccount.get(row.accountId);
        byAccount.set(row.accountId, {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          type: row.type,
          openingPaise: existing?.openingPaise ?? 0,
          debitPaise: toPaise(row.debit),
          creditPaise: toPaise(row.credit),
        });
      }

      const rows = [...byAccount.values()]
        .filter((row) => row.openingPaise !== 0 || row.debitPaise !== 0 || row.creditPaise !== 0)
        .sort((left, right) => left.code.localeCompare(right.code))
        .map((row) => {
          const closingPaise = checkedAdd(
            checkedAdd(row.openingPaise, row.debitPaise),
            -row.creditPaise,
          );
          return {
            accountId: row.accountId,
            code: row.code,
            name: row.name,
            type: row.type,
            openingDebit: fromPaise(Math.max(row.openingPaise, 0)),
            openingCredit: fromPaise(Math.max(-row.openingPaise, 0)),
            debit: fromPaise(row.debitPaise),
            credit: fromPaise(row.creditPaise),
            closingDebit: fromPaise(Math.max(closingPaise, 0)),
            closingCredit: fromPaise(Math.max(-closingPaise, 0)),
          };
        });

      const openingDebit = moneySum(rows.map((row) => row.openingDebit));
      const openingCredit = moneySum(rows.map((row) => row.openingCredit));
      const debit = moneySum(rows.map((row) => row.debit));
      const credit = moneySum(rows.map((row) => row.credit));
      const closingDebit = moneySum(rows.map((row) => row.closingDebit));
      const closingCredit = moneySum(rows.map((row) => row.closingCredit));

      return {
        from: input.from,
        to: input.to,
        rows,
        totals: {
          openingDebit: fromPaise(openingDebit),
          openingCredit: fromPaise(openingCredit),
          debit: fromPaise(debit),
          credit: fromPaise(credit),
          closingDebit: fromPaise(closingDebit),
          closingCredit: fromPaise(closingCredit),
        },
      };
    },
  ),

  balanceSheet: orgProcedure({ report: ["read"] }, asOfInput).handler(
    async ({ context, input }) => {
      const aggregates = await accountAggregates(
        context.scope.orgId,
        lte(journalEntries.entryDate, input.asOf),
      );

      const assets: Array<{ code: string; name: string; balance: string }> = [];
      const liabilities: Array<{ code: string; name: string; balance: string }> = [];
      const equity: Array<{ code: string; name: string; balance: string }> = [];
      let surplusPaise = 0;

      for (const row of aggregates) {
        const debitPaise = toPaise(row.debit);
        const creditPaise = toPaise(row.credit);
        const debitBalance = checkedAdd(debitPaise, -creditPaise);
        const creditBalance = checkedAdd(creditPaise, -debitPaise);

        if (row.type === "asset" && debitBalance !== 0) {
          assets.push({ code: row.code, name: row.name, balance: fromPaise(debitBalance) });
        } else if (row.type === "liability" && creditBalance !== 0) {
          liabilities.push({ code: row.code, name: row.name, balance: fromPaise(creditBalance) });
        } else if (row.type === "equity" && creditBalance !== 0) {
          equity.push({ code: row.code, name: row.name, balance: fromPaise(creditBalance) });
        } else if (row.type === "income") {
          surplusPaise = checkedAdd(surplusPaise, creditBalance);
        } else if (row.type === "expense") {
          surplusPaise = checkedAdd(surplusPaise, -debitBalance);
        }
      }

      if (surplusPaise !== 0) {
        equity.push({ code: "3900", name: "Current surplus", balance: fromPaise(surplusPaise) });
      }
      assets.sort((left, right) => left.code.localeCompare(right.code));
      liabilities.sort((left, right) => left.code.localeCompare(right.code));
      equity.sort((left, right) => left.code.localeCompare(right.code));

      const assetsTotal = moneySum(assets.map((row) => row.balance));
      const liabilitiesAndEquity = moneySum([...liabilities, ...equity].map((row) => row.balance));

      return {
        asOf: input.asOf,
        assets,
        liabilities,
        equity,
        totals: {
          assets: fromPaise(assetsTotal),
          liabilitiesAndEquity: fromPaise(liabilitiesAndEquity),
        },
      };
    },
  ),

  gst: orgProcedure({ report: ["read"] }, periodInput).handler(async ({ context, input }) => {
    assertValidPeriod(input.from, input.to);
    const orgId = context.scope.orgId;

    const invoiceDate = sql<string>`(${invoices.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`;
    const creditNoteDate = sql<string>`(${creditNotes.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`;

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
            sql`(${invoices.createdAt} AT TIME ZONE 'Asia/Kolkata')::date between ${input.from}::date and ${input.to}::date`,
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
            sql`(${creditNotes.createdAt} AT TIME ZONE 'Asia/Kolkata')::date between ${input.from}::date and ${input.to}::date`,
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
      ...creditNoteBuckets.map((row) => ({
        ...row,
        docType: "credit_note" as const,
        taxableValue: fromPaise(-toPaise(row.taxableValue)),
        taxAmount: fromPaise(-toPaise(row.taxAmount)),
        gross: fromPaise(-toPaise(row.gross)),
      })),
    ];

    const documentMap = new Map<
      string,
      {
        docType: "invoice" | "credit_note";
        number: string;
        date: string;
        patientName: string;
        patientMrn: string;
        taxableValuePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        taxAmountPaise: number;
        grossPaise: number;
      }
    >();
    const rateMap = new Map<
      string,
      {
        taxableValuePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        taxAmountPaise: number;
      }
    >();
    const gstSplitMap = new Map<
      string,
      { documentKey: string; taxRatePercent: string; taxAmountPaise: number }
    >();
    const hsnMap = new Map<
      string,
      { taxCode: string; taxRatePercent: string; taxableValuePaise: number; taxAmountPaise: number }
    >();

    for (const bucket of buckets) {
      const taxableValuePaise = signedToPaise(bucket.taxableValue);
      const taxAmountPaise = signedToPaise(bucket.taxAmount);
      const grossPaise = signedToPaise(bucket.gross);
      const documentKey = `${bucket.docType}:${bucket.documentId}`;
      const document = documentMap.get(documentKey) ?? {
        docType: bucket.docType,
        number: bucket.number,
        date: bucket.date,
        patientName: bucket.patientName,
        patientMrn: bucket.patientMrn,
        taxableValuePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        taxAmountPaise: 0,
        grossPaise: 0,
      };
      document.taxableValuePaise = checkedAdd(document.taxableValuePaise, taxableValuePaise);
      document.taxAmountPaise = checkedAdd(document.taxAmountPaise, taxAmountPaise);
      document.grossPaise = checkedAdd(document.grossPaise, grossPaise);
      documentMap.set(documentKey, document);

      const rate = rateMap.get(bucket.taxRatePercent) ?? {
        taxableValuePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        taxAmountPaise: 0,
      };
      rate.taxableValuePaise = checkedAdd(rate.taxableValuePaise, taxableValuePaise);
      rate.taxAmountPaise = checkedAdd(rate.taxAmountPaise, taxAmountPaise);
      rateMap.set(bucket.taxRatePercent, rate);

      const gstSplitKey = `${documentKey}\u0000${bucket.taxRatePercent}`;
      const gstSplit = gstSplitMap.get(gstSplitKey) ?? {
        documentKey,
        taxRatePercent: bucket.taxRatePercent,
        taxAmountPaise: 0,
      };
      gstSplit.taxAmountPaise = checkedAdd(gstSplit.taxAmountPaise, taxAmountPaise);
      gstSplitMap.set(gstSplitKey, gstSplit);

      const taxCode = bucket.taxCode ?? "";
      const hsnKey = `${taxCode}\u0000${bucket.taxRatePercent}`;
      const hsn = hsnMap.get(hsnKey) ?? {
        taxCode,
        taxRatePercent: bucket.taxRatePercent,
        taxableValuePaise: 0,
        taxAmountPaise: 0,
      };
      hsn.taxableValuePaise = checkedAdd(hsn.taxableValuePaise, taxableValuePaise);
      hsn.taxAmountPaise = checkedAdd(hsn.taxAmountPaise, taxAmountPaise);
      hsnMap.set(hsnKey, hsn);
    }

    for (const splitBucket of gstSplitMap.values()) {
      const { cgstPaise, sgstPaise } = splitSignedGstPaise(splitBucket.taxAmountPaise);
      const document = documentMap.get(splitBucket.documentKey);
      const rate = rateMap.get(splitBucket.taxRatePercent);
      if (!document || !rate) {
        throw new Error("GST report split bucket is missing its aggregate");
      }
      document.cgstPaise = checkedAdd(document.cgstPaise, cgstPaise);
      document.sgstPaise = checkedAdd(document.sgstPaise, sgstPaise);
      rate.cgstPaise = checkedAdd(rate.cgstPaise, cgstPaise);
      rate.sgstPaise = checkedAdd(rate.sgstPaise, sgstPaise);
    }

    const documents = [...documentMap.values()]
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.number.localeCompare(right.number),
      )
      .map((document) => ({
        docType: document.docType,
        number: document.number,
        date: document.date,
        patientName: document.patientName,
        patientMrn: document.patientMrn,
        taxableValue: fromPaise(document.taxableValuePaise),
        cgst: fromPaise(document.cgstPaise),
        sgst: fromPaise(document.sgstPaise),
        taxAmount: fromPaise(document.taxAmountPaise),
        gross: fromPaise(document.grossPaise),
      }));

    const rateSummary = [...rateMap.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([taxRatePercent, bucket]) => ({
        taxRatePercent,
        taxableValue: fromPaise(bucket.taxableValuePaise),
        cgst: fromPaise(bucket.cgstPaise),
        sgst: fromPaise(bucket.sgstPaise),
        taxAmount: fromPaise(bucket.taxAmountPaise),
      }));

    const hsnSummary = [...hsnMap.values()]
      .sort(
        (left, right) =>
          left.taxCode.localeCompare(right.taxCode) ||
          Number(left.taxRatePercent) - Number(right.taxRatePercent),
      )
      .map((bucket) => ({
        taxCode: bucket.taxCode,
        taxRatePercent: bucket.taxRatePercent,
        taxableValue: fromPaise(bucket.taxableValuePaise),
        taxAmount: fromPaise(bucket.taxAmountPaise),
      }));

    const documentAggregates = [...documentMap.values()];
    const taxableValuePaise = documentAggregates.reduce(
      (total, row) => checkedAdd(total, row.taxableValuePaise),
      0,
    );
    const cgstPaise = documentAggregates.reduce(
      (total, row) => checkedAdd(total, row.cgstPaise),
      0,
    );
    const sgstPaise = documentAggregates.reduce(
      (total, row) => checkedAdd(total, row.sgstPaise),
      0,
    );
    const taxAmountPaise = documentAggregates.reduce(
      (total, row) => checkedAdd(total, row.taxAmountPaise),
      0,
    );
    const grossPaise = documentAggregates.reduce(
      (total, row) => checkedAdd(total, row.grossPaise),
      0,
    );

    return {
      from: input.from,
      to: input.to,
      documents,
      rateSummary,
      hsnSummary,
      totals: {
        taxableValue: fromPaise(taxableValuePaise),
        cgst: fromPaise(cgstPaise),
        sgst: fromPaise(sgstPaise),
        taxAmount: fromPaise(taxAmountPaise),
        gross: fromPaise(grossPaise),
      },
    };
  }),
};
