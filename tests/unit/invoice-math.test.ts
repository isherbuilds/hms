import { expect, test } from "bun:test";

import { formatDecimal, parseDecimal, sittingShare } from "@hms/api/core/money";
import {
  calculateInvoiceBalance,
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  fiscalYearLabel,
  splitGst,
} from "@hms/api/lib/invoice-math";

import { sumMoney } from "../support/unique";

const charge = (chargeId: string, unitPrice: string, taxRatePercent = "0", qty = 1) => ({
  chargeId,
  description: `Charge ${chargeId}`,
  qty,
  unitPrice: parseDecimal(unitPrice),
  priceUnits: 1,
  taxRatePercent,
  taxCode: null,
});

test("computes a single line without a discount", () => {
  expect(computeInvoiceLines([charge("consult", "100.00", "18.00", 2)], 0n, "opd")).toEqual({
    lines: [
      {
        chargeId: "consult",
        description: "Charge consult",
        qty: 2,
        unitPrice: 10_000n,
        priceUnits: 1,
        lineSubtotal: 20_000n,
        allocatedDiscount: 0n,
        taxableValue: 20_000n,
        taxRatePercent: "18.00",
        taxAmount: 3_600n,
        gross: 23_600n,
        taxCode: null,
      },
    ],
    subtotal: 20_000n,
    taxTotal: 3_600n,
    roundOff: 0n,
    grandTotal: 23_600n,
  });
});

test("allocates a rounding remainder while keeping line and header sums exact", () => {
  const result = computeInvoiceLines(
    [charge("a", "1.00"), charge("b", "1.00"), charge("c", "1.00")],
    1n,
    "opd",
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual([1n, 0n, 0n]);
  expect(sumMoney(result.lines.map((line) => line.allocatedDiscount))).toBe(1n);
  expect(result.subtotal).toBe(sumMoney(result.lines.map((line) => line.lineSubtotal)));
  expect(result.taxTotal).toBe(sumMoney(result.lines.map((line) => line.taxAmount)));
  expect(result.grandTotal).toBe(sumMoney(result.lines.map((line) => line.gross)));
});

test("folds the allocation remainder into the largest line", () => {
  const result = computeInvoiceLines(
    [charge("small-a", "1.00"), charge("largest", "3.00"), charge("small-b", "1.00")],
    2n,
    "opd",
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual([0n, 2n, 0n]);
});

test("rounds tax half-up independently across multiple rates", () => {
  const result = computeInvoiceLines(
    [
      charge("zero", "10.00", "0"),
      charge("five", "2.50", "5"),
      charge("twelve", "10.00", "12"),
      charge("eighteen", "10.00", "18"),
    ],
    0n,
    "opd",
  );

  expect(result.lines.map((line) => line.taxAmount)).toEqual([0n, 13n, 120n, 180n]);
  expect(result.taxTotal).toBe(313n);
  expect(result.grandTotal).toBe(3_563n);
});

test("rejects a discount greater than the subtotal", () => {
  expect(() => computeInvoiceLines([charge("a", "10.00")], parseDecimal("10.01"), "opd")).toThrow();
});

test("full-line credits reproduce the exact invoice header totals", () => {
  const invoice = computeInvoiceLines(
    [charge("a", "17.35", "5", 2), charge("b", "8.99", "12"), charge("c", "2.50", "18", 3)],
    0n,
    "opd",
  );

  expect(sumMoney(invoice.lines.map((line) => line.taxableValue))).toBe(invoice.subtotal);
  expect(sumMoney(invoice.lines.map((line) => line.taxAmount))).toBe(invoice.taxTotal);
  expect(sumMoney(invoice.lines.map((line) => line.gross))).toBe(invoice.grandTotal);
});

test("extracts tax from an inclusive price with no discount", () => {
  const result = computeInvoiceLines([charge("mrp", "112.00", "12")], 0n, "pharmacy");

  expect(result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross])).toEqual([
    [10_000n, 1_200n, 11_200n],
  ]);
  expect([result.subtotal, result.taxTotal, result.grandTotal]).toEqual([11_200n, 1_200n, 11_200n]);
});

test("extracts tax from the discounted inclusive amount", () => {
  const result = computeInvoiceLines([charge("mrp", "112.00", "12")], 1_200n, "pharmacy");

  expect(result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross])).toEqual([
    [8_929n, 1_071n, 10_000n],
  ]);
  expect([result.subtotal, result.taxTotal, result.grandTotal]).toEqual([11_200n, 1_071n, 10_000n]);
});

test("leaves a zero-rated inclusive line untaxed", () => {
  const result = computeInvoiceLines([charge("mrp", "50.00", "0")], 0n, "pharmacy");

  expect(result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross])).toEqual([
    [5_000n, 0n, 5_000n],
  ]);
  expect([result.subtotal, result.taxTotal, result.grandTotal]).toEqual([5_000n, 0n, 5_000n]);
});

test("a fully discounted inclusive line is worth nothing", () => {
  const result = computeInvoiceLines([charge("mrp", "112.00", "12")], 11_200n, "pharmacy");

  expect(result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross])).toEqual([
    [0n, 0n, 0n],
  ]);
  expect([result.subtotal, result.taxTotal, result.grandTotal]).toEqual([11_200n, 0n, 0n]);
});

test("splits an inclusive discount across two rates and extracts each line's tax", () => {
  const result = computeInvoiceLines(
    [charge("twelve", "112.00", "12"), charge("five", "105.00", "5")],
    1_000n,
    "pharmacy",
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual([516n, 484n]);
  expect(result.lines.map((line) => [line.taxableValue, line.taxAmount, line.gross])).toEqual([
    [9_539n, 1_145n, 10_684n],
    [9_539n, 477n, 10_016n],
  ]);
  expect([result.subtotal, result.taxTotal, result.grandTotal]).toEqual([21_700n, 1_622n, 20_700n]);
});

test("allocates fractional strip prices by largest remainder without line rounding drift", () => {
  const result = computeInvoiceLines(
    [
      { ...charge("a", "76.19", "0", 3), priceUnits: 10 },
      { ...charge("b", "76.19", "0", 3), priceUnits: 10 },
      { ...charge("c", "76.19", "0", 4), priceUnits: 10 },
    ],
    0n,
    "pharmacy",
  );

  expect(result.lines.map((line) => line.lineSubtotal)).toEqual([2_286n, 2_286n, 3_047n]);
  expect(sumMoney(result.lines.map((line) => line.lineSubtotal))).toBe(7_619n);
  expect(result.subtotal).toBe(7_619n);
  expect(result.grandTotal).toBe(7_600n);
  expect(result.roundOff).toBe(-19n);
});

test("rounds only the inclusive pharmacy document total to rupees, with halves up", () => {
  const quote = computeInvoiceLines([charge("a", "122.86", "12")], 0n, "pharmacy");
  expect([quote.subtotal, quote.roundOff, quote.grandTotal]).toEqual([12_286n, 14n, 12_300n]);

  const half = computeInvoiceLines([charge("b", "122.50")], 0n, "pharmacy");
  expect([half.roundOff, half.grandTotal]).toEqual([50n, 12_300n]);
});

test("derives the taxable and tax portions of a partial gross credit", () => {
  expect(derivePartialCredit(parseDecimal("118.00"), "18.00")).toEqual({
    taxableValue: 10_000n,
    taxAmount: 1_800n,
    gross: 11_800n,
  });

  const inexact = derivePartialCredit(parseDecimal("1.00"), "18.00");
  expect(inexact).toEqual({
    taxableValue: 85n,
    taxAmount: 15n,
    gross: 100n,
  });
  expect(inexact.taxableValue + inexact.taxAmount).toBe(inexact.gross);
});

test("splits GST half-up and preserves every paise", () => {
  expect(splitGst(3n)).toEqual({ cgst: 2n, sgst: 1n });

  for (const tax of [0n, 1n, 2n, 199n, 12_345n]) {
    const split = splitGst(tax);
    expect(split.cgst + split.sgst).toBe(tax);
  }
});

test("labels fiscal years from UTC dates", () => {
  expect(fiscalYearLabel(new Date("2026-08-08T00:00:00Z"), 4)).toBe("2026-27");
  expect(fiscalYearLabel(new Date("2026-02-01T00:00:00Z"), 4)).toBe("2025-26");
  expect(fiscalYearLabel(new Date("2026-04-01T00:00:00Z"), 4)).toBe("2026-27");
  expect(fiscalYearLabel(new Date("2026-03-31T23:59:59Z"), 4)).toBe("2025-26");
  expect(fiscalYearLabel(new Date("2026-08-08T00:00:00Z"), 1)).toBe("2026");
});

test("formats a document number", () => {
  expect(documentNumber("INV", "2026-27", 7)).toBe("INV2026-27/7");
});

test("parses and formats decimal money at the boundary", () => {
  expect(parseDecimal("123")).toBe(12_300n);
  expect(parseDecimal("123.4")).toBe(12_340n);
  expect(() => parseDecimal("-0.50")).toThrow();
  expect(formatDecimal(-50n)).toBe("-0.50");

  expect(() => parseDecimal("1.234")).toThrow();
  expect(() => parseDecimal("abc")).toThrow();
});

test("invoice balance accounts for credits, payments, and returned refunds", () => {
  const balance = calculateInvoiceBalance({
    grandTotal: parseDecimal("500.00"),
    creditTotal: parseDecimal("150.00"),
    paymentsTotal: parseDecimal("400.00"),
    allocationsTotal: 0n,
    refundsTotal: parseDecimal("25.00"),
  });

  expect(balance).toEqual({
    grandTotal: 50_000n,
    creditTotal: 15_000n,
    paymentsTotal: 40_000n,
    allocationsTotal: 0n,
    refundsTotal: 2_500n,
    outstanding: -2_500n,
  });
});

test("a course splits into sittings the desk can collect", () => {
  // ₹7,000 over three: ₹100 steps, the last sitting takes the exact rest.
  expect(sittingShare(7000_00n, 3)).toBe(2300_00n);
  expect(sittingShare(4700_00n, 2)).toBe(2400_00n);
  expect(sittingShare(2300_00n, 1)).toBe(2300_00n);
  // A small session price stays to the rupee; under ₹1 splits to the paisa, never ₹0.
  expect(sittingShare(1500_00n, 10)).toBe(150_00n);
  expect(sittingShare(1_00n, 3)).toBe(33n);
});
