import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  invalidateOpdAppointmentState,
  type OpdAppointmentTransition,
} from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { errorMessage, errorReason } from "@/lib/orpc-error";

const RACE_MESSAGE =
  "Another terminal already moved this OPD appointment — refreshed to the current state.";

/**
 * The `onError` for every OPD mutation.
 *
 * Only a `raced` conflict is worth recovering from: the screen is stale, so refetch
 * and the operator can retry. Every other outcome — a cancelled appointment, an
 * already-settled bill — is a fact the server states plainly, and refetching would
 * change nothing. Pass `raceMessage` only where the wording must be narrower.
 */
export function useOpdErrorToast(orgSlug: string) {
  const queryClient = useQueryClient();

  return async (
    appointmentId: string,
    transition: OpdAppointmentTransition,
    error: unknown,
    raceMessage?: string,
  ) => {
    if (errorReason(error) !== "raced") {
      toast.error(errorMessage(error));
      return;
    }

    // Awaited: the toast claims the screen is current, so it must be true when shown.
    try {
      await Promise.all([
        invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, transition),
        queryClient.invalidateQueries({
          queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, appointmentId } }),
        }),
      ]);
    } catch {
      toast.error("Another terminal moved this appointment, and the refresh failed. Reload.");
      return;
    }
    toast.error(raceMessage ?? RACE_MESSAGE);
  };
}
