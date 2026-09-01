import { expect, test } from "bun:test";

import {
  needsReference,
  settlementProblems,
  type PaymentLine,
} from "../../apps/web/src/lib/settlement";

/** ₹982.50 — the worked example the desk prototype was measured against. */
const DUE = 98250;
const INR = "INR";

const line = (over: Partial<PaymentLine> & { id: number }): PaymentLine => ({
  method: "cash",
  amount: "",
  reference: "",
  ...over,
});

const problems = (over: {
  due?: number;
  discount?: string;
  note?: string;
  payments?: PaymentLine[];
  attempted?: boolean;
}) =>
  settlementProblems({
    due: over.due ?? DUE,
    subtotal: DUE,
    discount: over.discount ?? "",
    note: over.note ?? "",
    payments: over.payments ?? [line({ id: 1, amount: "982.50" })],
    attempted: over.attempted ?? false,
    currency: INR,
  });

test("a full cash payment that clears the bill has nothing left to resolve", () => {
  expect(problems({})).toEqual([]);
});

test("an amount with three decimal places is rejected against its own line", () => {
  const found = problems({ payments: [line({ id: 7, amount: "12.345" })] });

  expect(found).toHaveLength(2); // the format failure, and the balance it leaves
  expect(found[0]).toMatchObject({
    key: "amount:7",
    fieldId: "payment-amount-7",
    quiet: false,
  });
  expect(found[0]?.message).toContain("two decimal places");
});

test("cash needs no reference; UPI and card do", () => {
  expect(needsReference("cash")).toBe(false);
  expect(needsReference("upi")).toBe(true);
  expect(needsReference("card")).toBe(true);
});

test("a non-zero UPI payment requires a transaction reference", () => {
  const payments = [line({ id: 2, method: "upi", amount: "982.50" })];
  expect(problems({ payments })[0]).toMatchObject({ key: "reference:2", quiet: true });
  expect(problems({ payments, attempted: true })[0]).toMatchObject({
    key: "reference:2",
    fieldId: "payment-reference-2",
    quiet: false,
  });
  expect(
    problems({
      payments: [line({ id: 2, method: "upi", amount: "982.50", reference: "UPI/4471/8802" })],
    }),
  ).toEqual([]);
});

test("collecting more than the bill names the excess and is never quiet", () => {
  const found = problems({
    payments: [
      line({ id: 1, amount: "500.00" }),
      line({ id: 2, method: "card", amount: "500.00", reference: "X" }),
    ],
  });

  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ key: "over-collected", quiet: false });
  expect(found[0]?.message).toContain("17.50");
});

test("a balance left behind requires a written reason", () => {
  const payments = [line({ id: 1, amount: "900.00" })];

  const unexplained = problems({ payments, attempted: true });
  expect(unexplained).toHaveLength(1);
  expect(unexplained[0]).toMatchObject({ key: "note", fieldId: "settlement-note", quiet: false });
  expect(unexplained[0]?.message).toContain("82.50");

  expect(problems({ payments, note: "Paying the rest at the review visit." })).toEqual([]);
});

test("a discount also requires a reason, even when nothing is left owing", () => {
  expect(
    problems({ discount: "50.00", due: DUE - 5000, payments: [line({ id: 1, amount: "932.50" })] }),
  ).toHaveLength(1);
  expect(
    problems({
      discount: "50.00",
      due: DUE - 5000,
      payments: [line({ id: 1, amount: "932.50" })],
      note: "Staff concession.",
    }),
  ).toEqual([]);
});

test("a malformed discount is reported before anything downstream of it", () => {
  const found = problems({
    discount: "1.234",
    payments: [line({ id: 3, method: "upi", amount: "9.999" })],
  });

  expect(found[0]).toMatchObject({ key: "discount", fieldId: "settlement-discount", quiet: false });
});

test("a discount cannot exceed the server-quoted subtotal", () => {
  const found = problems({ discount: "982.51" });

  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ key: "discount", fieldId: "settlement-discount" });
  expect(found[0]?.message).toContain("cannot exceed");
});

test("collecting nothing at all is allowed, with a reason", () => {
  const payments = [line({ id: 1, amount: "" })];
  expect(problems({ payments, attempted: true })[0]).toMatchObject({ key: "note" });
  expect(problems({ payments, note: "Bill issued, patient will settle later." })).toEqual([]);
});
