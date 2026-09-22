import { DECIMAL_PATTERN, divideHalfUp, parseDecimal } from "@hms/api/core/money";
import {
  BILL_ROUND_OFF_LIMIT,
  PERCENT_PATTERN,
  type ReceiptCost,
  receiptLineCost,
} from "@hms/api/core/receipt-math";

// Bigint arithmetic for the receive page lives here: the React Compiler drops bigint
// literals inside components.

/** A receipt row as typed: counts and prices in the bill's unit, pack or loose. */
export type ReceiptRowText = {
  unitsPerPack: number;
  loose: boolean;
  count: string;
  free: string;
  rate: string;
  discount: string;
  gst: string;
  price: string;
};

/** Stock units one counted unit holds: the pack, or 1 when counting loose. */
export function packSizeOf(row: Pick<ReceiptRowText, "unitsPerPack" | "loose">) {
  return row.loose || row.unitsPerPack === 1 ? 1 : row.unitsPerPack;
}

function wholeCount(value: string) {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

/** MRP per stock unit from the printed MRP of the counted unit. */
export function mrpPerUnit(row: ReceiptRowText): bigint | null {
  if (!DECIMAL_PATTERN.test(row.price)) return null;

  return divideHalfUp(parseDecimal(row.price), BigInt(packSizeOf(row)));
}

/** The line's bill arithmetic once every figure it needs is typed; otherwise null. */
export function rowCost(row: ReceiptRowText): ReceiptCost | null {
  const count = wholeCount(row.count);
  const free = row.free.trim() === "" ? 0 : wholeCount(row.free);

  if (
    !count ||
    free === null ||
    !DECIMAL_PATTERN.test(row.rate) ||
    !PERCENT_PATTERN.test(row.discount) ||
    !PERCENT_PATTERN.test(row.gst)
  ) {
    return null;
  }

  const packSize = packSizeOf(row);

  return receiptLineCost({
    qty: count * packSize,
    freeQty: free * packSize,
    packSize,
    rate: parseDecimal(row.rate),
    discountPercent: row.discount,
    gstPercent: row.gst,
  });
}

/** True when a unit costs at least what it may be sold for. */
export function costAtOrAboveMrp(row: ReceiptRowText, cost: ReceiptCost | null) {
  const mrp = mrpPerUnit(row);

  return cost !== null && mrp !== null && cost.unitCost >= mrp;
}

export type BillSummary = {
  taxable: bigint;
  gst: bigint;
  net: bigint;
  /** Every line priced, so `net` is the whole bill. */
  complete: boolean;
  /** Bill total minus the lines; null until both are known. */
  roundOff: bigint | null;
  matches: boolean;
};

export function billSummary(rows: readonly ReceiptRowText[], billTotal: string): BillSummary {
  let taxable = BigInt(0);
  let gst = BigInt(0);
  let net = BigInt(0);
  let complete = rows.length > 0;

  for (const row of rows) {
    const cost = rowCost(row);

    if (!cost) {
      complete = false;
      continue;
    }

    taxable += cost.taxable;
    gst += cost.gst;
    net += cost.net;
  }

  const roundOff =
    complete && DECIMAL_PATTERN.test(billTotal) ? parseDecimal(billTotal) - net : null;

  return {
    taxable,
    gst,
    net,
    complete,
    roundOff,
    matches:
      roundOff !== null && roundOff <= BILL_ROUND_OFF_LIMIT && roundOff >= -BILL_ROUND_OFF_LIMIT,
  };
}
