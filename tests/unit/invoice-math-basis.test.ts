// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 1 — per-line price basis (D025 amendment).
import { expect, test } from "bun:test";

import { parseDecimal } from "@hms/api/core/money";
import { computeInvoiceLines } from "@hms/api/lib/invoice-math";

import { sumMoney } from "../support/unique";

type PriceBasis = "exclusive" | "inclusive";

const charge = (
  chargeId: string,
  unitPrice: string,
  taxRatePercent: string,
  priceBasis: PriceBasis,
  qty = 1,
  priceUnits = 1,
) => ({
  chargeId,
  description: `Charge ${chargeId}`,
  qty,
  unitPrice: parseDecimal(unitPrice),
  priceUnits,
  taxRatePercent,
  taxCode: null,
  priceBasis,
});

const NO_ROUNDING = { roundToRupee: false };

const COUNTER_ROUNDING = { roundToRupee: true };

type Quote = ReturnType<typeof computeInvoiceLines>;

function amounts(result: Quote) {
  return [
    result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross]),
    [result.subtotal, result.taxTotal, result.grandTotal],
  ];
}

function expectHeaderSums(result: Quote) {
  expect(result.subtotal).toBe(sumMoney(result.lines.map((line) => line.lineSubtotal)));
  expect(result.taxTotal).toBe(sumMoney(result.lines.map((line) => line.taxAmount)));
  expect(result.grandTotal).toBe(
    sumMoney(result.lines.map((line) => line.gross)) + result.roundOff,
  );
}

test("all-exclusive lines reproduce today's OPD results", () => {
  const single = computeInvoiceLines(
    [charge("consult", "100.00", "18.00", "exclusive", 2)],
    0n,
    NO_ROUNDING,
  );

  expect(single).toMatchObject({
    lines: [
      {
        chargeId: "consult",
        qty: 2,
        unitPrice: 10_000n,
        priceUnits: 1,
        lineSubtotal: 20_000n,
        allocatedDiscount: 0n,
        taxableValue: 20_000n,
        taxRatePercent: "18.00",
        taxAmount: 3_600n,
        gross: 23_600n,
      },
    ],
    subtotal: 20_000n,
    taxTotal: 3_600n,
    roundOff: 0n,
    grandTotal: 23_600n,
  });

  const rates = computeInvoiceLines(
    [
      charge("zero", "10.00", "0", "exclusive"),
      charge("five", "2.50", "5", "exclusive"),
      charge("twelve", "10.00", "12", "exclusive"),
      charge("eighteen", "10.00", "18", "exclusive"),
    ],
    0n,
    NO_ROUNDING,
  );

  expect(rates.lines.map((line) => line.taxAmount)).toEqual([0n, 13n, 120n, 180n]);
  expect(rates.taxTotal).toBe(313n);
  expect(rates.grandTotal).toBe(3_563n);
});

test("all-inclusive lines with rupee rounding reproduce today's counter Pharmacy results", () => {
  expect(
    amounts(
      computeInvoiceLines([charge("mrp", "112.00", "12", "inclusive")], 1_200n, COUNTER_ROUNDING),
    ),
  ).toEqual([[[8_929n, 1_071n, 10_000n]], [11_200n, 1_071n, 10_000n]]);

  const split = computeInvoiceLines(
    [charge("twelve", "112.00", "12", "inclusive"), charge("five", "105.00", "5", "inclusive")],
    1_000n,
    COUNTER_ROUNDING,
  );

  expect(split.lines.map((line) => line.allocatedDiscount)).toEqual([516n, 484n]);
  expect(amounts(split)).toEqual([
    [
      [9_539n, 1_145n, 10_684n],
      [9_539n, 477n, 10_016n],
    ],
    [21_700n, 1_622n, 20_700n],
  ]);

  const rounded = computeInvoiceLines(
    [charge("a", "122.86", "12", "inclusive")],
    0n,
    COUNTER_ROUNDING,
  );

  expect([rounded.subtotal, rounded.roundOff, rounded.grandTotal]).toEqual([12_286n, 14n, 12_300n]);

  const half = computeInvoiceLines([charge("b", "122.50", "0", "inclusive")], 0n, COUNTER_ROUNDING);
  expect([half.roundOff, half.grandTotal]).toEqual([50n, 12_300n]);
});

test("mixed lines add tax to the exclusive service and extract it from the inclusive medicines", () => {
  const result = computeInvoiceLines(
    [
      charge("service", "6000.00", "5", "exclusive"),
      charge("bundled", "112.00", "0", "inclusive", 2),
      charge("independent", "112.00", "12", "inclusive"),
    ],
    0n,
    NO_ROUNDING,
  );

  expect(
    result.lines.map((line) => [line.lineSubtotal, line.taxableValue, line.taxAmount, line.gross]),
  ).toEqual([
    [600_000n, 600_000n, 30_000n, 630_000n],
    [22_400n, 22_400n, 0n, 22_400n],
    [11_200n, 10_000n, 1_200n, 11_200n],
  ]);
  expect([result.subtotal, result.taxTotal, result.roundOff, result.grandTotal]).toEqual([
    633_600n,
    31_200n,
    0n,
    663_600n,
  ]);
  expectHeaderSums(result);
});

test("without rupee rounding an inclusive total keeps its paise", () => {
  const inclusive = computeInvoiceLines(
    [charge("a", "122.86", "12", "inclusive")],
    0n,
    NO_ROUNDING,
  );

  expect([inclusive.subtotal, inclusive.roundOff, inclusive.grandTotal]).toEqual([
    12_286n,
    0n,
    12_286n,
  ]);

  const loose = computeInvoiceLines(
    [charge("strip", "112.00", "12", "inclusive", 4, 10)],
    0n,
    NO_ROUNDING,
  );

  expect(amounts(loose)).toEqual([[[4_000n, 480n, 4_480n]], [4_480n, 480n, 4_480n]]);
  expect(loose.roundOff).toBe(0n);
});

test("a discount across mixed lines is allocated exactly and the grand total stays the sum of gross", () => {
  const result = computeInvoiceLines(
    [charge("service", "100.00", "18", "exclusive"), charge("mrp", "112.00", "12", "inclusive")],
    1_000n,
    NO_ROUNDING,
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual([472n, 528n]);
  expect(amounts(result)).toEqual([
    [
      [9_528n, 1_715n, 11_243n],
      [9_529n, 1_143n, 10_672n],
    ],
    [21_200n, 2_858n, 21_915n],
  ]);
  expect(result.roundOff).toBe(0n);
  expect(result.grandTotal).toBe(sumMoney(result.lines.map((line) => line.gross)));
  expectHeaderSums(result);
});

test("at 0% an inclusive line and an exclusive line produce the same amounts", () => {
  const lines = (priceBasis: PriceBasis) => [
    charge("plain", "50.00", "0", priceBasis),
    charge("loose", "85.00", "0", priceBasis, 4, 15),
  ];

  const inclusive = computeInvoiceLines(lines("inclusive"), 100n, NO_ROUNDING);
  const exclusive = computeInvoiceLines(lines("exclusive"), 100n, NO_ROUNDING);

  expect(amounts(inclusive)).toEqual(amounts(exclusive));
  expect(inclusive.roundOff).toBe(exclusive.roundOff);
});
