import { useQueryClient } from "@tanstack/react-query";

import { invalidateBillingState } from "@/lib/domain-invalidation";

export function useBillingInvalidation(orgSlug: string, appointmentId: string) {
  const queryClient = useQueryClient();

  return (invoiceId?: string) =>
    invalidateBillingState(queryClient, orgSlug, appointmentId, invoiceId);
}
