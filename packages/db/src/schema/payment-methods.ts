// Dependency-free on purpose: `@hms/api/lib/schemas` wraps this in a zod enum and
// is bundled into the client, so it must not pull drizzle in.
export const PAYMENT_METHODS = ["cash", "upi", "card", "bank"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
