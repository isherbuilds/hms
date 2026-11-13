// Dependency-free on purpose: the client computes previews with it, so it must not
// pull drizzle in. A price either excludes GST (added on top) or includes it (MRP).
export const PRICE_BASES = ["exclusive", "inclusive"] as const;

export type PriceBasis = (typeof PRICE_BASES)[number];
