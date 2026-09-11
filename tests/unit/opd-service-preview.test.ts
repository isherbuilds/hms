import { expect, test } from "bun:test";

import { applyDiscount, servicePreview } from "../../apps/web/src/lib/opd-service-preview";

test("selected services produce an immediate client-side financial preview", () => {
  expect(
    servicePreview(
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
    ),
  ).toMatchObject({
    currency: "INR",
    subtotal: 200_00n,
    discountAmount: 0n,
    taxTotal: 36_00n,
    grandTotal: 236_00n,
    lines: [
      {
        chargeId: "lab-cbc",
        source: "service",
        category: "lab",
        qty: 2,
        unitPrice: 100_00n,
        taxAmount: 36_00n,
        gross: 236_00n,
      },
    ],
  });
});

test("a discount updates tax and payable locally from the trusted quote", () => {
  const quote = servicePreview(
    [
      {
        catalogItemId: "lab-cbc",
        name: "Complete blood count",
        category: "lab",
        qty: 1,
        unitPrice: 100_00n,
        taxRatePercent: "18.00",
      },
    ],
    "INR",
  );

  expect(applyDiscount(quote, 10_00n)).toMatchObject({
    subtotal: 100_00n,
    discountAmount: 10_00n,
    taxTotal: 16_20n,
    grandTotal: 106_20n,
    lines: [{ allocatedDiscount: 10_00n, taxableValue: 90_00n, gross: 106_20n }],
  });
});
