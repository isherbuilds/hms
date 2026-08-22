const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Decimal money accepted at form boundaries before the server parses it. */
export const MONEY_INPUT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Formats exact numeric values only at the presentation boundary. */
export function formatMoney(amount: string | number, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(amount));
}
