import { divideHalfUp, parseDecimal } from "@hms/api/core/money";

// The suggested deposit rounds the estimate up to the next ₹100 (in paise), a default
// chosen without a hospital.
const DEPOSIT_STEP = 10_000n;

/**
 * A pre-admission estimate, computed in the browser and stored nowhere: every daily
 * line of the bed type's tariff for the expected days, plus the chosen Services. Tax is
 * per line, rounded half up to the paisa; without a GSTIN no GST is added (D063).
 */
export function estimateStay(input: {
  days: number;
  tariffLines: { dailyPrice: bigint; taxRatePercent: string }[];
  services: { unitPrice: bigint; taxRatePercent: string; qty: number }[];
  registered: boolean;
}) {
  type Line = { amount: bigint; taxRatePercent: string };

  const days = BigInt(input.days);

  const sum = (lines: Line[], of: (line: Line) => bigint) =>
    lines.reduce((total, line) => total + of(line), 0n);

  const tariff = input.tariffLines.map((line) => ({
    amount: line.dailyPrice * days,
    taxRatePercent: line.taxRatePercent,
  }));

  const chosen = input.services.map((line) => ({
    amount: line.unitPrice * BigInt(line.qty),
    taxRatePercent: line.taxRatePercent,
  }));

  const bedCharges = sum(tariff, (line) => line.amount);
  const services = sum(chosen, (line) => line.amount);

  const tax = input.registered
    ? sum([...tariff, ...chosen], (line) =>
        divideHalfUp(line.amount * parseDecimal(line.taxRatePercent), 10_000n),
      )
    : 0n;

  const total = bedCharges + services + tax;

  return {
    bedCharges,
    services,
    tax,
    total,
    suggestedDeposit: ((total + DEPOSIT_STEP - 1n) / DEPOSIT_STEP) * DEPOSIT_STEP,
  };
}
