import type { ConflictReason } from "@hms/api/lib/conflict";
import { notFound } from "@tanstack/react-router";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

/**
 * Walks an error and its `cause` chain. Transport wraps server errors, so the
 * code, data code and reason a handler threw are never on the outermost error.
 * The `seen` set stops a self-referential cause from looping forever.
 */
function* causes(error: unknown): Generator<Record<string, unknown>> {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    yield current as Record<string, unknown>;
    current = "cause" in current ? current.cause : undefined;
  }
}

/** The first `data.<key>` string found on the chain. */
function dataString(error: unknown, key: string): string | undefined {
  for (const link of causes(error)) {
    const data = link.data;
    if (data && typeof data === "object" && key in data) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }

  return undefined;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  for (const link of causes(error)) {
    if (link.code === code) return true;
  }

  return false;
}

// Two CONFLICTs can mean opposite things to an operator — a lost race is worth
// retrying, an already-issued invoice never is — so the cause must survive transport.
// `ConflictReason` is the server's own union, so a stale name fails to compile.
export function errorReason(error: unknown): ConflictReason | undefined {
  return dataString(error, "reason") as ConflictReason | undefined;
}

function isServerFault(error: unknown): boolean {
  for (const link of causes(error)) {
    if (typeof link.status === "number" && link.status >= 500) return true;
  }

  return false;
}

/**
 * The server's wording when it sent one, the caller's fallback otherwise.
 *
 * Every API throw now carries a message, so the fallback is not dead copy: it is
 * what staff read when the server 5xxes, because an invariant report is written for
 * the logs and must never reach a screen. Name the action where you can — "Could not
 * record the payment" beats the generic default at the moment it actually shows.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (isServerFault(error)) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Marks the field the conflict belongs to and hands back its wording, so the caller
 * does not repeat the message to toast it. Undefined when the map does not match. */
export function applyOrpcFieldError<TFieldValues extends FieldValues, TContext, TTransformedValues>(
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
  error: unknown,
  map: Partial<Record<ConflictReason, { field: string; message: string }>>,
): string | undefined {
  const fieldError = map[errorReason(error) as ConflictReason];
  if (!fieldError) return undefined;

  form.setError(fieldError.field as FieldPath<TFieldValues>, { message: fieldError.message });
  return fieldError.message;
}

const GENERIC_ROUTE_ERROR = "An unexpected error interrupted the request.";

// The SSR client calls procedures in-process, so a driver error is not normalized
// by the HTTP transport. Production HTML must not echo that message.
export function routeErrorMessage(error: unknown, exposeInternal: boolean): string {
  return exposeInternal ? errorMessage(error, GENERIC_ROUTE_ERROR) : GENERIC_ROUTE_ERROR;
}

export async function loadRouteQuery<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (hasErrorCode(error, "NOT_FOUND")) throw notFound();
    throw error;
  }
}
