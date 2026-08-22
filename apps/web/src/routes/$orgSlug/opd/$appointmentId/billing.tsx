import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { OpdAppointmentStatusBadge } from "@/components/opd-appointment";
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

  if (detail.isPending || pending.isPending || invoices.isPending) {
    // A swallowed prefetch failure leaves this pending for a whole refetch, and
    // a blank page reads as a broken terminal. Static blocks, not a shimmer:
    // this is an all-day console and the wait is usually one frame.
    return (
      <>
        <PageHeader title="Billing" />
        <PageBody className="max-w-7xl">
          <div role="status" aria-label="Loading OPD billing" className="flex flex-col gap-4">
            <div className="h-24 bg-muted" />
            <div className="h-40 bg-muted" />
          </div>
        </PageBody>
      </>
    );
  }
  if (detail.isError || pending.isError || invoices.isError) {
    const error = detail.error ?? pending.error ?? invoices.error;
    return (
      <>
        <PageHeader title="Billing" />
        <ErrorNote title="Could not load OPD billing" detail={error?.message} inset />
      </>
    );
  }

  const { appointment, patient, practitioner } = detail.data;
  return (
    <>
      <PageHeader
        title={
          appointment.tokenNumber != null
            ? `Token ${appointment.tokenNumber}`
            : "Booked appointment"
        }
        description={
          patient ? (
            <Link
              to="/$orgSlug/patients/$patientId"
              params={{ orgSlug, patientId: patient.id }}
              className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
            >
              {`${patient.name} · ${patient.mrn}`}
            </Link>
          ) : (
            `${appointment.callerName ?? "Unnamed caller"} · ${appointment.callerPhone ?? "No phone"}`
          )
        }
        action={
          <div className="flex flex-wrap items-center gap-1">
            <StaleDataNotice
              dataUpdatedAt={Math.min(
                detail.dataUpdatedAt,
                pending.dataUpdatedAt,
                invoices.dataUpdatedAt,
              )}
            />
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Add charge
            </Button>
            <Button
              size="sm"
              disabled={pending.data.length === 0}
              onClick={() => setInvoiceOpen(true)}
            >
              Issue invoice
            </Button>
          </div>
        }
      />
      <PageBody className="max-w-7xl">
        <section className="grid gap-px bg-border ring-1 ring-border sm:grid-cols-4">
          <Detail label="Patient">
            {patient ? (
              <>
                <p className="font-medium">{patient.name}</p>
                <p className="text-muted-foreground">
                  {patient.mrn} · {patient.phone}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">{appointment.callerName ?? "Unnamed caller"}</p>
                <p className="text-muted-foreground">
                  {appointment.callerPhone ?? "No phone"} · Linked at check-in
                </p>
              </>
            )}
          </Detail>
          <Detail label="Practitioner">{practitioner.name}</Detail>
          <Detail label="Status">
            <OpdAppointmentStatusBadge status={appointment.status} />
          </Detail>
          <Detail label="Token">
            {appointment.tokenNumber != null ? (
              // text-2xl deviates from the type scale: the token is what desk
              // staff and patients match at a glance, so it reads as a headline.
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {appointment.tokenNumber}
              </span>
            ) : (
              <span className="text-muted-foreground">Assigned at check-in</span>
            )}
          </Detail>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Pending charges</h2>
          <div className="overflow-x-auto ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No pending charges.
                    </TableCell>
                  </TableRow>
                ) : (
                  pending.data.map((charge) => (
                    <TableRow key={charge.id}>
                      <TableCell className="font-medium">{charge.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(charge.unitPrice, currency)}
                      </TableCell>
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
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Invoices</h2>
          {invoices.data.length === 0 ? (
            <div className="border border-dashed px-4 py-8 text-center text-muted-foreground">
              No invoices issued for this OPD appointment.
            </div>
          ) : (
            invoices.data.map((invoice) => (
              <InvoiceAccount
                key={invoice.id}
                orgSlug={orgSlug}
                appointmentId={appointmentId}
                invoice={invoice}
                canCredit={canCredit}
              />
            ))
          )}
        </section>
      </PageBody>
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
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-background p-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
