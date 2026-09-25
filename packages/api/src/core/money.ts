// Money is integer paise (`bigint`) in every column, calculation, and RPC value; the
// RPC link carries bigint natively. Decimal rupee strings exist only where a person
// reads or types them: form inputs, PDF cells, audit meta, error text.

/** Non-negative rupees with at most two places: the only text shape ever parsed. */
export const DECIMAL_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

/** `"12.3"` → `1230n`. Also scales a two-place percent such as `"18.00"` to `1800n`. */
export function parseDecimal(value: string): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new RangeError(`Invalid decimal value: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");

  return BigInt(whole + fraction.padEnd(2, "0"));
}

/** `-50n` → `"-0.50"`. */
export function formatDecimal(paise: bigint): string {
  const sign = paise < 0n ? "-" : "";
  const absolute = paise < 0n ? -paise : paise;

  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

/** Half-up integer division for allocations and tax; denominator must be positive. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Division denominator must be positive");
  }

  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/**
 * One sitting's share of what a course has left to bill, in figures the desk can collect:
 * ₹1,000 and above to the nearest ₹100, smaller shares to the rupee, so a ₹150 session
 * stays ₹150. The last estimated sitting takes the exact rest.
 */
export function sittingShare(unbilled: bigint, sittingsLeft: number): bigint {
  if (sittingsLeft <= 1) return unbilled;

  const sittings = BigInt(sittingsLeft);
  const step = unbilled >= 1000_00n * sittings ? 100_00n : 100n;

  return divideHalfUp(unbilled, sittings * step) * step;
}
