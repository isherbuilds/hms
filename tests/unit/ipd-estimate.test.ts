// Spec: docs/specs/ipd-admission-to-discharge.md — the pre-admission estimate is computed
// in the browser from the bed type's tariff, the expected days and the chosen Services,
// and printed with a suggested deposit. Nothing is stored.
import { expect, test } from "bun:test";

import { estimateStay } from "../../apps/web/src/lib/ipd-estimate";

const general = [
  { dailyPrice: 1_000_00n, taxRatePercent: "0.00" },
  { dailyPrice: 200_00n, taxRatePercent: "0.00" },
];

test("the estimate is every daily line for the expected days plus the chosen Services", () => {
  const estimate = estimateStay({
    days: 3,
    tariffLines: general,
    services: [
      { unitPrice: 6_000_00n, taxRatePercent: "0.00", qty: 1 },
      { unitPrice: 250_00n, taxRatePercent: "0.00", qty: 4 },
    ],
    registered: false,
  });

  expect(estimate).toEqual({
    bedCharges: 3_600_00n,
    services: 7_000_00n,
    tax: 0n,
    total: 10_600_00n,
    suggestedDeposit: 10_600_00n,
  });
});

test("a registered hospital's estimate adds each line's GST, rounded to the paisa", () => {
  const estimate = estimateStay({
    days: 2,
    tariffLines: [{ dailyPrice: 6_000_00n, taxRatePercent: "5.00" }],
    services: [{ unitPrice: 333_33n, taxRatePercent: "18.00", qty: 1 }],
    registered: true,
  });

  // 5% of 12,000.00 is 600.00; 18% of 333.33 is 59.9994, which rounds to 60.00.
  expect(estimate.bedCharges).toBe(12_000_00n);
  expect(estimate.services).toBe(333_33n);
  expect(estimate.tax).toBe(660_00n);
  expect(estimate.total).toBe(12_993_33n);
});

test("a hospital without a GSTIN adds no GST to the estimate", () => {
  const estimate = estimateStay({
    days: 2,
    tariffLines: [{ dailyPrice: 6_000_00n, taxRatePercent: "5.00" }],
    services: [],
    registered: false,
  });

  expect(estimate.tax).toBe(0n);
  expect(estimate.total).toBe(12_000_00n);
});

test("the suggested deposit is the estimate rounded up to the next hundred rupees", () => {
  const deposit = (unitPrice: bigint) =>
    estimateStay({
      days: 1,
      tariffLines: [{ dailyPrice: unitPrice, taxRatePercent: "0.00" }],
      services: [],
      registered: false,
    }).suggestedDeposit;

  expect(deposit(1_200_00n)).toBe(1_200_00n);
  expect(deposit(1_200_01n)).toBe(1_300_00n);
  expect(deposit(1_299_99n)).toBe(1_300_00n);
  expect(deposit(0n)).toBe(0n);
});
