import { expect, test } from "bun:test";

import { formatDecimal, parseDecimal } from "@hms/api/core/money";
import {
  calculateInvoiceBalance,
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  fiscalYearLabel,
  splitGst,
} from "@hms/api/lib/invoice-math";

const charge = (chargeId: string, unitPrice: string, taxRatePercent = "0", qty = 1) => ({
  chargeId,
  description: `Charge ${chargeId}`,
  qty,
  unitPrice: parseDecimal(unitPrice),
  taxRatePercent,
  taxCode: null,
});

const sumMoney = (values: bigint[]) => values.reduce((sum, value) => sum + value, 0n);

test("computes a single line without a discount", () => {
  expect(computeInvoiceLines([charge("consult", "100.00", "18.00", 2)], 0n)).toEqual({
    lines: [
      {
        chargeId: "consult",
        description: "Charge consult",
        qty: 2,
        unitPrice: 10_000n,
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
    grandTotal: 23_600n,
  });
});

test("allocates a rounding remainder while keeping line and header sums exact", () => {
  const result = computeInvoiceLines(
    [charge("a", "1.00"), charge("b", "1.00"), charge("c", "1.00")],
    1n,
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
  );

  expect(result.lines.map((line) => line.taxAmount)).toEqual([0n, 13n, 120n, 180n]);
  expect(result.taxTotal).toBe(313n);
  expect(result.grandTotal).toBe(3_563n);
});

test("rejects a discount greater than the subtotal", () => {
  expect(() => computeInvoiceLines([charge("a", "10.00")], parseDecimal("10.01"))).toThrow();
});

test("full-line credits reproduce the exact invoice header totals", () => {
  const invoice = computeInvoiceLines(
    [charge("a", "17.35", "5", 2), charge("b", "8.99", "12"), charge("c", "2.50", "18", 3)],
    0n,
  );

  expect(sumMoney(invoice.lines.map((line) => line.taxableValue))).toBe(invoice.subtotal);
  expect(sumMoney(invoice.lines.map((line) => line.taxAmount))).toBe(invoice.taxTotal);
  expect(sumMoney(invoice.lines.map((line) => line.gross))).toBe(invoice.grandTotal);
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
    refundsTotal: parseDecimal("25.00"),
  });

  expect(balance).toEqual({
    grandTotal: 50_000n,
    creditTotal: 15_000n,
    paymentsTotal: 40_000n,
    refundsTotal: 2_500n,
    outstanding: -2_500n,
  });
});
