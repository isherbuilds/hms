import { expect, test } from "bun:test";

import { MAX_STOCK_QTY } from "@hms/api/core/receipt-math";
import {
  costAtOrAboveMrp,
  rowCost,
  stockQuantities,
  type ReceiptRowText,
} from "../../apps/web/src/lib/receipt-lines";

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

test("pack counts convert both billed and free quantities into stock units", () => {
  expect(
    stockQuantities({ ...row, unitsPerPack: 10, loose: false, count: "5", free: "2" }),
  ).toEqual({
    qty: 50,
    freeQty: 20,
    packSize: 10,
  });
  expect(stockQuantities({ ...row, unitsPerPack: 10, loose: true, count: "4", free: "1" })).toEqual(
    {
      qty: 4,
      freeQty: 1,
      packSize: 1,
    },
  );
});

test("receipt cost compares to printed pack MRP without rounding a fractional paise", () => {
  const discounted = {
    ...row,
    unitsPerPack: 3,
    loose: false,
    rate: "0.01",
    discount: "1",
    price: "0.01",
  };

  expect(costAtOrAboveMrp(discounted, rowCost(discounted))).toBe(false);
  expect(
    costAtOrAboveMrp({ ...discounted, discount: "0" }, rowCost({ ...discounted, discount: "0" })),
  ).toBe(true);
});
