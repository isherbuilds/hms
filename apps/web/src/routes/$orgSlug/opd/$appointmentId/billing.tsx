import { authorize } from "@hms/auth/access";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ChargeCheckout } from "@/components/opd-billing/charge-checkout";
import { InvoiceAccount } from "@/components/opd-billing/invoice-account";
import { VoidChargeDialog } from "@/components/opd-billing/void-charge-dialog";
import { ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { useMembership } from "@/lib/membership";
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
  const invoices = useQuery({
    ...orpc.billing.listInvoices.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  });
  // From membership, not `settings.get`: the same currency, already loaded by the org
  // layout, and readable by a cashier who has no `settings:read` grant.
  const { roles, currency } = useMembership(orgSlug);
  const canCredit = authorize(roles, { billing: ["creditNote"] });
  const canWrite = authorize(roles, { billing: ["write"] });

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
      <BillingFreshness orgSlug={orgSlug} appointmentId={appointmentId} />
      {refreshError ? (
        <ErrorNote
          title="Billing data could not refresh"
          detail="Showing the last successful billing state. Your unsubmitted changes are preserved."
        />
      ) : null}

      {/* One list for both roles now that the counter cannot add to it: the
          cashier gets a Void column and the invoice beside it, nobody gets a
          catalog. */}
      <Panel label="Charges" minHeight="min-h-16">
        {pending.length === 0 ? (
          <PanelEmpty>No charge is waiting to be invoiced.</PanelEmpty>
        ) : (
          <ChargeCheckout
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            pending={pending}
            chargeRevision={record.appointment.chargeRevision}
            currency={currency}
            canSettle={canChangeCharges && canWrite}
            onVoid={setVoiding}
          />
        )}
      </Panel>

      {/* Each invoice already carries its own surface and its own actions, so
          the list stays flat: a card around a stack of boxes is noise. The
          hairline is what separates it from the tray above — the same rule the
          clinical tab follows. */}
      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="flex min-h-6 items-center text-muted-foreground">Invoices</h2>
        {invoices.data.length === 0 ? (
          <p className="text-muted-foreground">No invoice issued for this appointment yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {invoices.data.map((invoice) => (
              <InvoiceAccount
                key={invoice.id}
                orgSlug={orgSlug}
                appointmentId={appointmentId}
                invoice={invoice}
                canCredit={canCredit}
                canPay={canWrite}
              />
            ))}
          </div>
        )}
      </section>

      {canChangeCharges && canWrite ? (
        <ClientOnly fallback={null}>
          {voiding ? (
            <VoidChargeDialog
              charge={voiding}
              orgSlug={orgSlug}
              appointmentId={appointmentId}
              onClose={() => setVoiding(null)}
            />
          ) : null}
        </ClientOnly>
      ) : null}
    </>
  );
}

function BillingFreshness({ orgSlug, appointmentId }: { orgSlug: string; appointmentId: string }) {
  const { dataUpdatedAt } = useQuery({
    ...orpc.billing.listInvoices.queryOptions({ input: { orgSlug, appointmentId } }),
    enabled: false,
  });
  return <StaleDataNotice dataUpdatedAt={dataUpdatedAt} />;
}
