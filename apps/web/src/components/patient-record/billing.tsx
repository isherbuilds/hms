import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { cn } from "@hms/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { ErrorNote } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

/**
 * Every invoice raised for this patient, with what is still open on each.
 * Invoices are issued per attendance, so before `patient.account` the only way
 * to answer "does this person owe anything" was to open each visit in turn.
 */
export function PatientBilling({ orgSlug, patientId }: { orgSlug: string; patientId: string }) {
  const { timeZone } = useOrgDateTime();
  const account = useQuery(orpc.patient.account.queryOptions({ input: { orgSlug, patientId } }));

  if (account.isPending) return null;
  if (account.isError) {
    return <ErrorNote title="Could not load billing" detail={account.error.message} />;
  }

  const { invoices, outstanding, openCount } = account.data;
  const [firstInvoice] = invoices;

  if (!firstInvoice) {
    return <p className="text-muted-foreground">No invoice has been raised for this patient.</p>;
  }
  const currency = firstInvoice.currency;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-muted-foreground">Outstanding</p>
        <p
          className={cn(
            "text-sm font-medium tabular-nums",
            openCount > 0 ? "text-clinical-alert" : undefined,
          )}
        >
          {formatMoney(outstanding, currency)}
        </p>
        <p className="text-muted-foreground">
          {openCount === 0
            ? "every invoice is settled"
            : `across ${openCount} open ${openCount === 1 ? "invoice" : "invoices"}`}
        </p>
      </section>

      <section className="rounded-xl bg-muted p-1">
        <p className="flex h-9 items-center px-3 text-xs text-muted-foreground">Invoices</p>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const due = Number(invoice.outstanding) !== 0;
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono whitespace-nowrap">
                      <Link
                        to="/$orgSlug/billing/invoices/$invoiceId"
                        params={{ orgSlug, invoiceId: invoice.id }}
                        className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(invoice.createdAt, timeZone)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(invoice.grandTotal, invoice.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(invoice.paymentsTotal, invoice.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        due ? "text-clinical-alert" : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(invoice.outstanding, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
