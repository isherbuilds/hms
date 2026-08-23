import { toPaise } from "@hms/api/lib/invoice-math";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Mirrors the `packages/api` Zod money pattern, so forms reject what the API would. */
export const MONEY_INPUT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Form-boundary wrapper over the server's throwing parser: null for user typos. */
export function parseMoneyInput(value: string): number | null {
  return MONEY_INPUT_PATTERN.test(value) ? toPaise(value) : null;
}

/** Formats exact numeric values only at the presentation boundary. */
export function formatMoney(amount: string | number, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(amount));
}
