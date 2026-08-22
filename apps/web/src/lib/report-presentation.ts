import { formatMoney } from "./money";

export function formatReportMoney(value: string, currency: string): string {
  return formatMoney(value, currency);
}

export function validateReportPeriod(
  from: string,
  to: string,
  maximumDays?: number,
): string | null {
  if (!from || !to) return "Choose both dates";
  if (from > to) return "From must be on or before To";

  if (maximumDays !== undefined) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days > maximumDays) return `Choose a range of ${maximumDays} days or less`;
  }

  return null;
}

function printCss(page: "A4 portrait" | "A4 landscape", margin: string): string {
  return `@media print {
    @page { size: ${page}; margin: ${margin}; }
    aside, nav { display: none !important; }
    main { padding: 0 !important; }
    body * { visibility: hidden !important; }
    [data-report-print], [data-report-print] * { visibility: visible !important; }
    [data-report-print] { position: static; width: 100%; padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  }`;
}

export const REPORT_PRINT_PORTRAIT_CSS = printCss("A4 portrait", "10mm");
export const REPORT_PRINT_LANDSCAPE_CSS = printCss("A4 landscape", "8mm");
