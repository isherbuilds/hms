import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { Separator } from "@hms/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  AddChargeDialog,
  IssueInvoiceDialog,
  VoidChargeDialog,
} from "@/components/opd-billing/charge-dialogs";
import { InvoiceAccount } from "@/components/opd-billing/invoice-account";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";

import {
  OpdRecordDescription,
  OpdRecordFacts,
  OpdRecordSummary,
  OpdRecordTabs,
  RecordCard,
  RecordEmpty,
} from "./route";

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId/billing")({
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    const invoiceList = orpc.billing.listInvoices.queryOptions({
      input: { orgSlug, appointmentId },
    });
    await Promise.all([
      loadRouteQuery(
        queryClient.fetchQuery(orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } })),
      ),
      loadRouteQuery(
        queryClient.fetchQuery(orpc.settings.get.queryOptions({ input: { orgSlug } })),
      ),
      queryClient.prefetchQuery(
        orpc.billing.listPendingCharges.queryOptions({ input: { orgSlug, appointmentId } }),
      ),
      queryClient.prefetchQuery(invoiceList).then(() => {
        // Each invoice row also reads its own receipts, credit notes and
        // refunds, which the list does not carry. Started here so the rows
        // hydrate warm, and deliberately not awaited: the page is usable
        // without them, so they must never hold up the navigation.
        for (const invoice of queryClient.getQueryData(invoiceList.queryKey) ?? []) {
          void queryClient.prefetchQuery(
            orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
          );
        }
      }),
    ]);
  },
  component: BillingOpdAppointmentRoute,
});

function BillingOpdAppointmentRoute() {
  const { orgSlug, appointmentId } = Route.useParams();
  const [addOpen, setAddOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; description: string } | null>(null);
  const detailQuery = {
    ...orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  };
  const detail = useQuery(detailQuery);
  const pendingQuery = {
    ...orpc.billing.listPendingCharges.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  };
  const pending = useQuery(pendingQuery);
  const invoicesQuery = {
    ...orpc.billing.listInvoices.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  };
  const invoices = useQuery(invoicesQuery);
  const settings = useSuspenseQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const canCredit = authorize(membership.data.roles, { billing: ["creditNote"] });
  const currency = settings.data.currency;

  // Both tabs render the same title band in every state, so a cashier switching
  // views never sees the record's identity move.
  if (detail.isPending || pending.isPending || invoices.isPending) {
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <PageBody className="mx-auto w-full max-w-5xl" />
      </>
    );
  }
  if (detail.isError || pending.isError || invoices.isError) {
    const error = detail.error ?? pending.error ?? invoices.error;
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <ErrorNote title="Could not load outpatient billing" detail={error?.message} inset />
      </>
    );
  }

  const canChangeCharges = detail.data.appointment.status === "checked_in";

  return (
    <>
      <PageHeader
        title="Outpatient appointment"
        description={<OpdRecordDescription orgSlug={orgSlug} record={detail.data} />}
        action={
          <>
            <StaleDataNotice
              dataUpdatedAt={Math.min(
                detail.dataUpdatedAt,
                pending.dataUpdatedAt,
                invoices.dataUpdatedAt,
              )}
            />
            {canChangeCharges ? (
              <>
                <Button variant="outline" onClick={() => setAddOpen(true)}>
                  Add charge
                </Button>
                <Button disabled={pending.data.length === 0} onClick={() => setInvoiceOpen(true)}>
                  Issue invoice
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
      <PageBody className="mx-auto w-full max-w-5xl">
        <OpdRecordSummary record={detail.data} />

        <Separator />
        <OpdRecordFacts record={detail.data} />

        <Separator />
        <RecordCard label="Pending charges">
          {pending.data.length === 0 ? (
            <RecordEmpty>No charge is waiting to be invoiced.</RecordEmpty>
          ) : (
            // The same grid as the clinical tab's Charges card, so the two
            // views of one appointment's money line up column for column.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-36 text-right">Unit price</TableHead>
                  {canChangeCharges ? (
                    <TableHead className="w-28 text-right">Action</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.data.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(charge.unitPrice, currency)}
                    </TableCell>
                    {canChangeCharges ? (
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setVoiding({ id: charge.id, description: charge.description })
                          }
                        >
                          Void
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </RecordCard>

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
                />
              ))}
            </div>
          )}
        </section>
      </PageBody>
      {canChangeCharges ? (
        <ClientOnly fallback={null}>
          <AddChargeDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            currency={currency}
          />
          <IssueInvoiceDialog
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
          />
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
