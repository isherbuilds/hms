import { expect, test } from "bun:test";

import { settlementProblems, type PaymentLine } from "../../apps/web/src/lib/settlement";

const DUE = 98_250n;

const line = (over: Partial<PaymentLine> & { id: number }): PaymentLine => ({
  method: "cash",
  amount: "",
  reference: "",
  ...over,
});

const problems = (over: {
  due?: bigint;
  discount?: string;
  note?: string;
  payments?: PaymentLine[];
}) =>
  settlementProblems({
    due: over.due ?? DUE,
    subtotal: DUE,
    discount: over.discount ?? "",
    note: over.note ?? "",
    payments: over.payments ?? [line({ id: 1, amount: "982.50" })],
    attempted: true,
    currency: "INR",
  });

test("a payment that clears the bill, or an explained discount, has nothing left to resolve", () => {
  expect(problems({})).toEqual([]);
  expect(
    problems({
      discount: "50.00",
      due: DUE - 5_000n,
      note: "Staff concession.",
      payments: [line({ id: 1, amount: "932.50" })],
    }),
  ).toEqual([]);
});

test("overpayment, an unexplained balance, and a discount over the subtotal are refused", () => {
  const over = problems({
    payments: [
      line({ id: 1, amount: "500.00" }),
      line({ id: 2, method: "card", amount: "500.00", reference: "X" }),
    ],
  });

  expect(over).toHaveLength(1);
  expect(over[0]).toMatchObject({ key: "over-collected", quiet: false });
  expect(over[0]?.message).toContain("17.50");

  const balance = problems({ payments: [line({ id: 1, amount: "900.00" })] });
  expect(balance).toHaveLength(1);
  expect(balance[0]).toMatchObject({ key: "note" });
  expect(balance[0]?.message).toContain("82.50");

  expect(problems({ discount: "982.51" })[0]).toMatchObject({ key: "discount" });
});
