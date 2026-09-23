import { expect, test } from "bun:test";

import { MAX_STOCK_QTY } from "@hms/api/core/receipt-math";
import { stockQuantities, type ReceiptRowText } from "../../apps/web/src/lib/receipt-lines";

const row: ReceiptRowText = {
  unitsPerPack: 1,
  loose: true,
  count: "1",
  free: "0",
  rate: "0.01",
  discount: "50",
  gst: "0",
  price: "1.00",
};

test("receipt counts reject values outside the stock integer range", () => {
  for (const count of [String(MAX_STOCK_QTY + 1), "9".repeat(400)]) {
    expect(stockQuantities({ ...row, count })).toBeNull();
  }
});
