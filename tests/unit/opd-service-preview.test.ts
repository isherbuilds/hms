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
          unitPrice: "100.00",
          taxRatePercent: "18.00",
        },
      ],
      "INR",
    ),
  ).toMatchObject({
    currency: "INR",
    subtotal: "200.00",
    discountAmount: "0.00",
    taxTotal: "36.00",
    grandTotal: "236.00",
    lines: [
      {
        chargeId: "lab-cbc",
        source: "service",
        category: "lab",
        qty: 2,
        unitPrice: "100.00",
        taxAmount: "36.00",
        gross: "236.00",
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
        unitPrice: "100.00",
        taxRatePercent: "18.00",
      },
    ],
    "INR",
  );

  expect(applyDiscount(quote, "10")).toMatchObject({
    subtotal: "100.00",
    discountAmount: "10",
    taxTotal: "16.20",
    grandTotal: "106.20",
    lines: [{ allocatedDiscount: "10.00", taxableValue: "90.00", gross: "106.20" }],
  });
});
