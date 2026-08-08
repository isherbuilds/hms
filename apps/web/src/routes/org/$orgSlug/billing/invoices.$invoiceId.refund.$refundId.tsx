import { Button } from "@better-stack/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";

import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/billing/invoices/$invoiceId/refund/$refundId")({
  loader: ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    void queryClient.prefetchQuery(
      orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }),
    );
  },
  component: RefundPrintRoute,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function RefundPrintRoute() {
  const { orgSlug, invoiceId, refundId } = Route.useParams();
  const query = useQuery(orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }));
  if (query.isPending)
    return (
      <div className="p-6 text-xs text-muted-foreground" aria-busy>
        Loading refund voucher…
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
        Could not load refund voucher: {query.error.message}
      </div>
    );
  const refund = query.data.refunds.find((row) => row.id === refundId);
  if (!refund)
    return (
      <div className="m-4 border border-dashed p-6 text-center text-xs text-muted-foreground">
        Refund voucher not found.
      </div>
    );
  const { invoice } = query.data;
  const creditNote = query.data.creditNotes.find((note) => note.id === refund.creditNoteId);
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
          <p className="font-bold uppercase tracking-widest">Refund voucher</p>
          <p className="mt-1 text-lg font-bold">{refund.refundNumber}</p>
        </div>
        <dl className="grid grid-cols-[38mm_1fr] gap-x-4 gap-y-2 border-y border-black py-4">
          <dt className="font-semibold">Date</dt>
          <dd>{dateFormatter.format(new Date(refund.createdAt))}</dd>
          <dt className="font-semibold">Refunded to</dt>
          <dd>
            {invoice.patientName} · {invoice.patientMrn}
          </dd>
          <dt className="font-semibold">Invoice</dt>
          <dd>{invoice.invoiceNumber}</dd>
          <dt className="font-semibold">Credit note</dt>
          <dd>{creditNote?.creditNoteNumber ?? "—"}</dd>
          <dt className="font-semibold">Method</dt>
          <dd className="uppercase">{refund.method}</dd>
          {refund.reference ? (
            <>
              <dt className="font-semibold">Reference</dt>
              <dd>{refund.reference}</dd>
            </>
          ) : null}
          <dt className="font-semibold">Amount</dt>
          <dd className="text-lg font-bold">
            {refund.amount} {invoice.currency}
          </dd>
        </dl>
      </article>
      <style>{`@media print { @page { size: A5 portrait; margin: 10mm; } body * { visibility: hidden !important; } [data-billing-print], [data-billing-print] * { visibility: visible !important; } [data-billing-print] { position: fixed; inset: 0; width: 100%; max-width: none; padding: 0; } }`}</style>
    </>
  );
}
