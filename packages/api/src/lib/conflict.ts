import { ORPCError } from "@orpc/server";

/**
 * Why a CONFLICT happened when the web client must branch on it:
 *
 * - `duplicate` — that payer name is already in use (mapped to the name field).
 * - `uid_taken` — that patient UID belongs to someone else (mapped to the UID field).
 * - `stale_record` — the patient row, bed reservation or surgical case moved after the
 *   operator opened it (the dialog closes instead of showing a capacity refusal).
 * - `bed_held` — a live hold stands on the bed (the admit and move dialogs show it and,
 *   for `ipd:correct`, offer to release the bed's holds with a reason).
 * - `case_held` — a maintenance block would cover a confirmed surgical case (the block
 *   dialog offers, for `theatre:override`, to block anyway and disrupt the cases).
 *
 * Every other CONFLICT is a plain `ORPCError("CONFLICT")`: the client refetches and
 * shows the server message.
 */
export type ConflictReason = "duplicate" | "uid_taken" | "stale_record" | "bed_held" | "case_held";

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
