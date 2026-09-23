import {
  computeInvoiceLines,
  invoiceRoundingFor,
  type InvoiceRounding,
  type PriceBasis,
} from "@hms/api/lib/invoice-math";

export type WalkInQuote = {
  currency: string;
  lines: Array<{
    chargeId: string;
    source: "consultation" | "service";
    description: string;
    category: string;
    qty: number;
    priceUnits: number;
    unitPrice: bigint;
    taxRatePercent: string;
    taxCode: string | null;
    gross: bigint;
  }>;
  subtotal: bigint;
  rounding: InvoiceRounding;
  discountAmount: bigint;
  taxTotal: bigint;
  roundOff: bigint;
  grandTotal: bigint;
};

type LineMetadata = Pick<WalkInQuote["lines"][number], "category" | "source">;

function attachLineMetadata<T extends object>(
  lines: T[],
  sources: readonly LineMetadata[],
  missingSourceMessage: string,
): Array<T & LineMetadata> {
  return lines.map((line, index) => {
    const source = sources[index];

    if (!source) throw new Error(missingSourceMessage);

    return { ...line, category: source.category, source: source.source };
  });
}

/** `basis` is the quote's own tax treatment: pharmacy MRP is inclusive, services are not. */
export function applyDiscount(
  quote: WalkInQuote,
  discountAmount: bigint,
  basis: PriceBasis,
): WalkInQuote {
  const computed = computeInvoiceLines(
    quote.lines.map((line) => ({
      chargeId: line.chargeId,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      priceUnits: line.priceUnits,
      taxRatePercent: line.taxRatePercent,
      taxCode: line.taxCode,
    })),
    discountAmount,
    basis,
    quote.rounding,
  );

  return {
    ...quote,
    lines: attachLineMetadata(computed.lines, quote.lines, "Discounted line has no quoted line"),
    subtotal: computed.subtotal,
    discountAmount,
    taxTotal: computed.taxTotal,
    roundOff: computed.roundOff,
    grandTotal: computed.grandTotal,
  };
}

type PreviewService = {
  catalogItemId: string;
  name: string;
  category: string;
  unitPrice: bigint;
  taxRatePercent: string;
  qty: number;
};

export function servicePreview(services: PreviewService[], currency: string): WalkInQuote {
  const previewLines = services.map((service) => ({
    chargeId: service.catalogItemId,
    description: service.name,
    category: service.category,
    source: "service" as const,
    qty: service.qty,
    unitPrice: service.unitPrice,
    priceUnits: 1,
    taxRatePercent: service.taxRatePercent,
    taxCode: null,
  }));

  const rounding = invoiceRoundingFor("opd");
  const computed = computeInvoiceLines(previewLines, 0n, "exclusive", rounding);

  return {
    currency,
    lines: attachLineMetadata(
      computed.lines,
      previewLines,
      "Computed preview line has no source line",
    ),
    subtotal: computed.subtotal,
    rounding,
    discountAmount: 0n,
    taxTotal: computed.taxTotal,
    roundOff: computed.roundOff,
    grandTotal: computed.grandTotal,
  };
}
