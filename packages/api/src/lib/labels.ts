import type { PaymentMethod } from "./schemas";

// Staff-facing copy shared by the screens and the server-built exports.

// `satisfies Record<PaymentMethod, …>` pins the labels to the API enum in both
// directions: a method added on one side without the other fails to compile.
export const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
} satisfies Record<PaymentMethod, string>;

export const OPD_STATUS_LABELS = {
  booked: "Booked",
  checked_in: "Checked In",
  cancelled: "Cancelled",
  no_show: "No show",
} as const;

export function arrivalModeLabel(mode: "scheduled" | "walk_in"): string {
  return mode === "walk_in" ? "Walk-in" : "Scheduled";
}

// Practitioners are stored by bare name; screens and exports add the title.
// Names saved before this rule may already carry it, so it is never doubled.
export function practitionerDisplayName(name: string) {
  return /^dr\b\.?/i.test(name) ? name : `Dr. ${name}`;
}
