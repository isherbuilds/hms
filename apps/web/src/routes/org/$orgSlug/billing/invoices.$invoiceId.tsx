import { Button } from "@better-stack/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-stack/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";
import { z } from "zod";

import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/billing/invoices/$invoiceId")({
  validateSearch: z.object({ layout: z.enum(["thermal"]).optional() }),
  loader: ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    void queryClient.prefetchQuery(
      orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }),
    );
  },
  component: InvoicePrintRoute,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function splitTax(value: string) {
  const paise = Math.round(Number(value) * 100);
  const cgst = Math.floor((paise + 1) / 2);
  return { cgst: (cgst / 100).toFixed(2), sgst: ((paise - cgst) / 100).toFixed(2) };
}

function InvoicePrintRoute() {
  const { orgSlug, invoiceId } = Route.useParams();
  const { layout } = Route.useSearch();
  const query = useQuery(orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }));

  if (query.isPending)
    return (
      <div className="p-6 text-xs text-muted-foreground" aria-busy>
        Loading invoice…
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
        Could not load invoice: {query.error.message}
      </div>
    );

  const { invoice, lines, balance } = query.data;
  const isInr = invoice.currency === "INR";
  const taxSummary = Array.from(
    lines.reduce((groups, line) => {
      const current = groups.get(line.taxRatePercent) ?? { taxable: 0, tax: 0 };
      current.taxable += Math.round(Number(line.taxableValue) * 100);
      current.tax += Math.round(Number(line.taxAmount) * 100);
      groups.set(line.taxRatePercent, current);
      return groups;
    }, new Map<string, { taxable: number; tax: number }>()),
  );
  const thermal = layout === "thermal";

  return (
    <>
      <div className="print:hidden flex items-center justify-between border-b p-3">
        <div>
          <p className="text-sm font-medium">Invoice {invoice.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground">Snapshot print view</p>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <PrinterIcon data-icon="inline-start" />
          Print
        </Button>
      </div>
      <article
        data-billing-print
        className={`mx-auto bg-white p-6 text-[10px] leading-tight text-black ${thermal ? "max-w-[80mm]" : "max-w-[148mm]"}`}
      >
        <header className="border-b border-black pb-3 text-center">
          <h1 className="text-base font-bold">{invoice.orgLegalName}</h1>
          {invoice.orgAddress ? (
            <p className="mt-1 whitespace-pre-line">{invoice.orgAddress}</p>
          ) : null}
          {invoice.orgTaxId ? <p className="mt-1">Tax ID: {invoice.orgTaxId}</p> : null}
        </header>
        <div className="flex justify-between gap-4 border-b border-black py-3">
          <div>
            <p className="font-bold uppercase tracking-wider">Tax invoice</p>
            <p>{invoice.invoiceNumber}</p>
            <p>{dateFormatter.format(new Date(invoice.createdAt))}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold">{invoice.patientName}</p>
            <p>MRN {invoice.patientMrn}</p>
            <p>{invoice.patientPhone}</p>
            {invoice.patientAddress ? (
              <p className="whitespace-pre-line">{invoice.patientAddress}</p>
            ) : null}
          </div>
        </div>
        {thermal ? (
          <div className="flex flex-col gap-2 py-3">
            {lines.map((line) => (
              <div key={line.id} className="border-b border-dashed border-black pb-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">
                    {line.description} × {line.qty}
                  </span>
                  <span>{line.gross}</span>
                </div>
                <p>
                  Unit {line.unitPrice} · taxable {line.taxableValue} · tax {line.taxAmount} @{" "}
                  {line.taxRatePercent}%
                </p>
                {Number(line.allocatedDiscount) ? <p>Discount {line.allocatedDiscount}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right">{line.qty}</TableCell>
                    <TableCell className="text-right">{line.unitPrice}</TableCell>
                    <TableCell className="text-right">{line.lineSubtotal}</TableCell>
                    <TableCell className="text-right">{line.allocatedDiscount}</TableCell>
                    <TableCell className="text-right">{line.taxableValue}</TableCell>
                    <TableCell className="text-right">{line.taxRatePercent}%</TableCell>
                    <TableCell className="text-right">{line.taxAmount}</TableCell>
                    <TableCell className="text-right font-medium">{line.gross}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="grid gap-4 border-t border-black py-3 sm:grid-cols-2">
          <section>
            <p className="mb-1 font-bold">Tax summary</p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Rate</th>
                  <th className="text-right">Taxable</th>
                  {isInr ? (
                    <>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                    </>
                  ) : (
                    <th className="text-right">Tax</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {taxSummary.map(([rate, values]) => {
                  const split = splitTax((values.tax / 100).toFixed(2));
                  return (
                    <tr key={rate}>
                      <td>{rate}%</td>
                      <td className="text-right">{(values.taxable / 100).toFixed(2)}</td>
                      {isInr ? (
                        <>
                          <td className="text-right">{split.cgst}</td>
                          <td className="text-right">{split.sgst}</td>
                        </>
                      ) : (
                        <td className="text-right">{(values.tax / 100).toFixed(2)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-right">
            <dt>Subtotal</dt>
            <dd>{invoice.subtotal}</dd>
            <dt>Discount</dt>
            <dd>{invoice.discountAmount}</dd>
            {invoice.discountReason ? (
              <>
                <dt>Discount reason</dt>
                <dd>{invoice.discountReason}</dd>
              </>
            ) : null}
            <dt>Tax</dt>
            <dd>{invoice.taxTotal}</dd>
            <dt className="font-bold">Grand total</dt>
            <dd className="font-bold">
              {invoice.grandTotal} {invoice.currency}
            </dd>
          </dl>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-black pt-3 text-right">
          <dt>Paid</dt>
          <dd>{balance.paymentsTotal}</dd>
          <dt>Credited</dt>
          <dd>{balance.creditTotal}</dd>
          <dt>Refunded</dt>
          <dd>{balance.refundsTotal}</dd>
          <dt className="font-bold">
            {Number(balance.outstanding) < 0 ? "Refund due" : "Outstanding"}
          </dt>
          <dd className="font-bold">{Math.abs(Number(balance.outstanding)).toFixed(2)}</dd>
        </dl>
      </article>
      <style>{`@media print { @page { size: ${thermal ? "80mm auto" : "A5 portrait"}; margin: ${thermal ? "4mm" : "8mm"}; } body * { visibility: hidden !important; } [data-billing-print], [data-billing-print] * { visibility: visible !important; } [data-billing-print] { position: absolute; inset: 0; width: 100%; max-width: none; padding: 0; } }`}</style>
    </>
  );
}
