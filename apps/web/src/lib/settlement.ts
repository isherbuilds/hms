import { fromPaise, toPaise } from "@hms/api/lib/invoice-math";

// Relative: the `@/` alias is an apps/web path, and the unit-test project that
// imports this module does not carry it.
import { formatMoney, MONEY_INPUT_PATTERN, parseMoneyInput } from "./money";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export type PaymentLine = {
  id: number;
  method: PaymentMethod;
  amount: string;
  reference: string;
};

export function methodLabel(method: PaymentMethod): string {
  return method === "upi" ? "UPI" : `${method.charAt(0).toUpperCase()}${method.slice(1)}`;
}

/** Everything but cash lands somewhere traceable, so the desk records the trace. */
export function needsReference(method: PaymentMethod): boolean {
  return method !== "cash";
}

export type SettlementProblem = {
  key: string;
  fieldId: string;
  message: string;
  quiet: boolean;
  selectOnFocus?: boolean;
};

/** Empty means nothing collected on that line, which is allowed. A typo is not. */
export function amountOf(payment: PaymentLine): number | null {
  const trimmed = payment.amount.trim();
  return trimmed === "" ? 0 : parseMoneyInput(trimmed);
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
  due: number;
  /** Paise before discount, from the server-selected service quote. */
  subtotal: number;
  discount: string;
  note: string;
  payments: PaymentLine[];
  attempted: boolean;
  currency: string;
}): SettlementProblem[] {
  const problems: SettlementProblem[] = [];
  const amount = (paise: number) => formatMoney(fromPaise(paise), currency);

  // `due` is only refetched for a discount the server would accept, so every rule
  // below measures against a stale figure until this one is fixed. It comes first.
  const normalizedDiscount = discount.trim() || "0";
  if (!MONEY_INPUT_PATTERN.test(normalizedDiscount)) {
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
  if (toPaise(normalizedDiscount) > subtotal) {
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
    if (collected === null || collected === 0) continue;
    if (!needsReference(payment.method) || payment.reference.trim() !== "") continue;
    problems.push({
      key: `reference:${payment.id}`,
      fieldId: `payment-reference-${payment.id}`,
      message: `Payment ${index + 1}: add the ${methodLabel(payment.method)} transaction reference.`,
      quiet: !attempted,
    });
  }

  const collecting = payments.reduce((sum, payment) => sum + (amountOf(payment) ?? 0), 0);
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
  const discounted = (parseMoneyInput(normalizedDiscount) ?? 0) > 0;
  if ((balance > 0 || discounted) && note.trim() === "") {
    problems.push({
      key: "note",
      fieldId: "settlement-note",
      message:
        balance > 0
          ? `Add a reason for the ${amount(balance)} balance.`
          : "Add a reason for the discount.",
      quiet: !attempted,
    });
  }

  return problems;
}
