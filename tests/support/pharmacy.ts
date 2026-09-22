/** Pricing for a receipt line whose cost a test does not examine: a free delivery. */
export const UNPRICED = {
  freeQty: 0,
  packSize: 1,
  rate: 0n,
  discountPercent: "0",
  gstPercent: "0",
} as const;
