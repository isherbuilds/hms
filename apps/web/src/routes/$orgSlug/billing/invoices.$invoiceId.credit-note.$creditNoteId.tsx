import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";

import { orpc } from "@/lib/orpc";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { loadRouteQuery } from "@/lib/orpc-error";

export const Route = createFileRoute(
  "/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId",
)({
  loader: async ({ context: { queryClient }, params: { orgSlug, invoiceId, creditNoteId } }) => {
    const data = await loadRouteQuery(
      queryClient.fetchQuery(
        orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }),
      ),
    );
    // The browser seeds the "Save as PDF" filename from document.title, so the
    // printed document names itself rather than every file landing as "HMS".
    return {
      documentNumber: data.creditNotes.find((note) => note.id === creditNoteId)?.creditNoteNumber,
    };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.documentNumber ?? "Credit note"} · Credit note · HMS` }],
  }),
  component: CreditNotePrintRoute,
});

function splitTax(value: string) {
  const paise = Math.round(Number(value) * 100);
  const cgst = Math.floor((paise + 1) / 2);
  return { cgst: (cgst / 100).toFixed(2), sgst: ((paise - cgst) / 100).toFixed(2) };
}

function CreditNotePrintRoute() {
  const { orgSlug, invoiceId, creditNoteId } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const query = useQuery(orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }));
  if (query.isPending) return null;
  if (query.isError)
    return (
      <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
        Could not load credit note: {query.error.message}
      </div>
    );
  const note = query.data.creditNotes.find((row) => row.id === creditNoteId);
  if (!note)
    return (
      <div className="m-4 border border-dashed p-6 text-center text-xs text-muted-foreground">
        Credit note not found.
      </div>
    );
  const { invoice } = query.data;
  const lineSnapshots = new Map(query.data.lines.map((line) => [line.id, line]));
  const isInr = invoice.currency === "INR";
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
        className="mx-auto max-w-[148mm] bg-white p-6 text-[10px] leading-tight text-black"
      >
        <header className="border-b border-black pb-3 text-center">
          <h1 className="text-base font-bold">{invoice.orgLegalName}</h1>
          {invoice.orgAddress ? (
            <p className="mt-1 whitespace-pre-line">{invoice.orgAddress}</p>
          ) : null}
          {invoice.orgTaxId ? <p>Tax ID: {invoice.orgTaxId}</p> : null}
        </header>
        <div className="flex justify-between gap-4 border-b border-black py-3">
          <div>
            <p className="font-bold uppercase tracking-widest">Credit note</p>
            <p className="text-sm font-bold">{note.creditNoteNumber}</p>
            <p>{formatDateTime(note.createdAt, timeZone)}</p>
          </div>
          <div className="text-right">
            <p>Against {invoice.invoiceNumber}</p>
            <p className="font-semibold">{invoice.patientName}</p>
            <p>MRN {invoice.patientMrn}</p>
          </div>
        </div>
        <p className="border-b border-black py-3">
          <strong>Reason:</strong> {note.reason}
        </p>
        <div className="py-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                {isInr ? (
                  <>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                  </>
                ) : (
                  <TableHead className="text-right">Tax</TableHead>
                )}
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {note.lines.map((line) => {
                const split = splitTax(line.taxAmount);
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      {lineSnapshots.get(line.invoiceLineId)?.description ?? "Invoice line"}
                    </TableCell>
                    <TableCell className="text-right">{line.taxableValue}</TableCell>
                    {isInr ? (
                      <>
                        <TableCell className="text-right">{split.cgst}</TableCell>
                        <TableCell className="text-right">{split.sgst}</TableCell>
                      </>
                    ) : (
                      <TableCell className="text-right">{line.taxAmount}</TableCell>
                    )}
                    <TableCell className="text-right font-medium">{line.gross}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <dl className="ml-auto grid max-w-52 grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-black pt-3 text-right">
          <dt>Taxable</dt>
          <dd>{note.subtotal}</dd>
          <dt>Tax</dt>
          <dd>{note.taxTotal}</dd>
          <dt className="font-bold">Credit total</dt>
          <dd className="font-bold">
            {note.total} {invoice.currency}
          </dd>
        </dl>
      </article>
      <style>{`@media print { @page { size: A5 portrait; margin: 9mm; } body * { visibility: hidden !important; } [data-billing-print], [data-billing-print] * { visibility: visible !important; } [data-billing-print] { position: fixed; inset: 0; width: 100%; max-width: none; padding: 0; } }`}</style>
    </>
  );
}
