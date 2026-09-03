import { fromPaise, toPaise, toSignedPaise } from "@hms/api/lib/invoice-math";
import { MONEY_PATTERN } from "@hms/api/lib/schemas";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Uses the API money pattern, so forms reject what the API would. */
export const MONEY_INPUT_PATTERN = MONEY_PATTERN;

/** Form-boundary wrapper over the server's throwing parser: null for user typos. */
export function parseMoneyInput(value: string): number | null {
  return MONEY_INPUT_PATTERN.test(value) ? toPaise(value) : null;
}

export function formatMoney(amount: string, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  const exactAmount = fromPaise(toSignedPaise(amount));
  // Intl accepts decimal strings without first rounding through a binary float. The
  // project's current TypeScript lib target still exposes only the older number overload.
  return (formatter.format as unknown as (value: string) => string)(exactAmount);
}
