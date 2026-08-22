import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

export type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<unknown>;
};

export function invalidateOpdAppointmentState(
  queryClient: QueryInvalidator,
  orgSlug: string,
  appointmentId?: string,
): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.opd.queue.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.opd.appointments.key({ input: { orgSlug } }),
    }),
    ...(appointmentId
      ? [
          queryClient.invalidateQueries({
            queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
          }),
        ]
      : []),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.today.key({ input: { orgSlug } }),
    }),
    // OPD appointment creation may add the default consultation charge, and cancellation
    // voids pending charges, so both transitions can change these aggregates.
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.collections.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.worklist.key({ input: { orgSlug } }),
    }),
  ]);
}

export function invalidateBillingState(
  queryClient: QueryInvalidator,
  orgSlug: string,
  appointmentId: string,
  invoiceId?: string,
): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listPendingCharges.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.collections.key({ input: { orgSlug } }),
    }),
    // The organization-wide worklist counts this appointment in one of its two
    // lists whatever just happened to it, so every billing write moves it.
    queryClient.invalidateQueries({
      queryKey: orpc.billing.worklist.key({ input: { orgSlug } }),
    }),
    ...(invoiceId
      ? [
          queryClient.invalidateQueries({
            queryKey: orpc.billing.getInvoice.key({ input: { orgSlug, invoiceId } }),
          }),
        ]
      : []),
  ]);
}
