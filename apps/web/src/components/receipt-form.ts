import { DECIMAL_PATTERN } from "@hms/api/core/money";
import { PERCENT_PATTERN } from "@hms/api/core/receipt-math";
import { expiryMonth } from "@hms/api/lib/schemas";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import type { PickedProduct } from "@/components/product-picker";
import { numberText } from "@/lib/form-schema";
import { billSummary, type ReceiptRowText, stockQuantities } from "@/lib/receipt-lines";

/** Whole months from this month to the printed one; negative once the month has passed. */
export function monthsUntil(expiry: string, today: string) {
  const [thisYear, thisMonth] = today.split("-").map(Number);
  const [year, month] = expiry.split("-").map(Number);

  return (year - thisYear) * 12 + (month - thisMonth);
}

const wholeText = /^\d+$/;

// Pricing is plain text here: an opening count carries none, so the receipt-level refine
// asks for it only on a supplier delivery.
const receiptLineSchema = (today: string) =>
  z
    .object({
      productId: z.string().min(1, "Choose a product"),
      productName: z.string(),
      stockUnit: z.string(),
      unitsPerPack: z.number().int().min(1),
      batchNumber: z.string().trim().min(1, "Type the batch number").max(50),
      expiryDate: expiryMonth,
      count: numberText(z.number().int().min(1, "At least 1")),
      loose: z.boolean(),
      price: z.string().regex(DECIMAL_PATTERN, "A price like 84 or 84.20"),
      free: z.string().trim(),
      rate: z.string().trim(),
      discount: z.string().trim(),
      gst: z.string().trim(),
      hsn: z.string().trim().max(20),
    })
    .superRefine((value, context) => {
      if (monthsUntil(value.expiryDate, today) < 0) {
        context.addIssue({
          code: "custom",
          path: ["expiryDate"],
          message: "This batch has expired. Check the date on the pack.",
        });
      }
    });

export const receiptSchema = (today: string) =>
  z
    .object({
      opening: z.boolean(),
      supplierName: z.string().trim().max(200),
      supplierReference: z.string().trim().max(100),
      receivedOn: z.iso.date("Use a valid date"),
      billTotal: z.string().trim(),
      note: z.string().trim().max(500),
      lines: z.array(receiptLineSchema(today)).min(1, "Add at least one batch"),
    })
    .superRefine((value, context) => {
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });

      value.lines.forEach((line, index) => {
        const row = rowText(line);

        if (!value.opening && line.free !== "" && !wholeText.test(line.free)) {
          issue(["lines", index, "free"], "Enter a whole number");
        } else if (!stockQuantities(row, value.opening)) {
          issue(["lines", index, stockQuantities(row, true) ? "free" : "count"], "Too large");
        }
      });

      if (value.opening) return;

      if (value.supplierName === "") issue(["supplierName"], "Type who delivered this");

      value.lines.forEach((line, index) => {
        if (!DECIMAL_PATTERN.test(line.rate)) issue(["lines", index, "rate"], "A rate like 76.19");

        if (!PERCENT_PATTERN.test(line.discount)) {
          issue(["lines", index, "discount"], "0 to 99.99");
        }

        if (!PERCENT_PATTERN.test(line.gst)) issue(["lines", index, "gst"], "0, 5, 12 or 18");
      });

      if (!DECIMAL_PATTERN.test(value.billTotal)) {
        issue(["billTotal"], "The grand total printed on the bill");

        return;
      }

      const summary = billSummary(value.lines.map(rowText), value.billTotal);

      if (summary.complete && !summary.matches) {
        issue(["billTotal"], "The lines do not add up to this total");
      }
    });

export type ReceiptInput = z.input<ReturnType<typeof receiptSchema>>;

type ReceiptLineInput = ReceiptInput["lines"][number];

export type Receipt = z.output<ReturnType<typeof receiptSchema>>;

export function rowText(line: {
  unitsPerPack: number;
  loose: boolean;
  count: string | number;
  free: string;
  rate: string;
  discount: string;
  gst: string;
  price: string;
}): ReceiptRowText {
  return { ...line, count: String(line.count) };
}

export function blankLine(): ReceiptLineInput {
  return {
    productId: "",
    productName: "",
    stockUnit: "",
    unitsPerPack: 1,
    batchNumber: "",
    expiryDate: "",
    count: "",
    loose: false,
    price: "",
    free: "",
    rate: "",
    discount: "0",
    gst: "",
    hsn: "",
  };
}

/**
 * What a picked product fills on its line: the unit it counts in, and its counter tax
 * where it has one. A rate or code already typed from the bill stays when it has none.
 */
function productFields(product: PickedProduct | null, line: ReceiptLineInput) {
  return {
    productId: product?.productId ?? "",
    productName: product?.name ?? "",
    stockUnit: product?.stockUnit ?? "",
    unitsPerPack: product?.unitsPerPack ?? 1,
    loose: product?.unitsPerPack === 1,
    gst: product?.taxRatePercent ? String(Number(product.taxRatePercent)) : line.gst,
    hsn: product?.taxCode ?? line.hsn,
  };
}

type ReceiptForm = UseFormReturn<ReceiptInput, unknown, Receipt>;

/** Module-level so rows get a stable function rather than a closure per render. */
export function fillLine(form: ReceiptForm, index: number, product: PickedProduct | null) {
  const line = form.getValues(`lines.${index}`);

  form.setValue(
    `lines.${index}`,
    { ...line, ...productFields(product, line) },
    { shouldDirty: true },
  );

  if (form.getFieldState(`lines.${index}.productId`).error) {
    void form.trigger(`lines.${index}.productId`);
  }
}
