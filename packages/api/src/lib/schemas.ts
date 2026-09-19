import { PAYER_TYPES, type PayerType } from "@hms/db/schema/payer-types";
import { PAYMENT_METHODS, type PaymentMethod } from "@hms/db/schema/payment-methods";
import { EMERGENCY_CONTACT_RELATIONS, GUARDIAN_RELATIONS } from "@hms/db/schema/patient-relations";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

// Input fragments shared by more than one router.

/** Integer paise; the client converts what the desk typed before it sends. */
export const money = z.bigint().nonnegative();

export const positiveMoney = z.bigint().positive();

// Calendar-valid, not shape-valid: `2026-02-31` must fail here, not in Postgres.
export const dateOnly = z.iso.date();

/** A pack prints only a month; the server stores that month's last day. */
export const expiryMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expiry month like 2031-12");

/**
 * An inclusive business-date window. Both ends are optional in the wire schema and
 * resolved by `resolveDayRange`, so an operational list reads the current day rather
 * than the organization's whole history.
 */
export const dayRange = { from: dateOnly.optional(), to: dateOnly.optional() };

export function resolveDayRange(
  input: { from?: string; to?: string },
  today: string,
): { from: string; to: string } {
  const from = input.from ?? today;
  const to = input.to ?? today;

  if (from > to) {
    throw new ORPCError("BAD_REQUEST", { message: "That range starts after it ends" });
  }

  return { from, to };
}

export const shortName = z.string().trim().min(1).max(200);

// Names are stored lowercase; the UI owns casing. People only: catalog, payer,
// and department names keep their given case (acronyms such as "ECHS").
export const personName = shortName.toLowerCase();

export const phone = z.string().trim().min(4).max(20);

export const reason = z.string().trim().min(1).max(500);

export const note = z.string().trim().max(500).optional();

export const searchQuery = z.string().trim().min(1).max(100).optional();

// Escapes LIKE wildcards so a typed `%` matches a literal percent sign.
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export const pageLimit = z.number().int().min(1).max(100).default(50);

export const paymentMethod = z.enum(PAYMENT_METHODS);

export const payerType = z.enum(PAYER_TYPES);

export const guardianRelation = z.enum(GUARDIAN_RELATIONS);

export const emergencyContactRelation = z.enum(EMERGENCY_CONTACT_RELATIONS);

export type { PaymentMethod, PayerType };

export { guardianLabel } from "@hms/db/schema/patient-relations";

/** Everything but cash lands somewhere traceable, so the desk records the trace. */
export function requirePaymentReference(
  value: { method: PaymentMethod; reference?: string },
  context: z.RefinementCtx,
): void {
  if (value.method !== "cash" && !value.reference) {
    context.addIssue({
      code: "custom",
      path: ["reference"],
      message: "Add the transaction reference for a non-cash payment",
    });
  }
}

export const paymentLine = z
  .object({
    method: paymentMethod,
    amount: positiveMoney,
    reference: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine(requirePaymentReference);
