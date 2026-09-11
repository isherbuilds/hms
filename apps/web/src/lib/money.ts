import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";

// The oxc React Compiler turns bigint literals in components into `undefined`; import ZERO instead.
export const ZERO = 0n;

export function parseMoneyInput(value: string): bigint | null {
  return DECIMAL_PATTERN.test(value) ? parseDecimal(value) : null;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(paise: bigint, currency: string): string {
  let formatter = moneyFormatters.get(currency);

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }

  // SAFETY: Intl accepts decimal strings; the current TS lib types only the number overload.
  const format = formatter.format as (value: number | bigint | string) => string;

  return format(formatDecimal(paise));
}
