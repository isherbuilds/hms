import { PAYER_TYPES, type PayerType } from "@hms/db/schema/payer-types";
import { PAYMENT_METHODS, type PaymentMethod } from "@hms/db/schema/payment-methods";
import { EMERGENCY_CONTACT_RELATIONS, GUARDIAN_RELATIONS } from "@hms/db/schema/patient-relations";
import { z } from "zod";

import { toPaise } from "./invoice-math";

// Input fragments shared by more than one router. Dependency-free apart from
// `invoice-math`, so the web app may import `MONEY_PATTERN` too.

export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const money = z.string().regex(MONEY_PATTERN);
export const positiveMoney = money.refine((value) => toPaise(value) > 0);
// Calendar-valid, not shape-valid: `2026-02-31` must fail here, not in Postgres.
export const dateOnly = z.iso.date();
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
