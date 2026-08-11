import { Button } from "@hms/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";

import { orpc } from "@/lib/orpc";

export const Route = createFileRoute(
  "/org/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId",
)({
  loader: ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    void queryClient.prefetchQuery(
      orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }),
    );
  },
  component: ReceiptPrintRoute,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function ReceiptPrintRoute() {
  const { orgSlug, invoiceId, paymentId } = Route.useParams();
  const query = useQuery(orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }));
  if (query.isPending)
    return (
      <div className="p-6 text-xs text-muted-foreground" aria-busy>
        Loading receipt…
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
        Could not load receipt: {query.error.message}
      </div>
    );
  const payment = query.data.payments.find((row) => row.id === paymentId);
  if (!payment)
    return (
      <div className="m-4 border border-dashed p-6 text-center text-xs text-muted-foreground">
        Receipt not found.
      </div>
    );
  const { invoice, balance } = query.data;
  return (
    <>
      <div className="print:hidden flex justify-end border-b p-3">
        <Button size="sm" onClick={() => window.print()}>
          <PrinterIcon data-icon="inline-start" />
          Print
        </Button>
      </div>
      <article
        data-billing-print
        className="mx-auto max-w-[148mm] bg-white p-6 text-[11px] leading-tight text-black"
      >
        <header className="border-b border-black pb-3 text-center">
          <h1 className="text-base font-bold">{invoice.orgLegalName}</h1>
          {invoice.orgAddress ? (
            <p className="mt-1 whitespace-pre-line">{invoice.orgAddress}</p>
          ) : null}
          {invoice.orgTaxId ? <p>Tax ID: {invoice.orgTaxId}</p> : null}
        </header>
        <div className="py-4 text-center">
          <p className="font-bold uppercase tracking-widest">Payment receipt</p>
          <p className="mt-1 text-lg font-bold">{payment.receiptNumber}</p>
        </div>
        <dl className="grid grid-cols-[36mm_1fr] gap-x-4 gap-y-2 border-y border-black py-4">
          <dt className="font-semibold">Date</dt>
          <dd>{dateFormatter.format(new Date(payment.createdAt))}</dd>
          <dt className="font-semibold">Received from</dt>
          <dd>
            {invoice.patientName} · {invoice.patientMrn}
          </dd>
          <dt className="font-semibold">Against invoice</dt>
          <dd>{invoice.invoiceNumber}</dd>
          <dt className="font-semibold">Method</dt>
          <dd className="uppercase">{payment.method}</dd>
          {payment.reference ? (
            <>
              <dt className="font-semibold">Reference</dt>
              <dd>{payment.reference}</dd>
            </>
          ) : null}
          <dt className="font-semibold">Amount</dt>
          <dd className="text-lg font-bold">
            {payment.amount} {invoice.currency}
          </dd>
        </dl>
        <div className="flex justify-between gap-4 pt-4">
          <span>Outstanding after all activity</span>
          <strong>
            {balance.outstanding} {invoice.currency}
          </strong>
        </div>
      </article>
      <style>{`@media print { @page { size: A5 portrait; margin: 10mm; } body * { visibility: hidden !important; } [data-billing-print], [data-billing-print] * { visibility: visible !important; } [data-billing-print] { position: fixed; inset: 0; width: 100%; max-width: none; padding: 0; } }`}</style>
    </>
  );
}
