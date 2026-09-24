import { authorize } from "@hms/auth/access";
import { skipToken, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ChargeCheckout } from "@/components/opd-billing/charge-checkout";
import { AdvanceForm } from "@/components/advance-form";
import { InvoiceAccount } from "@/components/opd-billing/invoice-account";
import { VoidChargeDialog } from "@/components/opd-billing/void-charge-dialog";
import { ErrorNote } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";

import { useOpdRecord } from "@/lib/opd-record";

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId/billing")({
  remountDeps: ({ params }) => ({ appointmentId: params.appointmentId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    // The record itself is the layout's; this tab loads what only it reads.
    await queryClient
      .query(orpc.billing.listInvoices.queryOptions({ input: { orgSlug, appointmentId } }))
      .catch(() => {});
  },
  component: BillingOpdAppointmentRoute,
});

function BillingOpdAppointmentRoute() {
  const { orgSlug, appointmentId } = Route.useParams();
  const { record, refreshError: recordRefreshError } = useOpdRecord();
  const [voiding, setVoiding] = useState<{ id: string; description: string } | null>(null);
  const patientId = record.patient?.id;

  // From membership, not `settings.get`: the same currency, already loaded by the org
  // layout, and readable by a cashier who has no `settings:read` grant.
  const { roles, currency } = useMembership(orgSlug);
  const canCredit = authorize(roles, { billing: ["creditNote"] });
  const canWrite = authorize(roles, { billing: ["write"] });
  const canReadPlans = authorize(roles, { treatment: ["read"] });

  const invoices = useQuery({
    ...orpc.billing.listInvoices.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  });

  // The layout prefetches this key; the plan summary and advance form share it.
  const plans = useQuery(
    orpc.treatment.listForPatient.queryOptions({
      input: canReadPlans && patientId ? { orgSlug, patientId } : skipToken,
    }),
  );

  const openPlans = plans.data?.filter((plan) => plan.status === "open");

  const linkedPlan = plans.data?.find((plan) => plan.id === record.appointment.treatmentPlanId);

  // The layout has proven the record; only the invoice list can be missing here.
  if (!invoices.data) {
    return invoices.error ? (
      <ErrorNote title="Could not load outpatient billing" error={invoices.error} />
    ) : null;
  }

  const refreshError = recordRefreshError ?? invoices.error;
  const canChangeCharges = record.appointment.status === "checked_in";
  const pending = record.charges.filter((charge) => charge.status === "pending");

  return (
    <>
      <StaleDataNotice dataUpdatedAt={invoices.dataUpdatedAt} />
      {refreshError ? (
        <ErrorNote
          title="Billing data could not refresh"
          detail="Showing the last successful billing state. Your unsubmitted changes are preserved."
        />
      ) : null}

      {linkedPlan || (canWrite && patientId && openPlans) ? (
        <section className="flex items-center justify-between gap-2">
          {linkedPlan ? (
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-muted-foreground">Treatment plan · {linkedPlan.label}</h2>
              <p className="tabular-nums">
                {formatMoney(linkedPlan.postedAmount, currency)} of{" "}
                {formatMoney(linkedPlan.quotedTotal, currency)} billed
              </p>
            </div>
          ) : null}
          {canWrite && patientId && openPlans ? (
            <div className="ml-auto shrink-0">
              <AdvanceForm
                orgSlug={orgSlug}
                patientId={patientId}
                plans={openPlans}
                linkedPlanId={record.appointment.treatmentPlanId ?? undefined}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* One list for both roles now that the counter cannot add to it: the
          cashier gets a Void column and the invoice beside it, nobody gets a
          catalog. Flat like Invoices below; a card around a table is noise. */}
      <section className="flex flex-col gap-2">
        <h2 className="flex min-h-6 items-center text-muted-foreground">Charges</h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground">No pending charges</p>
        ) : (
          <ChargeCheckout
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            patientId={patientId}
            pending={pending}
            chargeRevision={record.appointment.chargeRevision}
            currency={currency}
            canSettle={canChangeCharges && canWrite}
            onVoid={setVoiding}
          />
        )}
      </section>

      {/* Each invoice already carries its own surface and its own actions, so
          the list stays flat: a card around a stack of boxes is noise. The
          hairline is what separates it from the tray above — the same rule the
          clinical tab follows. */}
      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="flex min-h-6 items-center text-muted-foreground">Invoices</h2>
        {invoices.data.length === 0 ? (
          <p className="text-muted-foreground">No invoices yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            {invoices.data.map((invoice) => (
              <InvoiceAccount
                key={invoice.id}
                orgSlug={orgSlug}
                invoice={invoice}
                canCredit={canCredit}
                canPay={canWrite}
              />
            ))}
          </div>
        )}
      </section>

      {canChangeCharges && canWrite && voiding ? (
        <VoidChargeDialog charge={voiding} orgSlug={orgSlug} onClose={() => setVoiding(null)} />
      ) : null}
    </>
  );
}
