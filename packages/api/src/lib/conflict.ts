import { ORPCError } from "@orpc/server";

/**
 * Why a CONFLICT happened. A bare 409 tells the client nothing, so it guesses —
 * and guessing wrong means offering "we refreshed you" for a clash no refresh fixes.
 *
 * - `raced` — another writer moved the row first. A refetch makes the screen correct.
 * - `not_billable` — the appointment left a state that allows billing.
 * - `no_pending_charges` — there is nothing left to settle.
 * - `duplicate` — a unique index rejected the write.
 * - `uid_taken` — that patient UID belongs to someone else.
 * - `stale_record` — the row moved after the operator opened it.
 * - `catalog_price_changed` — prices moved between the quote and the settlement.
 */
export type ConflictReason =
  | "raced"
  | "not_billable"
  | "no_pending_charges"
  | "duplicate"
  | "uid_taken"
  | "stale_record"
  | "catalog_price_changed";

/** A clash the operator can act on. Expected, so the server does not log it. */
export function conflict(reason: ConflictReason, message: string) {
  return new ORPCError("CONFLICT", { message, data: { reason } });
}

/**
 * A state the surrounding transaction should have made impossible — a locked row
 * that vanished, an UPDATE that matched fewer rows than it just selected.
 *
 * This must stay 5xx. `logORPCError` in apps/server drops everything under 500, so
 * dressing a bug as a CONFLICT hides it from the logs and shows staff "Conflict".
 * The message reaches the log, never the browser: the client shows a generic line
 * for any 5xx.
 */
export function impossible(what: string) {
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: `Invariant violated: ${what}` });
}
