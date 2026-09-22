import { divideHalfUp, parseDecimal } from "./money";

// One supplier-bill line, in the unit the bill prices: `packSize` stock units per priced
// unit (1 when the bill prices loose units). Shared by the receive page and the server so
// the figures a pharmacist checks are the figures stored.

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

export type ReceiptCost = {
  gross: bigint;
  discount: bigint;
  taxable: bigint;
  gst: bigint;
  net: bigint;
  /** Net paise per stock unit received, free units included. GST is a cost: see spec. */
  unitCost: bigint;
};

export function receiptLineCost(line: ReceiptCostInput): ReceiptCost {
  const gross = (BigInt(line.qty) * line.rate) / BigInt(line.packSize);
  const discount = divideHalfUp(gross * parseDecimal(line.discountPercent), 100_00n);
  const taxable = gross - discount;
  const gst = divideHalfUp(taxable * parseDecimal(line.gstPercent), 100_00n);
  const net = taxable + gst;

  return {
    gross,
    discount,
    taxable,
    gst,
    net,
    unitCost: divideHalfUp(net, BigInt(line.qty + line.freeQty)),
  };
}
