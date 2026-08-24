import { notFound } from "@tanstack/react-router";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

export function hasErrorCode(error: unknown, code: string): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

export function applyOrpcFieldError<TFieldValues extends FieldValues, TContext, TTransformedValues>(
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
  error: unknown,
  map: Record<string, { field: string; message: string }>,
): boolean {
  for (const [code, fieldError] of Object.entries(map)) {
    if (!hasErrorCode(error, code)) continue;
    form.setError(fieldError.field as FieldPath<TFieldValues>, { message: fieldError.message });
    return true;
  }

  return false;
}

export function isConflictError(error: unknown): boolean {
  return hasErrorCode(error, "CONFLICT");
}

/**
 * The `data.reason` a handler attached to its error, if any. Two CONFLICTs can
 * mean opposite things to an operator — a lost race is worth retrying, an
 * already-issued invoice never is — so the cause has to survive the transport.
 */
export function errorReason(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const data = "data" in current ? current.data : undefined;
    if (data && typeof data === "object" && "reason" in data && typeof data.reason === "string") {
      return data.reason;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

const GENERIC_ROUTE_ERROR = "An unexpected error interrupted the request.";

/**
 * The SSR client calls procedures in-process, so an unexpected driver error is
 * not normalized by the HTTP transport. Production HTML must not echo that
 * message; development keeps it visible for local diagnosis.
 */
export function routeErrorMessage(error: unknown, exposeInternal: boolean): string {
  return exposeInternal && error instanceof Error ? error.message : GENERIC_ROUTE_ERROR;
}

export async function loadRouteQuery<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (hasErrorCode(error, "NOT_FOUND")) throw notFound();
    throw error;
  }
}
