import type { orpc } from "@/lib/orpc";

type MovementReason = Awaited<
  ReturnType<typeof orpc.pharmacy.listMovements.call>
>["items"][number]["reason"];

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
