import { divideHalfUp, parseDecimal } from "./money";

// Amounts here are bigints in paise / EXACT_SCALE, not rounded paise. Each billed
// quantity is a whole number of priced units; only the final bill sum rounds to paise.
export const EXACT_SCALE = 10n ** 8n;

/** A two-place percent below 100, such as `5`, `12.5` or `0`. */
export const PERCENT_PATTERN = /^\d{1,2}(\.\d{1,2})?$/;

/** Supplier bills round the grand total to the rupee, so up to 99 paise may differ. */
export const BILL_ROUND_OFF_LIMIT = 99n;

export type ReceiptCostInput = {
  /** Billed stock units; free units are extra. */
  qty: number;
  freeQty: number;
  packSize: number;
  /** Paise per `packSize` stock units, before discount and GST (PTR). */
  rate: bigint;
  discountPercent: string;
  gstPercent: string;
};

/** Every amount is exact in paise / EXACT_SCALE; no per-line or per-unit rounding. */
export type ReceiptCost = {
  taxable: bigint;
  gst: bigint;
  net: bigint;
};

export function receiptLineCost(line: ReceiptCostInput): ReceiptCost {
  const gross = (BigInt(line.qty) / BigInt(line.packSize)) * line.rate * EXACT_SCALE;
  const discount = (gross * parseDecimal(line.discountPercent)) / 100_00n;
  const taxable = gross - discount;
  const gst = (taxable * parseDecimal(line.gstPercent)) / 100_00n;
  const net = taxable + gst;

  return { taxable, gst, net };
}

/** Round an exact document sum once, half-up, to integer paise. */
export function exactToPaise(exact: bigint): bigint {
  return divideHalfUp(exact, EXACT_SCALE);
}
