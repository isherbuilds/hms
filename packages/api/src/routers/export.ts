import { call } from "@orpc/server";
import { writeXlsx } from "hucre/xlsx";

import {
  arrivalModeLabel,
  OPD_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  practitionerDisplayName,
} from "../lib/labels";
import { orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import { asOfInput, periodInput, reportRouter } from "./report";

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

export const exportRouter = {
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
      const report = await call(reportRouter.opdRegister, input, { context });
      const { currency, timeZone } = await readOrgSettings(context.scope.orgId);

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
          rows: report.rows.map((row) => ({
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
            { metric: "Appointments", value: report.totals.appointments },
            { metric: "Booked", value: report.totals.byStatus.booked },
            { metric: "Checked in", value: report.totals.byStatus.checked_in },
            { metric: "Cancelled", value: report.totals.byStatus.cancelled },
            { metric: "No show", value: report.totals.byStatus.no_show },
            { metric: "Billed", value: rupees(report.totals.billed) },
            { metric: "Paid", value: rupees(report.totals.paid) },
            { metric: "Credits", value: rupees(report.totals.credits) },
            { metric: "Refunds", value: rupees(report.totals.refunds) },
            { metric: "Outstanding", value: rupees(report.totals.outstanding) },
          ],
        },
      ]);
    },
  ),

  gstOutwardXlsx: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      const { documents, rateSummary, hsnSummary, totals } = await call(reportRouter.gst, input, {
        context,
      });

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
