import { DECIMAL_PATTERN, divideHalfUp, parseDecimal } from "@hms/api/core/money";
import {
  BILL_ROUND_OFF_LIMIT,
  EXACT_SCALE,
  MAX_STOCK_QTY,
  PERCENT_PATTERN,
  type ReceiptCost,
  exactToPaise,
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

export function wholeCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;

  const count = Number(value);

  return Number.isSafeInteger(count) && count <= MAX_STOCK_QTY ? count : null;
}

/** Counts typed in packs or loose units, as stock units. */
export function stockQuantities(row: ReceiptRowText, opening = false) {
  const count = wholeCount(row.count);
  const free = opening || row.free.trim() === "" ? 0 : wholeCount(row.free);
  const packSize = packSizeOf(row);

  if (count === null || free === null || !Number.isSafeInteger(packSize) || packSize < 1) {
    return null;
  }

  const qty = count * packSize;
  const freeQty = free * packSize;

  if (qty > MAX_STOCK_QTY || freeQty > MAX_STOCK_QTY || qty + freeQty > MAX_STOCK_QTY) {
    return null;
  }

  return { qty, freeQty, packSize };
}

/** The line's exact bill arithmetic once every figure it needs is typed; otherwise null. */
export function rowCost(row: ReceiptRowText): ReceiptCost | null {
  const quantities = stockQuantities(row);

  if (
    !quantities ||
    quantities.qty === 0 ||
    !DECIMAL_PATTERN.test(row.rate) ||
    !PERCENT_PATTERN.test(row.discount) ||
    !PERCENT_PATTERN.test(row.gst)
  ) {
    return null;
  }

  return receiptLineCost({
    ...quantities,
    rate: parseDecimal(row.rate),
    discountPercent: row.discount,
    gstPercent: row.gst,
  });
}

/** Compare exact unit costs without rounding either the printed MRP or the net. */
export function costAtOrAboveMrp(row: ReceiptRowText, cost: ReceiptCost | null) {
  const quantities = stockQuantities(row);

  return (
    cost !== null &&
    quantities !== null &&
    DECIMAL_PATTERN.test(row.price) &&
    cost.net * BigInt(quantities.packSize) >=
      parseDecimal(row.price) * EXACT_SCALE * BigInt(quantities.qty + quantities.freeQty)
  );
}

/** Approximate paise per stock unit for display only; never used for billing or storage. */
export function approximateUnitCost(row: ReceiptRowText, cost: ReceiptCost): bigint | null {
  const quantities = stockQuantities(row);

  if (!quantities || quantities.qty + quantities.freeQty === 0) return null;

  return divideHalfUp(cost.net, EXACT_SCALE * BigInt(quantities.qty + quantities.freeQty));
}

/** Allocate the once-rounded receipt total across rows so displayed lines reconcile. */
export function allocateReceiptLineTotals(
  rows: readonly ReceiptRowText[],
): Array<bigint | null> {
  const lines = rows.map((row, index) => {
    const cost = rowCost(row);

    return cost
      ? {
          index,
          exact: cost.net,
          paise: cost.net / EXACT_SCALE,
          remainder: cost.net % EXACT_SCALE,
        }
      : null;
  });
  const valid = lines.filter((line) => line !== null);
  const rounded = exactToPaise(valid.reduce((sum, line) => sum + line.exact, 0n));
  let remainder = rounded - valid.reduce((sum, line) => sum + line.paise, 0n);

  const ranked = [...valid].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );

  for (const line of ranked) {
    if (remainder === 0n) break;
    line.paise += 1n;
    remainder -= 1n;
  }

  return lines.map((line) => line?.paise ?? null);
}

export type BillSummary = {
  /** Exact amounts, in paise/EXACT_SCALE. */
  taxable: bigint;
  gst: bigint;
  /** Rounded once after summing every exact line net. */
  net: bigint;
  /** Every line priced, so `net` is the whole bill. */
  complete: boolean;
  /** Bill total minus the lines; null until both are known. */
  roundOff: bigint | null;
  matches: boolean;
};

export function billSummary(rows: readonly ReceiptRowText[], billTotal: string): BillSummary {
  let taxable = 0n;
  let gst = 0n;
  let exactNet = 0n;
  let complete = rows.length > 0;

  for (const row of rows) {
    const cost = rowCost(row);

    if (!cost) {
      complete = false;
      continue;
    }

    taxable += cost.taxable;
    gst += cost.gst;
    exactNet += cost.net;
  }

  const net = exactToPaise(exactNet);

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
