import { expect, test } from "bun:test";

import { applyDiscount, servicePreview } from "../../apps/web/src/lib/opd-service-preview";

test("selected services preview totals immediately and a discount updates tax and payable", () => {
  const quote = servicePreview(
    [
      {
        catalogItemId: "lab-cbc",
        name: "Complete blood count",
        category: "lab",
        qty: 2,
        unitPrice: 100_00n,
        taxRatePercent: "18.00",
      },
    ],
    "INR",
  );

  expect(quote).toMatchObject({
    currency: "INR",
    subtotal: 200_00n,
    discountAmount: 0n,
    taxTotal: 36_00n,
    roundOff: 0n,
    grandTotal: 236_00n,
    lines: [
      {
        chargeId: "lab-cbc",
        source: "service",
        category: "lab",
        qty: 2,
        unitPrice: 100_00n,
        priceUnits: 1,
        taxAmount: 36_00n,
        gross: 236_00n,
      },
    ],
  });

  expect(applyDiscount(quote, 10_00n, "opd")).toMatchObject({
    subtotal: 200_00n,
    discountAmount: 10_00n,
    taxTotal: 34_20n,
    roundOff: 0n,
    grandTotal: 224_20n,
    lines: [{ allocatedDiscount: 10_00n, taxableValue: 190_00n, gross: 224_20n }],
  });
});
