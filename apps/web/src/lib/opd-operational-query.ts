import { toast } from "sonner";

import { invalidateOpdAppointmentState, type QueryInvalidator } from "@/lib/domain-invalidation";
import { isConflictError } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

const OPD_RACE_MESSAGE =
  "Another terminal already moved this OPD appointment — refreshed to the current state.";

/**
 * The whole conflict branch of an OPD mutation's `onError`: pull the winning
 * state back onto this terminal after losing a race, then say what actually
 * happened. Pass `raceMessage` only where the plain lost-race wording should
 * be narrower, so five call sites cannot drift apart.
 */
export function toastOpdConflict(
  queryClient: QueryInvalidator,
  error: unknown,
  orgSlug: string,
  appointmentId: string,
  raceMessage: string = OPD_RACE_MESSAGE,
): boolean {
  if (!isConflictError(error)) return false;

  void Promise.all([
    invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listPendingCharges.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, appointmentId } }),
    }),
  ]);
  toast.error(raceMessage);
  return true;
}
