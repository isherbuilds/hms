import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";
import { paymentMethod, requirePaymentReference, type PaymentMethod } from "@hms/api/lib/schemas";
import { z } from "zod";

// Relative: the `@/` alias is an apps/web path, and the unit-test project that
// imports this module does not carry it.
import { formatMoney, parseMoneyInput } from "./money";

export type { PaymentMethod };

// `satisfies Record<PaymentMethod, …>` pins the labels to the API enum in both
// directions: a method added on one side without the other fails to compile.
const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
} satisfies Record<PaymentMethod, string>;

export const PAYMENT_METHODS = paymentMethod.options;

export type PaymentLine = {
  id: number;
  method: PaymentMethod;
  amount: string;
  reference: string;
};

export function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method];
}

/** Everything but cash lands somewhere traceable, so the desk records the trace. */
export function needsReference(method: PaymentMethod): boolean {
  return method !== "cash";
}

// The zod shape behind every "record a payment" form. A single-payment dialog uses
// it as is; a split line adds its row id.
export const paymentLineFields = z.object({
  method: paymentMethod,
  amount: z
    .string()
    .regex(DECIMAL_PATTERN, "Amount like 150.00")
    .transform(parseDecimal)
    .refine((value) => value > 0n, "Enter an amount above zero"),
  reference: z.string().trim().max(100).optional(),
});

export const MAX_PAYMENT_LINES = 4;

/** What the lines add up to. Every collect form weighs this against what is owed. */
export function collectedPaise(payments: { amount: string }[]): bigint {
  return payments.reduce((sum, payment) => sum + (parseMoneyInput(payment.amount) ?? 0n), 0n);
}

// The record-payment form seeds its cash line with whatever credit does not cover, so
// an empty line is how "the credit settles it" submits. The floor is on the lines plus
// the credit together, which only the form knows; a line of its own has none.
const collectedAmount = z
  .string()
  .refine((value) => value.trim() === "" || DECIMAL_PATTERN.test(value), "Amount like 150.00")
  .transform((value) => (value.trim() === "" ? 0n : parseDecimal(value)));

const paymentLineSchema = paymentLineFields
  .extend({ id: z.number(), amount: collectedAmount })
  .superRefine((value, context) => {
    if (value.amount > 0n) requirePaymentReference(value, context);
  });

export const paymentFormSchema = z.object({
  payments: z.array(paymentLineSchema).max(MAX_PAYMENT_LINES),
});

/** The next split line: an unused method, pre-filled with whatever is still owed. */
export function nextPaymentLine(
  payments: Array<{ id: number; method: PaymentMethod }>,
  remainingPaise: bigint,
) {
  const used = new Set(payments.map((payment) => payment.method));
  const method = PAYMENT_METHODS.find((candidate) => !used.has(candidate)) ?? "cash";

  return {
    id: Math.max(0, ...payments.map((payment) => payment.id)) + 1,
    method,
    amount: remainingPaise > 0n ? formatDecimal(remainingPaise) : "",
    reference: "",
  };
}

export type SettlementProblem = {
  key: string;
  fieldId: string;
  message: string;
  quiet: boolean;
  selectOnFocus?: boolean;
};

/** Empty means nothing collected on that line, which is allowed. A typo is not. */
export function amountOf(payment: PaymentLine): bigint | null {
  const trimmed = payment.amount.trim();

  return trimmed === "" ? 0n : parseMoneyInput(trimmed);
}

// In the order the desk should deal with them: the first entry is what the blocked
// primary names and what Enter moves focus to.
export function settlementProblems({
  due,
  subtotal,
  discount,
  note,
  payments,
  attempted,
  currency,
}: {
  /** Paise, already net of the discount, as quoted by the server. */
  due: bigint;
  /** Paise before discount, from the server-selected service quote. */
  subtotal: bigint;
  discount: string;
  note: string;
  payments: PaymentLine[];
  attempted: boolean;
  currency: string;
}): SettlementProblem[] {
  const problems: SettlementProblem[] = [];
  const amount = (paise: bigint) => formatMoney(paise, currency);

  // `due` is only refetched for a discount the server would accept, so every rule
  // below measures against a stale figure until this one is fixed. It comes first.
  const discountPaise = parseMoneyInput(discount.trim() || "0");

  if (discountPaise === null) {
    return [
      {
        key: "discount",
        fieldId: "settlement-discount",
        message: "A discount takes at most two decimal places.",
        quiet: false,
        selectOnFocus: true,
      },
    ];
  }

  if (discountPaise > subtotal) {
    return [
      {
        key: "discount",
        fieldId: "settlement-discount",
        message: "Discount cannot exceed the bill subtotal.",
        quiet: false,
        selectOnFocus: true,
      },
    ];
  }

  for (const [index, payment] of payments.entries()) {
    if (amountOf(payment) === null) {
      problems.push({
        key: `amount:${payment.id}`,
        fieldId: `payment-amount-${payment.id}`,
        message: `Payment ${index + 1}: an amount takes at most two decimal places.`,
        quiet: false,
        selectOnFocus: true,
      });
    }
  }

  for (const [index, payment] of payments.entries()) {
    const collected = amountOf(payment);

    if (collected === null || collected === 0n) continue;

    if (!needsReference(payment.method) || payment.reference.trim() !== "") continue;
    problems.push({
      key: `reference:${payment.id}`,
      fieldId: `payment-reference-${payment.id}`,
      message: `Payment ${index + 1}: add the ${methodLabel(payment.method)} transaction reference.`,
      quiet: !attempted,
    });
  }

  const collecting = collectedPaise(payments);

  if (collecting > due) {
    const last = payments[payments.length - 1];
    problems.push({
      key: "over-collected",
      fieldId: last ? `payment-amount-${last.id}` : "settlement-discount",
      message: `Collected exceeds the bill by ${amount(collecting - due)}.`,
      quiet: false,
      selectOnFocus: true,
    });
  }

  const balance = due - collecting;
  const discounted = discountPaise > 0n;

  if ((balance > 0n || discounted) && note.trim() === "") {
    problems.push({
      key: "note",
      fieldId: "settlement-note",
      message:
        balance > 0n
          ? `Add a reason for the ${amount(balance)} balance.`
          : "Add a reason for the discount.",
      quiet: !attempted,
    });
  }

  return problems;
}
