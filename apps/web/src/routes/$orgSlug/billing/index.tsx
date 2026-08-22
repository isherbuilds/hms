import { Badge } from "@hms/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatMoney } from "@/lib/money";
import { formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/$orgSlug/billing/")({
  head: () => ({ meta: [{ title: "Billing · HMS" }] }),
  loader: ({ context: { queryClient }, params: { orgSlug } }) =>
    queryClient.ensureQueryData(orpc.billing.worklist.queryOptions({ input: { orgSlug } })),
  component: BillingIndexRoute,
});

/**
 * The cashier's day in two lists: bills nobody has raised, and bills nobody has
 * paid. They stay separate because they are separate jobs — one ends in an
 * invoice, the other in a receipt — and a merged list would need a row shape
 * that means something different in each half.
 *
 * Oldest first in both, because the thing that has waited longest is the thing
 * most likely to walk out unbilled.
 */
function BillingIndexRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const worklist = useQuery({
    ...orpc.billing.worklist.queryOptions({ input: { orgSlug } }),
    ...OPERATIONAL_REFETCH,
  });

  return (
    <>
      <PageHeader
        title="Billing"
        description="Money owed to the hospital right now"
        action={<StaleDataNotice dataUpdatedAt={worklist.dataUpdatedAt} />}
      />
      <PageBody>
        {worklist.isPending ? (
          <div role="status" aria-label="Loading billing worklist" className="flex flex-col gap-4">
            <div className="h-40 rounded-xl bg-muted" />
            <div className="h-40 rounded-xl bg-muted" />
          </div>
        ) : worklist.isError ? (
          <ErrorNote title="Could not load the billing worklist" detail={worklist.error.message} />
        ) : (
          <>
            <Section
              title="To bill"
              count={worklist.data.unbilled.length}
              empty="Every charge raised today has been invoiced."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Token</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Practitioner</TableHead>
                    <TableHead>Charges</TableHead>
                    <TableHead className="text-right">Pending value</TableHead>
                    <TableHead>Waiting since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worklist.data.unbilled.map((row) => (
                    <TableRow key={row.appointmentId}>
                      <TableCell>
                        <Link
                          to="/$orgSlug/opd/$appointmentId/billing"
                          params={{ orgSlug, appointmentId: row.appointmentId }}
                          className="font-mono font-medium tabular-nums underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {row.tokenNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{row.patientName}</span>
                        <p className="text-xs text-muted-foreground">{row.patientMrn}</p>
                      </TableCell>
                      <TableCell>{row.practitionerName}</TableCell>
                      <TableCell className="tabular-nums">{row.chargeCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.pendingValue, worklist.data.currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTime(row.oldestChargeAt, timeZone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <Section
              title="Awaiting payment"
              count={worklist.data.unpaid.length}
              empty="No issued invoice is outstanding."
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="w-20">Token</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Issued</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worklist.data.unpaid.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Link
                          to="/$orgSlug/opd/$appointmentId/billing"
                          params={{ orgSlug, appointmentId: invoice.appointmentId }}
                          className="font-mono font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{invoice.patientName}</span>
                        <p className="text-xs text-muted-foreground">{invoice.patientMrn}</p>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {invoice.tokenNumber}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoice.grandTotal, invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoice.paid, invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(invoice.outstanding, invoice.currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTime(invoice.createdAt, timeZone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </>
        )}
      </PageBody>
    </>
  );
}

/** Same muted tray + inset card as the OPD queue, so the two boards read alike. */
function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-40 flex-col rounded-xl bg-muted p-1">
      <div className="flex h-9 items-center gap-2 px-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <Badge variant={count === 0 ? "muted" : "secondary"}>{count}</Badge>
      </div>
      <div className="min-h-32 overflow-x-auto rounded-lg border border-border bg-card">
        {count === 0 ? (
          <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
