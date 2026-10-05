import { divideHalfUp, parseDecimal } from "./money";

// Amounts here are bigints in paise / EXACT_SCALE, not rounded paise. Only
// the final bill sum rounds to paise.
export const MAX_STOCK_QTY = 2_147_483_647;

export const EXACT_SCALE = 10n ** 8n;

/** A two-place percent below 100, such as `5`, `12.5` or `0`. */
export const PERCENT_PATTERN = /^\d{1,2}(\.\d{1,2})?$/;

/** Supplier-bill reconciliation permits a round-off difference of less than one rupee. */
const BILL_ROUND_OFF_LIMIT = 99n;

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

export const RECEIPT_ADJUSTMENT_KINDS = ["landed_charge", "invoice_discount"] as const;

/** A charge or discount printed apart from the stock lines, with its own GST, in paise. */
export type ReceiptAdjustment = {
  kind: (typeof RECEIPT_ADJUSTMENT_KINDS)[number];
  amount: bigint;
  gstAmount: bigint;
};

/** Charges add to the bill and discounts take away, each with its GST. */
export function adjustmentsTotal(adjustments: readonly ReceiptAdjustment[]): bigint {
  let total = 0n;

  for (const { kind, amount, gstAmount } of adjustments) {
    total += kind === "landed_charge" ? amount + gstAmount : -(amount + gstAmount);
  }

  return total;
}

/** A supplier bill may differ from its lines and adjustments by less than one rupee. */
export function billMatches(roundOff: bigint): boolean {
  return roundOff <= BILL_ROUND_OFF_LIMIT && roundOff >= -BILL_ROUND_OFF_LIMIT;
}
