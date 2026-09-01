import { computeInvoiceLines } from "@hms/api/lib/invoice-math";

export type WalkInQuote = {
  currency: string;
  lines: Array<{
    chargeId: string;
    source: "consultation" | "service";
    description: string;
    category: string;
    qty: number;
    unitPrice: string;
    taxRatePercent: string;
    taxCode: string | null;
    gross: string;
  }>;
  subtotal: string;
  discountAmount: string;
  taxTotal: string;
  grandTotal: string;
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

export function applyDiscount(quote: WalkInQuote, discountAmount: string): WalkInQuote {
  const computed = computeInvoiceLines(
    quote.lines.map((line) => ({
      chargeId: line.chargeId,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      taxRatePercent: line.taxRatePercent,
      taxCode: line.taxCode,
    })),
    discountAmount,
  );

  return {
    ...quote,
    lines: attachLineMetadata(computed.lines, quote.lines, "Discounted line has no quoted line"),
    subtotal: computed.subtotal,
    discountAmount,
    taxTotal: computed.taxTotal,
    grandTotal: computed.grandTotal,
  };
}

type PreviewService = {
  catalogItemId: string;
  name: string;
  category: string;
  unitPrice: string;
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
    taxRatePercent: service.taxRatePercent,
    taxCode: null,
  }));
  const computed = computeInvoiceLines(previewLines, "0");

  return {
    currency,
    lines: attachLineMetadata(
      computed.lines,
      previewLines,
      "Computed preview line has no source line",
    ),
    subtotal: computed.subtotal,
    discountAmount: "0.00",
    taxTotal: computed.taxTotal,
    grandTotal: computed.grandTotal,
  };
}
