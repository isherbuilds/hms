import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";
import { isConflictError } from "@/lib/orpc-error";

type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<unknown>;
};

/**
 * Pulls the winning state back onto this terminal after losing a race.
 * Returns whether the error was that race, so callers only choose the message.
 */
export function refreshVisitOnConflict(
  queryClient: QueryInvalidator,
  error: unknown,
  orgSlug: string,
  visitId: string,
): boolean {
  if (!isConflictError(error)) return false;

  void Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.visit.queue.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({
      queryKey: orpc.visit.get.key({ input: { orgSlug, visitId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listPendingCharges.key({ input: { orgSlug, visitId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, visitId } }),
    }),
  ]);
  return true;
}
