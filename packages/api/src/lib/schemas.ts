import { z } from "zod";

import { toPaise } from "./invoice-math";

// Input fragments shared by more than one router. Dependency-free apart from
// `invoice-math`, so the web app may import `MONEY_PATTERN` too.

export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const money = z.string().regex(MONEY_PATTERN);
export const positiveMoney = money.refine((value) => toPaise(value) > 0);
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const shortName = z.string().trim().min(1).max(200);
export const phone = z.string().trim().min(4).max(20);
export const reason = z.string().trim().min(1).max(500);
export const searchQuery = z.string().trim().min(1).max(100).optional();
// Escapes LIKE wildcards so a typed `%` matches a literal percent sign.
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export const pageLimit = z.number().int().min(1).max(100).default(50);

export const paymentMethod = z.enum(["cash", "upi", "card"]);
export type PaymentMethod = z.infer<typeof paymentMethod>;

export const paymentLine = z.object({
  method: paymentMethod,
  amount: positiveMoney,
  reference: z.string().trim().min(1).max(100).optional(),
});
