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
    lines: computed.lines.map((line, index) => {
      const quoted = quote.lines[index];
      if (!quoted) throw new Error("Discounted line has no quoted line");
      return { ...line, category: quoted.category, source: quoted.source };
    }),
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
  const computed = computeInvoiceLines(
    services.map((service) => ({
      chargeId: service.catalogItemId,
      description: service.name,
      qty: service.qty,
      unitPrice: service.unitPrice,
      taxRatePercent: service.taxRatePercent,
      taxCode: null,
    })),
    "0",
  );

  return {
    currency,
    lines: computed.lines.map((line, index) => {
      const service = services[index];
      if (!service) throw new Error("Computed preview line has no selected service");
      return { ...line, category: service.category, source: "service" as const };
    }),
    subtotal: computed.subtotal,
    discountAmount: "0.00",
    taxTotal: computed.taxTotal,
    grandTotal: computed.grandTotal,
  };
}
