import type { orpc } from "@/lib/orpc";

type MovementReason = Awaited<
  ReturnType<typeof orpc.pharmacy.listMovements.call>
>["items"][number]["reason"];

type Product = Awaited<ReturnType<typeof orpc.pharmacy.listProducts.call>>["items"][number];

type Assert<T extends true> = T;

type SameValues<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Client-safe labels shared by the stock adjustment form and movement ledger.
export const REASON_LABELS: Record<MovementReason, string> = {
  opening: "Opening",
  receipt: "Receipt",
  sale: "Sale",
  return: "Return",
  release: "Release to shelf",
  quarantine: "Hold in quarantine",
  writeoff: "Write off",
  breakage: "Breakage",
  count_correction: "Count correction",
  internal_issue: "Internal issue",
};

// Kept local so no @hms/db server module reaches the client bundle (hard rule 6).
export const STOCK_UNITS = [
  "tablet",
  "capsule",
  "ml",
  "strip",
  "bottle",
  "vial",
  "tube",
  "piece",
] as const;

export type StockUnitLabelsMatchServer = Assert<
  SameValues<(typeof STOCK_UNITS)[number], Product["stockUnit"]>
>;

export const SCHEDULES = ["none", "h", "h1", "x"] as const;

export type ScheduleLabelsMatchServer = Assert<
  SameValues<(typeof SCHEDULES)[number], Product["schedule"]>
>;

export const SCHEDULE_LABELS: Record<(typeof SCHEDULES)[number], string> = {
  none: "No schedule",
  h: "Schedule H",
  h1: "Schedule H1",
  x: "Schedule X",
};
