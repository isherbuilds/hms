import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  invalidateBillingState,
  invalidateOpdAppointmentState,
  type OpdAppointmentTransition,
} from "@/lib/domain-invalidation";
import { errorMessage, hasErrorCode } from "@/lib/orpc-error";

/**
 * Handles errors for OPD and billing mutations.
 *
 * A conflict means the screen is stale. Refresh its appointment state before
 * showing the server message.
 */
export function useOpdErrorToast(orgSlug: string) {
  const queryClient = useQueryClient();

  return async (
    appointmentId: string,
    transition: OpdAppointmentTransition | "billing",
    error: unknown,
  ) => {
    if (!hasErrorCode(error, "CONFLICT")) {
      toast.error(errorMessage(error));
      return;
    }

    try {
      await (transition === "billing"
        ? invalidateBillingState(queryClient, orgSlug, appointmentId)
        : invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, transition));
    } catch {
      toast.error("Another terminal moved this appointment, and the refresh failed. Reload.");
      return;
    }
    toast.error(errorMessage(error));
  };
}
