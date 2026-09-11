import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";

// The oxc React Compiler rewrites a bigint literal such as `0n` inside a component
// to `undefined`, so components compare against this import and `.tsx` files carry
// no bigint literals at all.
export const ZERO = 0n;

/** Form boundary over the throwing parser: null for a typo. */
export function parseMoneyInput(value: string): bigint | null {
  return DECIMAL_PATTERN.test(value) ? parseDecimal(value) : null;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Paise as currency text, for example ₹1,234.50. */
export function formatMoney(paise: bigint, currency: string): string {
  let formatter = moneyFormatters.get(currency);

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }

  // Intl accepts decimal strings without first rounding through a binary float. The
  // project's current TypeScript lib target still exposes only the older number overload.
  return (formatter.format as unknown as (value: string) => string)(formatDecimal(paise));
}
