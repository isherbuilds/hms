import { computeInvoiceLines } from "@hms/api/lib/invoice-math";

// The suggested deposit rounds the estimate up to the next ₹100 (in paise), a default
// chosen without a hospital.
const DEPOSIT_STEP = 10_000n;

/**
 * A pre-admission estimate, computed in the browser and stored nowhere: every daily
 * line of the bed type's tariff for the expected days, plus the chosen Services, priced
 * by the bill's own line math. Without a GSTIN no GST is added (D063).
 */
export function estimateStay(input: {
  days: number;
  tariffLines: { dailyPrice: bigint; taxRatePercent: string }[];
  services: { unitPrice: bigint; taxRatePercent: string; qty: number }[];
  registered: boolean;
}) {
  const line = (
    kind: "bed" | "service",
    qty: number,
    unitPrice: bigint,
    taxRatePercent: string,
  ) => ({
    chargeId: kind,
    description: kind,
    qty,
    unitPrice,
    priceUnits: 1,
    taxRatePercent: input.registered ? taxRatePercent : "0",
    taxCode: null,
    priceBasis: "exclusive" as const,
  });

  const priced = computeInvoiceLines(
    [
      ...input.tariffLines.map((tariff) =>
        line("bed", input.days, tariff.dailyPrice, tariff.taxRatePercent),
      ),
      ...input.services.map((service) =>
        line("service", service.qty, service.unitPrice, service.taxRatePercent),
      ),
    ],
    0n,
    { roundToRupee: false },
  );

  const subtotal = (kind: "bed" | "service") =>
    priced.lines
      .filter((each) => each.chargeId === kind)
      .reduce((total, each) => total + each.lineSubtotal, 0n);

  const total = priced.grandTotal;

  return {
    bedCharges: subtotal("bed"),
    services: subtotal("service"),
    tax: priced.taxTotal,
    total,
    suggestedDeposit: ((total + DEPOSIT_STEP - 1n) / DEPOSIT_STEP) * DEPOSIT_STEP,
  };
}
