const moneyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export function reportToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function reportDefaultRange(timeZone: string): { from: string; to: string } {
  const to = reportToday(timeZone);
  return { from: `${to.slice(0, 8)}01`, to };
}

export function formatReportMoney(value: string): string {
  return moneyFormatter.format(Number(value));
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
