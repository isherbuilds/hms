// What an issued Invoice prints, decided from its GSTIN snapshot, stream and lines (D052).
// An ipd Invoice can mix tax-exclusive services with MRP medicines, taxed or exempt, so its
// title, columns and tax rows come from its lines rather than from the stream alone.
import type { InvoiceStream, PriceBasis } from "@hms/api/lib/invoice-math";

type PrintedInvoice = { orgGstin: string; stream: InvoiceStream };

type RatedLine = { taxRatePercent: string };

type TaxedLine = RatedLine & {
  priceBasis: PriceBasis;
  taxableValue: bigint;
  taxAmount: bigint;
};

function isExempt(line: RatedLine): boolean {
  const rate = Number(line.taxRatePercent);

  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`Invalid GST rate on an invoice line: ${line.taxRatePercent}`);
  }

  return rate === 0;
}

export function invoiceDocumentTitle(invoice: PrintedInvoice, lines: RatedLine[]): string {
  if (!invoice.orgGstin) return "Invoice";

  switch (invoice.stream) {
    case "opd":
      return "Bill of Supply";
    case "pharmacy":
      return "Tax Invoice";
    case "ipd": {
      const exempt = lines.filter(isExempt).length;

      if (exempt === lines.length) return "Bill of Supply";

      return exempt === 0 ? "Tax Invoice" : "Invoice-cum-Bill of Supply";
    }
  }
}

export function invoiceTaxBreakdown(lines: TaxedLine[]) {
  const breakdown = { taxableValue: 0n, exemptValue: 0n, gstAdded: 0n, gstIncluded: 0n };

  for (const line of lines) {
    if (isExempt(line)) breakdown.exemptValue += line.taxableValue;
    else breakdown.taxableValue += line.taxableValue;

    if (line.priceBasis === "exclusive") breakdown.gstAdded += line.taxAmount;
    else breakdown.gstIncluded += line.taxAmount;
  }

  return breakdown;
}

/**
 * `licences`: print the drug licences, which an ipd document carries only with a
 * medicine (MRP) line; a document without lines at hand (a receipt) passes none.
 * `taxed`: print taxable value, rate and tax per line and the CGST/SGST summary.
 * `mixedLines`: lines may differ in price basis and exemption, so each line names its
 * basis, 0% prints as Exempt, and the totals separate taxable, exempt, added and MRP GST.
 */
export function invoicePrintParticulars(
  invoice: PrintedInvoice,
  lines: ReadonlyArray<{ priceBasis: PriceBasis }>,
) {
  const registered = Boolean(invoice.orgGstin);

  switch (invoice.stream) {
    case "opd":
      return { licences: false, taxed: false, mixedLines: false, priceHeading: "Unit" };
    case "pharmacy":
      return {
        licences: true,
        taxed: registered,
        mixedLines: false,
        priceHeading: registered ? "MRP (incl. GST)" : "MRP (incl. all taxes)",
      };
    case "ipd":
      return {
        licences: lines.some((line) => line.priceBasis === "inclusive"),
        taxed: registered,
        mixedLines: true,
        priceHeading: "Price",
      };
  }
}

/**
 * How a mixed-line price reads. GST is claimed only by a registered organization on a
 * taxed line (D052); an exempt line names its basis alone.
 */
export function linePriceBasis(
  registered: boolean,
  line: RatedLine & { priceBasis: PriceBasis },
): { label: string; suffix: string } {
  const claimsGst = registered && !isExempt(line);

  switch (line.priceBasis) {
    case "exclusive":
      return { label: "Rate", suffix: claimsGst ? "+ GST" : "" };
    case "inclusive":
      return { label: "MRP", suffix: claimsGst ? "incl. GST" : "" };
  }
}

export function mixedRateLabel(line: RatedLine): string {
  return isExempt(line) ? "Exempt" : `${line.taxRatePercent}%`;
}
