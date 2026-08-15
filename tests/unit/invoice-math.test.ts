import { expect, test } from "bun:test";

import {
  calculateInvoiceBalance,
  computeInvoiceLines,
  derivePartialCredit,
  documentNumber,
  fiscalYearLabel,
  splitGst,
  toPaise,
  toSignedPaise,
} from "@hms/api/lib/invoice-math";

const charge = (chargeId: string, unitPrice: string, taxRatePercent = "0", qty = 1) => ({
  chargeId,
  description: `Charge ${chargeId}`,
  qty,
  unitPrice,
  taxRatePercent,
  taxCode: null,
});

const sumMoney = (values: string[]) => values.reduce((sum, value) => sum + toPaise(value), 0);

test("computes a single line without a discount", () => {
  expect(computeInvoiceLines([charge("consult", "100.00", "18.00", 2)], "0")).toEqual({
    lines: [
      {
        chargeId: "consult",
        description: "Charge consult",
        qty: 2,
        unitPrice: "100.00",
        lineSubtotal: "200.00",
        allocatedDiscount: "0.00",
        taxableValue: "200.00",
        taxRatePercent: "18.00",
        taxAmount: "36.00",
        gross: "236.00",
        taxCode: null,
      },
    ],
    subtotal: "200.00",
    taxTotal: "36.00",
    grandTotal: "236.00",
  });
});

test("allocates a rounding remainder while keeping line and header sums exact", () => {
  const result = computeInvoiceLines(
    [charge("a", "1.00"), charge("b", "1.00"), charge("c", "1.00")],
    "0.01",
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual(["0.01", "0.00", "0.00"]);
  expect(sumMoney(result.lines.map((line) => line.allocatedDiscount))).toBe(1);
  expect(toPaise(result.subtotal)).toBe(sumMoney(result.lines.map((line) => line.lineSubtotal)));
  expect(toPaise(result.taxTotal)).toBe(sumMoney(result.lines.map((line) => line.taxAmount)));
  expect(toPaise(result.grandTotal)).toBe(sumMoney(result.lines.map((line) => line.gross)));
});

test("folds the allocation remainder into the largest line", () => {
  const result = computeInvoiceLines(
    [charge("small-a", "1.00"), charge("largest", "3.00"), charge("small-b", "1.00")],
    "0.02",
  );

  expect(result.lines.map((line) => line.allocatedDiscount)).toEqual(["0.00", "0.02", "0.00"]);
});

test("rounds tax half-up independently across multiple rates", () => {
  const result = computeInvoiceLines(
    [
      charge("zero", "10.00", "0"),
      charge("five", "2.50", "5"),
      charge("twelve", "10.00", "12"),
      charge("eighteen", "10.00", "18"),
    ],
    "0",
  );

  expect(result.lines.map((line) => line.taxAmount)).toEqual(["0.00", "0.13", "1.20", "1.80"]);
  expect(result.taxTotal).toBe("3.13");
  expect(result.grandTotal).toBe("35.63");
});

test("rejects a discount greater than the subtotal", () => {
  expect(() => computeInvoiceLines([charge("a", "10.00")], "10.01")).toThrow();
});

test("full-line credits reproduce the exact invoice header totals", () => {
  const invoice = computeInvoiceLines(
    [charge("a", "17.35", "5", 2), charge("b", "8.99", "12"), charge("c", "2.50", "18", 3)],
    "0",
  );

  expect(sumMoney(invoice.lines.map((line) => line.taxableValue))).toBe(toPaise(invoice.subtotal));
  expect(sumMoney(invoice.lines.map((line) => line.taxAmount))).toBe(toPaise(invoice.taxTotal));
  expect(sumMoney(invoice.lines.map((line) => line.gross))).toBe(toPaise(invoice.grandTotal));
});

test("derives the taxable and tax portions of a partial gross credit", () => {
  expect(derivePartialCredit("118.00", "18.00")).toEqual({
    taxableValue: "100.00",
    taxAmount: "18.00",
    gross: "118.00",
  });

  const inexact = derivePartialCredit("1.00", "18.00");
  expect(inexact).toEqual({
    taxableValue: "0.85",
    taxAmount: "0.15",
    gross: "1.00",
  });
  expect(toPaise(inexact.taxableValue) + toPaise(inexact.taxAmount)).toBe(toPaise(inexact.gross));
});

test("splits GST half-up and preserves every paise", () => {
  expect(splitGst("0.03")).toEqual({ cgst: "0.02", sgst: "0.01" });

  for (const tax of ["0.00", "0.01", "0.02", "1.99", "123.45"]) {
    const split = splitGst(tax);
    expect(toPaise(split.cgst) + toPaise(split.sgst)).toBe(toPaise(tax));
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

test("accepts only non-negative money with at most two decimal places", () => {
  expect(toPaise("123")).toBe(12_300);
  expect(toPaise("123.4")).toBe(12_340);
  expect(toPaise("123.45")).toBe(12_345);

  expect(() => toPaise("-1")).toThrow();
  expect(() => toPaise("1.234")).toThrow();
  expect(() => toPaise("abc")).toThrow();
});

test("invoice balance accounts for credits, payments, and returned refunds", () => {
  const balance = calculateInvoiceBalance({
    grandTotal: "500.00",
    credits: ["100.00", "50.00"],
    payments: ["400.00"],
    refunds: ["25.00"],
  });

  expect(balance).toEqual({
    grandTotal: "500.00",
    creditTotal: "150.00",
    paymentsTotal: "400.00",
    refundsTotal: "25.00",
    outstanding: "-25.00",
  });
  expect(toSignedPaise(balance.outstanding)).toBe(-2_500);
});
