import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

export type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<unknown>;
};

export type OpdAppointmentTransition =
  | "billing"
  | "create"
  | "cancel"
  | "checkIn"
  | "noShow"
  | "reschedule";

export function invalidateOpdAppointmentState(
  queryClient: QueryInvalidator,
  orgSlug: string,
  appointmentId: string,
  transition: OpdAppointmentTransition,
): Promise<unknown[]> {
  const invalidations = [
    queryClient.invalidateQueries({
      queryKey: orpc.opd.day.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.today.key({ input: { orgSlug } }),
    }),
  ];

  if (transition === "create" || transition === "cancel") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.collections.key({ input: { orgSlug } }),
      }),
    );
  }
  if (transition !== "reschedule") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: orpc.billing.worklist.key({ input: { orgSlug } }),
      }),
    );
  }

  return Promise.all(invalidations);
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
