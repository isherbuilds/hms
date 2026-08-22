import { useQueryClient } from "@tanstack/react-query";

import { invalidateBillingState } from "@/lib/domain-invalidation";

export function useBillingInvalidation(orgSlug: string, appointmentId: string) {
  const queryClient = useQueryClient();

  /** Keep the mutation pending until charges, invoices and appointment state agree. */
  return (invoiceId?: string) =>
    invalidateBillingState(queryClient, orgSlug, appointmentId, invoiceId);
}
