import { expect, test } from "bun:test";

import {
  billSummary,
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

test("pack counts convert billed and free quantities into stock units within the integer range", () => {
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

test("freight adds to the lines and a discount takes away; a one-rupee residual is refused", () => {
  const stock: ReceiptRowText = { ...row, count: "1", rate: "3725.00", discount: "0", gst: "12" };

  const freight = {
    kind: "landed_charge" as const,
    reason: "Freight",
    amount: "270.00",
    gstAmount: "48.60",
  };

  const discount = {
    kind: "invoice_discount" as const,
    reason: "Cash discount",
    amount: "100.00",
    gstAmount: "0.00",
  };

  expect(billSummary([stock], "4491.00", [freight])).toMatchObject({
    net: 4172_00n,
    adjustments: 318_60n,
    roundOff: 40n,
    matches: true,
  });
  expect(billSummary([stock], "4391.00", [freight, discount])).toMatchObject({
    adjustments: 218_60n,
    roundOff: 40n,
    matches: true,
  });
  expect(billSummary([stock], "4491.60", [freight])).toMatchObject({
    roundOff: 100n,
    matches: false,
  });
  expect(billSummary([stock], "4491.00", [{ ...freight, amount: "-270" }]).complete).toBe(false);
});
