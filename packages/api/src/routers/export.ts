import { call } from "@orpc/server";
import { writeXlsx } from "hucre/xlsx";
import { z } from "zod";

import {
  arrivalModeLabel,
  OPD_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  practitionerDisplayName,
} from "../lib/labels";
import { orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  assertValidPeriod,
  asOfInput,
  gstReport,
  invoiceRegisterExportInput,
  opdRegisterRow,
  opdRegisterRows,
  opdRegisterTotals,
  periodInput,
  registerFilter,
  registerRow,
  registerRows,
  registerSummary,
  reportRouter,
  REVENUE_BOUND,
  revenueSignalKind,
  settleOpdRegister,
  signalRows,
  signalSource,
} from "./report";

const revenueControlExportInput = periodInput.extend({
  horizonDays: z.union([z.literal(30), z.literal(90)]).default(30),
});

const SIGNAL_SHEETS = {
  no_charge: "Visits with no charge",
  voided_charge: "Voided charges",
  discount: "Invoice discounts",
  credit_note: "Credit notes",
  below_mrp: "Sales below MRP",
  stock_adjustment: "Stock adjustments",
  refund: "Refunds",
} as const;

// hucre keys header styles `"row,col"`; a column's own `style` would bold the
// whole column, not row 1.
const BOLD_HEADER = { style: { font: { bold: true } } };

type Column = { header: string; key: string; width: number };

type Sheet = {
  name: string;
  columns: Column[];
  rows: Array<Record<string, string | number>>;
};

// Each export runs the report procedure with this request's context, so the same
// permission guard and tenant scope apply and membership resolves once.
async function xlsxFile(fileName: string, sheets: Sheet[]): Promise<File> {
  const bytes = await writeXlsx({
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      columns: sheet.columns,
      data: sheet.rows,
      cells: new Map(sheet.columns.map((_, index) => [`0,${index}`, BOLD_HEADER])),
    })),
  });

  // SAFETY: hucre allocates a plain ArrayBuffer for an unencrypted workbook, so the
  // `SharedArrayBuffer` that `Uint8Array<ArrayBufferLike>` admits never occurs.
  return new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const periodFile = (prefix: string, input: { from: string; to: string }) =>
  `${prefix}-${input.from}-to-${input.to}.xlsx`;

// Spreadsheet cells want a plain number; nothing else does arithmetic on this.
const rupees = (paise: bigint) => Number(paise) / 100;

const registerMoneyColumns = [
  { header: "Subtotal", key: "subtotal", width: 16 },
  { header: "Discount", key: "discountAmount", width: 16 },
  { header: "Issued line value", key: "taxableValue", width: 20 },
  { header: "GST", key: "taxTotal", width: 16 },
  { header: "Round-off", key: "roundOff", width: 14 },
  { header: "Invoice total", key: "grandTotal", width: 16 },
  { header: "Credit notes", key: "creditTotal", width: 16 },
  { header: "Net billed", key: "netBilled", width: 16 },
  { header: "Paid", key: "paymentsTotal", width: 16 },
  { header: "Allocated credit", key: "allocationsTotal", width: 18 },
  { header: "Refunds", key: "refundsTotal", width: 16 },
  { header: "Outstanding", key: "outstanding", width: 16 },
] as const;

const revenueColumns: Column[] = [
  { header: "Group", key: "label", width: 30 },
  { header: "Issued line value", key: "issuedTaxableValue", width: 20 },
  { header: "Credited line value", key: "creditedTaxableValue", width: 20 },
  { header: "Net billed revenue", key: "netTaxableValue", width: 20 },
  { header: "Net GST", key: "tax", width: 16 },
];

const signalColumns: Column[] = [
  { header: "Date", key: "eventDate", width: 14 },
  { header: "Record", key: "label", width: 50 },
  { header: "Amount", key: "amount", width: 16 },
  { header: "Reason", key: "reason", width: 50 },
  { header: "Recorded by", key: "actorName", width: 28 },
  { header: "Classification", key: "classification", width: 24 },
  { header: "Quantity", key: "quantity", width: 12 },
];

export const exportRouter = {
  invoiceRegisterXlsx: orgProcedure(
    { report: ["readFinancial"] },
    invoiceRegisterExportInput,
  ).handler(async ({ context, input }) => {
    const orgId = context.scope.orgId;
    const filter = registerFilter(orgId, input);

    const [rows, { totals, series }] = await Promise.all([
      registerRows(orgId, filter),
      registerSummary(orgId, filter),
    ]);

    return xlsxFile(periodFile("invoice-register", input), [
      {
        name: "Invoice register",
        columns: [
          { header: "Business date", key: "businessDate", width: 14 },
          { header: "Invoice number", key: "invoiceNumber", width: 22 },
          { header: "Stream", key: "stream", width: 12 },
          { header: "Fiscal year", key: "fiscalYear", width: 12 },
          { header: "Patient", key: "patientName", width: 28 },
          { header: "MRN", key: "patientMrn", width: 16 },
          ...registerMoneyColumns,
        ],
        rows: [
          ...rows.map(registerRow).map((row) => ({
            businessDate: row.businessDate,
            invoiceNumber: row.invoiceNumber,
            stream: row.stream,
            fiscalYear: row.fiscalYear,
            patientName: row.patientName ?? "Counter sale",
            patientMrn: row.patientMrn ?? "",
            ...Object.fromEntries(registerMoneyColumns.map(({ key }) => [key, rupees(row[key])])),
          })),
          {
            invoiceNumber: "Total",
            ...Object.fromEntries(
              registerMoneyColumns.map(({ key }) => [key, rupees(totals[key])]),
            ),
          },
        ],
      },
      {
        name: "Invoice series",
        columns: [
          { header: "Stream", key: "stream", width: 12 },
          { header: "Fiscal year", key: "fiscalYear", width: 12 },
          { header: "Count", key: "count", width: 10 },
          { header: "First number", key: "firstNumber", width: 22 },
          { header: "Last number", key: "lastNumber", width: 22 },
        ],
        rows: series.map((row) => ({
          stream: row.stream ?? "",
          fiscalYear: row.fiscalYear ?? "",
          count: row.count,
          firstNumber: row.firstNumber,
          lastNumber: row.lastNumber,
        })),
      },
    ]);
  }),

  revenueControlXlsx: orgProcedure(
    { report: ["readFinancial"] },
    revenueControlExportInput,
  ).handler(async ({ context, input }) => {
    // Checked before the fan-out, so a refused range starts no signal scans.
    assertValidPeriod(input.from, input.to, REVENUE_BOUND);
    const period = { orgSlug: input.orgSlug, from: input.from, to: input.to };
    const orgId = context.scope.orgId;
    const { timeZone } = await readOrgSettings(orgId);

    const [revenue, expiry, signals] = await Promise.all([
      call(reportRouter.revenueBreakdown, period, { context }),
      call(
        reportRouter.expiryExposure,
        { orgSlug: input.orgSlug, horizonDays: input.horizonDays },
        {
          context,
        },
      ),
      Promise.all(
        revenueSignalKind.options.map(async (kind) => ({
          kind,
          rows: await signalRows(signalSource(kind, orgId, input, timeZone)),
        })),
      ),
    ]);

    const revenueRows = (buckets: typeof revenue.byStream) =>
      [...buckets, revenue.totals].map((row) => ({
        label: row.label,
        issuedTaxableValue: rupees(row.issuedTaxableValue),
        creditedTaxableValue: rupees(row.creditedTaxableValue),
        netTaxableValue: rupees(row.netTaxableValue),
        tax: rupees(row.tax),
      }));

    return xlsxFile(periodFile("revenue-control", input), [
      { name: "Revenue by stream", columns: revenueColumns, rows: revenueRows(revenue.byStream) },
      {
        name: "Revenue by practitioner",
        columns: revenueColumns,
        rows: revenueRows(revenue.byPractitioner),
      },
      {
        name: "Revenue by category",
        columns: revenueColumns,
        rows: revenueRows(revenue.byCategory),
      },
      {
        name: "Correction bridge",
        columns: [
          { header: "Line", key: "label", width: 50 },
          { header: "Amount", key: "amount", width: 16 },
        ],
        rows: [
          {
            label: "Register net line value",
            amount: rupees(revenue.bridge.registerNetTaxableValue),
          },
          {
            label: "Less credits to older invoices",
            amount: rupees(revenue.bridge.creditsToOlderInvoices),
          },
          {
            label: "Plus later credits against period invoices",
            amount: rupees(revenue.bridge.laterCreditsAgainstPeriodInvoices),
          },
          { label: "Net billed revenue", amount: rupees(revenue.totals.netTaxableValue) },
        ],
      },
      ...signals.map(({ kind, rows }): Sheet => ({
        name: SIGNAL_SHEETS[kind],
        columns: signalColumns,
        rows: rows.map((row) => ({
          eventDate: row.eventDate,
          label: row.label,
          amount: row.amount === null ? "" : rupees(row.amount),
          reason: row.reason ?? "",
          actorName: row.actorName ?? "",
          classification: row.method
            ? PAYMENT_METHOD_LABELS[row.method]
            : (row.classification ?? ""),
          quantity: row.quantity ?? "",
        })),
      })),
      {
        name: "Expiry exposure",
        columns: [
          { header: "Product", key: "productName", width: 30 },
          { header: "Batch", key: "batchNumber", width: 18 },
          { header: "Expiry", key: "expiryDate", width: 14 },
          { header: "Status", key: "status", width: 12 },
          { header: "Bucket", key: "bucket", width: 12 },
          { header: "Quantity", key: "quantity", width: 12 },
          { header: "MRP exposure", key: "exposure", width: 16 },
        ],
        rows: expiry.rows.map((row) => ({ ...row, exposure: rupees(row.exposure) })),
      },
    ]);
  }),

  trialBalanceXlsx: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      const { rows, totals } = await call(reportRouter.trialBalance, input, { context });

      return xlsxFile(periodFile("trial-balance", input), [
        {
          name: "Trial balance",
          columns: [
            { header: "Code", key: "code", width: 14 },
            { header: "Account", key: "name", width: 32 },
            { header: "Type", key: "type", width: 14 },
            { header: "Opening debit", key: "openingDebit", width: 16 },
            { header: "Opening credit", key: "openingCredit", width: 16 },
            { header: "Debit", key: "debit", width: 16 },
            { header: "Credit", key: "credit", width: 16 },
            { header: "Closing debit", key: "closingDebit", width: 16 },
            { header: "Closing credit", key: "closingCredit", width: 16 },
          ],
          rows: [
            ...rows.map((row) => ({
              code: row.code,
              name: row.name,
              type: row.type,
              openingDebit: Number(row.openingDebit),
              openingCredit: Number(row.openingCredit),
              debit: Number(row.debit),
              credit: Number(row.credit),
              closingDebit: Number(row.closingDebit),
              closingCredit: Number(row.closingCredit),
            })),
            {
              code: "",
              name: "Total",
              type: "",
              openingDebit: Number(totals.openingDebit),
              openingCredit: Number(totals.openingCredit),
              debit: Number(totals.debit),
              credit: Number(totals.credit),
              closingDebit: Number(totals.closingDebit),
              closingCredit: Number(totals.closingCredit),
            },
          ],
        },
      ]);
    },
  ),

  balanceSheetXlsx: orgProcedure({ report: ["readFinancial"] }, asOfInput).handler(
    async ({ context, input }) => {
      const { assets, liabilities, equity, totals } = await call(reportRouter.balanceSheet, input, {
        context,
      });

      return xlsxFile(`billing-ledger-balance-sheet-${input.asOf}.xlsx`, [
        {
          name: "Assets",
          columns: [
            { header: "Code", key: "code", width: 14 },
            { header: "Account", key: "name", width: 34 },
            { header: "Balance", key: "balance", width: 18 },
          ],
          rows: [
            ...assets.map((row) => ({
              code: row.code,
              name: row.name,
              balance: Number(row.balance),
            })),
            { code: "", name: "Total assets", balance: Number(totals.assets) },
          ],
        },
        {
          name: "Liabilities and equity",
          columns: [
            { header: "Section", key: "section", width: 16 },
            { header: "Code", key: "code", width: 14 },
            { header: "Account", key: "name", width: 34 },
            { header: "Balance", key: "balance", width: 18 },
          ],
          rows: [
            ...liabilities.map((row) => ({
              section: "Liability",
              code: row.code,
              name: row.name,
              balance: Number(row.balance),
            })),
            ...equity.map((row) => ({
              section: "Equity",
              code: row.code,
              name: row.name,
              balance: Number(row.balance),
            })),
            {
              section: "",
              code: "",
              name: "Total liabilities and equity",
              balance: Number(totals.liabilitiesAndEquity),
            },
          ],
        },
      ]);
    },
  ),

  dailyCollectionsXlsx: orgProcedure({ report: ["readDailyCollections"] }, periodInput).handler(
    async ({ context, input }) => {
      const { rows, byMethod, totals } = await call(reportRouter.dailyCollections, input, {
        context,
      });

      return xlsxFile(periodFile("daily-collections", input), [
        {
          name: "Daily collections",
          columns: [
            { header: "Business date", key: "businessDate", width: 16 },
            ...byMethod.map(({ method }) => ({
              header: PAYMENT_METHOD_LABELS[method],
              key: method,
              width: 16,
            })),
            { header: "Payments", key: "payments", width: 16 },
            { header: "Advances", key: "advances", width: 16 },
            { header: "Refunds", key: "refunds", width: 16 },
            { header: "Advance refunds", key: "advanceRefunds", width: 18 },
            { header: "Net", key: "net", width: 16 },
          ],
          rows: rows.map((row) => ({
            businessDate: row.businessDate,
            ...Object.fromEntries(
              byMethod.map(({ method }) => [method, Number(row.byMethod[method])]),
            ),
            payments: Number(row.payments),
            advances: Number(row.advances),
            refunds: Number(row.refunds),
            advanceRefunds: Number(row.advanceRefunds),
            net: Number(row.net),
          })),
        },
        {
          name: "By method",
          columns: [
            { header: "Method", key: "method", width: 12 },
            { header: "Payments", key: "payments", width: 16 },
            { header: "Advances", key: "advances", width: 16 },
            { header: "Refunds", key: "refunds", width: 16 },
            { header: "Advance refunds", key: "advanceRefunds", width: 18 },
            { header: "Net", key: "net", width: 16 },
          ],
          rows: [
            ...byMethod.map((row) => ({
              method: PAYMENT_METHOD_LABELS[row.method],
              payments: Number(row.payments),
              advances: Number(row.advances),
              refunds: Number(row.refunds),
              advanceRefunds: Number(row.advanceRefunds),
              net: Number(row.net),
            })),
            {
              method: "Total",
              payments: Number(totals.payments),
              advances: Number(totals.advances),
              refunds: Number(totals.refunds),
              advanceRefunds: Number(totals.advanceRefunds),
              net: Number(totals.net),
            },
          ],
        },
      ]);
    },
  ),

  opdRegisterXlsx: orgProcedure({ report: ["readOpdRegister"] }, periodInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      await settleOpdRegister(scope, input);

      const [rows, totals, { currency, timeZone }] = await Promise.all([
        opdRegisterRows(scope.orgId, input),
        opdRegisterTotals(scope.orgId, input),
        readOrgSettings(scope.orgId),
      ]);

      const arrivedAt = new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      });

      return xlsxFile(periodFile("opd-register", input), [
        {
          name: "OPD register",
          columns: [
            { header: "Appointment ID", key: "appointmentId", width: 38 },
            { header: "Business date", key: "businessDate", width: 16 },
            { header: "Token", key: "tokenNumber", width: 10 },
            { header: "Patient", key: "patientName", width: 28 },
            { header: "MRN", key: "patientMrn", width: 16 },
            { header: "Caller", key: "callerName", width: 28 },
            { header: "Practitioner", key: "practitionerName", width: 24 },
            { header: "Department", key: "departmentName", width: 22 },
            { header: "Mode", key: "arrivalMode", width: 14 },
            { header: "Status", key: "status", width: 14 },
            { header: "Arrived at", key: "arrivedAt", width: 24 },
            { header: "Billed", key: "billed", width: 16 },
            { header: "Paid", key: "paid", width: 16 },
            { header: "Credits", key: "credits", width: 16 },
            { header: "Refunds", key: "refunds", width: 16 },
            { header: "Outstanding", key: "outstanding", width: 16 },
          ],
          rows: rows.map(opdRegisterRow).map((row) => ({
            appointmentId: row.appointmentId,
            businessDate: row.businessDate,
            tokenNumber: row.tokenNumber ?? "",
            patientName: row.patientName ?? "",
            patientMrn: row.patientMrn ?? "",
            callerName: row.callerName ?? "",
            practitionerName: practitionerDisplayName(row.practitionerName),
            departmentName: row.departmentName,
            arrivalMode: arrivalModeLabel(row.arrivalMode),
            status: OPD_STATUS_LABELS[row.status],
            arrivedAt: row.arrivedAt ? arrivedAt.format(new Date(row.arrivedAt)) : "",
            billed: rupees(row.billed),
            paid: rupees(row.paid),
            credits: rupees(row.credits),
            refunds: rupees(row.refunds),
            outstanding: rupees(row.outstanding),
          })),
        },
        {
          name: "Summary",
          columns: [
            { header: "Metric", key: "metric", width: 20 },
            { header: "Value", key: "value", width: 16 },
          ],
          rows: [
            { metric: "Currency", value: currency },
            { metric: "Appointments", value: totals.appointments },
            { metric: "Booked", value: totals.byStatus.booked },
            { metric: "Checked in", value: totals.byStatus.checked_in },
            { metric: "Cancelled", value: totals.byStatus.cancelled },
            { metric: "No show", value: totals.byStatus.no_show },
            { metric: "Billed", value: rupees(totals.billed) },
            { metric: "Paid", value: rupees(totals.paid) },
            { metric: "Credits", value: rupees(totals.credits) },
            { metric: "Refunds", value: rupees(totals.refunds) },
            { metric: "Outstanding", value: rupees(totals.outstanding) },
          ],
        },
      ]);
    },
  ),

  gstOutwardXlsx: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      const { documents, rateSummary, hsnSummary, totals } = await gstReport(
        context.scope.orgId,
        input,
      );

      return xlsxFile(periodFile("gst-outward-register", input), [
        {
          name: "Documents",
          columns: [
            { header: "Document type", key: "docType", width: 18 },
            { header: "Number", key: "number", width: 20 },
            { header: "Date", key: "date", width: 14 },
            { header: "Patient", key: "patientName", width: 28 },
            { header: "MRN", key: "patientMrn", width: 16 },
            { header: "Taxable value", key: "taxableValue", width: 17 },
            { header: "CGST", key: "cgst", width: 15 },
            { header: "SGST", key: "sgst", width: 15 },
            { header: "Tax amount", key: "taxAmount", width: 16 },
            { header: "Gross", key: "gross", width: 16 },
          ],
          rows: [
            ...documents.map((row) => ({
              docType: row.docType,
              number: row.number,
              date: row.date,
              patientName: row.patientName,
              patientMrn: row.patientMrn ?? "",
              taxableValue: Number(row.taxableValue),
              cgst: Number(row.cgst),
              sgst: Number(row.sgst),
              taxAmount: Number(row.taxAmount),
              gross: Number(row.gross),
            })),
            {
              docType: "",
              number: "Total",
              date: "",
              patientName: "",
              patientMrn: "",
              taxableValue: Number(totals.taxableValue),
              cgst: Number(totals.cgst),
              sgst: Number(totals.sgst),
              taxAmount: Number(totals.taxAmount),
              gross: Number(totals.gross),
            },
          ],
        },
        {
          name: "Rate summary",
          columns: [
            { header: "GST rate %", key: "taxRatePercent", width: 14 },
            { header: "Taxable value", key: "taxableValue", width: 17 },
            { header: "CGST", key: "cgst", width: 15 },
            { header: "SGST", key: "sgst", width: 15 },
            { header: "Tax amount", key: "taxAmount", width: 16 },
          ],
          rows: [
            ...rateSummary.map((row) => ({
              taxRatePercent: Number(row.taxRatePercent),
              taxableValue: Number(row.taxableValue),
              cgst: Number(row.cgst),
              sgst: Number(row.sgst),
              taxAmount: Number(row.taxAmount),
            })),
            {
              taxRatePercent: "Total",
              taxableValue: Number(totals.taxableValue),
              cgst: Number(totals.cgst),
              sgst: Number(totals.sgst),
              taxAmount: Number(totals.taxAmount),
            },
          ],
        },
        {
          name: "HSN summary",
          columns: [
            { header: "HSN/SAC", key: "taxCode", width: 18 },
            { header: "GST rate %", key: "taxRatePercent", width: 14 },
            { header: "Taxable value", key: "taxableValue", width: 17 },
            { header: "Tax amount", key: "taxAmount", width: 16 },
          ],
          rows: [
            ...hsnSummary.map((row) => ({
              taxCode: row.taxCode,
              taxRatePercent: Number(row.taxRatePercent),
              taxableValue: Number(row.taxableValue),
              taxAmount: Number(row.taxAmount),
            })),
            {
              taxCode: "Total",
              taxRatePercent: "",
              taxableValue: Number(totals.taxableValue),
              taxAmount: Number(totals.taxAmount),
            },
          ],
        },
      ]);
    },
  ),
};
