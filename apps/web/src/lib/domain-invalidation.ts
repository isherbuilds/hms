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
      queryKey: orpc.dashboard.today.key({ input: { orgSlug } }),
    }),
  ];

  // A newly minted ID cannot already have a detail cache. Avoid issuing a
  // second detail request immediately after its route loader fetched it.
  if (transition !== "create") {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
      }),
    );
  }

  if (transition === "create" || transition === "checkIn" || transition === "cancel") {
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
      queryClient.invalidateQueries({
        queryKey: orpc.billing.openInvoices.key({ input: { orgSlug } }),
      }),
    );
  }
  return Promise.all(invalidations);
}

export function invalidatePatientState(
  queryClient: QueryInvalidator,
  orgSlug: string,
  patientId: string,
): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.patient.get.key({ input: { orgSlug, patientId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.patient.search.key({ input: { orgSlug } }),
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
      queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.patient.account.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.patient.visits.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.collections.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.worklist.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.billing.openInvoices.key({ input: { orgSlug } }),
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
