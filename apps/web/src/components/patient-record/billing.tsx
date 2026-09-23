import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { AdvanceForm, AdvanceReceiptLink, AdvanceRefundDialog } from "@/components/advance-form";
import { DataList, ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { useCan } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { formatBusinessDate, formatDate, useOrgDateTime } from "@/lib/org-datetime";

type PatientAccount = {
  invoices: {
    id: string;
    invoiceNumber: string;
    grandTotal: bigint;
    currency: string;
    createdAt: string | Date;
    paymentsTotal: bigint;
    allocationsTotal: bigint;
    outstanding: bigint;
  }[];
  openCount: number;
  outstanding: bigint;
  creditHeld: bigint;
  advanceReceipts: Array<{
    id: string;
    receiptNumber: string;
    purpose: string;
    businessDate: string;
    currency: string;
    amount: bigint;
    remaining: bigint;
  }>;
  /** Vouchers already issued against those receipts, so each one stays reprintable. */
  advanceRefunds: Array<{
    id: string;
    advanceReceiptId: string;
    amount: bigint;
    businessDate: string;
  }>;
};

export function PatientBilling({
  orgSlug,
  account,
  error,
  patientId,
  plans,
  currency,
}: {
  orgSlug: string;
  account: PatientAccount | undefined;
  error: Error | null;
  patientId: string;
  plans: Array<{ id: string; label: string }>;
  currency: string;
}) {
  const { timeZone } = useOrgDateTime();
  const canTakeAdvance = useCan(orgSlug, { billing: ["write"] });
  const canRefundAdvance = useCan(orgSlug, { billing: ["advanceRefund"] });

  const [refundReceipt, setRefundReceipt] = useState<
    PatientAccount["advanceReceipts"][number] | null
  >(null);

  const [firstInvoice] = account?.invoices ?? [];
  const isRefundDue = account !== undefined && account.outstanding < ZERO;

  const refundsByReceipt = Map.groupBy(
    account?.advanceRefunds ?? [],
    (refund) => refund.advanceReceiptId,
  );

  const refundLinks = (receipt: { id: string; currency: string }) =>
    refundsByReceipt.get(receipt.id)?.map((voucher) => (
      <span key={voucher.id} className="block text-muted-foreground tabular-nums">
        <AdvanceReceiptLink
          orgSlug={orgSlug}
          id={receipt.id}
          refundId={voucher.id}
          label={`Refunded ${formatMoney(voucher.amount, receipt.currency)}`}
        />
        {` · ${formatBusinessDate(voucher.businessDate)}`}
      </span>
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground">Credit held</p>
        {account ? (
          <p className="text-xs font-medium tabular-nums">
            {formatMoney(account.creditHeld, currency)}
          </p>
        ) : null}
        {canTakeAdvance ? (
          <div className="ml-auto">
            <AdvanceForm orgSlug={orgSlug} patientId={patientId} plans={plans} />
          </div>
        ) : null}
      </section>

      {error ? <ErrorNote title="Could not load billing" error={error} /> : null}

      {account && firstInvoice ? (
        <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-muted-foreground">{isRefundDue ? "Refund due" : "Outstanding"}</p>
          <p
            className={cn(
              "text-xs font-medium tabular-nums",
              isRefundDue
                ? "text-destructive"
                : account.openCount > 0
                  ? "text-clinical-alert"
                  : undefined,
            )}
          >
            {formatMoney(
              isRefundDue ? -account.outstanding : account.outstanding,
              firstInvoice.currency,
            )}
          </p>
          <p className="text-muted-foreground tabular-nums">
            {account.openCount === 0
              ? "every invoice is settled"
              : `across ${account.openCount} open ${account.openCount === 1 ? "invoice" : "invoices"}`}
          </p>
        </section>
      ) : null}

      <Panel grow label="Invoices">
        {account && !firstInvoice ? <PanelEmpty>No invoices yet</PanelEmpty> : null}
        {account && firstInvoice ? (
          <DataList
            rows={account.invoices}
            rowKey={(invoice) => invoice.id}
            link={(invoice) => ({
              to: "/$orgSlug/billing/invoices/$invoiceId",
              params: { orgSlug, invoiceId: invoice.id },
            })}
            columns={[
              {
                head: "Invoice",
                cell: (invoice) => <span className="font-mono">{invoice.invoiceNumber}</span>,
              },
              {
                head: "Issued",
                cell: (invoice) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {formatDate(invoice.createdAt, timeZone)}
                  </span>
                ),
              },
              {
                head: "Total",
                className: "text-right",
                cell: (invoice) => (
                  <span className="tabular-nums">
                    {formatMoney(invoice.grandTotal, invoice.currency)}
                  </span>
                ),
              },
              {
                head: "Paid / credit",
                className: "text-right",
                cell: (invoice) => (
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(
                      invoice.paymentsTotal + invoice.allocationsTotal,
                      invoice.currency,
                    )}
                  </span>
                ),
              },
              {
                head: "Balance",
                className: "text-right",
                cell: (invoice) => (
                  <span
                    className={cn(
                      "tabular-nums",
                      invoice.outstanding !== ZERO
                        ? "text-clinical-alert"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatMoney(invoice.outstanding, invoice.currency)}
                  </span>
                ),
              },
              {
                head: "",
                className: "w-8",
                mobile: "hidden",
                cell: () => <ChevronRightIcon className="size-3.5 text-muted-foreground" />,
              },
            ]}
          />
        ) : null}
      </Panel>
      <details className="group max-h-[50%] shrink-0 overflow-y-auto">
        <summary
          data-focus-inset
          className="flex cursor-pointer list-none items-center gap-2 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden"
        >
          <ChevronRightIcon aria-hidden="true" className="size-3.5 group-open:rotate-90" />
          Advance receipts
          {account ? (
            <span className="tabular-nums">({account.advanceReceipts.length})</span>
          ) : null}
        </summary>
        <Panel label="Advance receipts">
          {account && account.advanceReceipts.length === 0 ? (
            <PanelEmpty>No advance receipts yet</PanelEmpty>
          ) : null}
          {account && account.advanceReceipts.length > 0 ? (
            <DataList
              rows={account.advanceReceipts}
              rowKey={(receipt) => receipt.id}
              columns={[
                {
                  head: "Receipt",
                  cell: (receipt) => (
                    <>
                      <AdvanceReceiptLink
                        orgSlug={orgSlug}
                        id={receipt.id}
                        label={receipt.receiptNumber}
                      />
                      {refundLinks(receipt)}
                    </>
                  ),
                },
                { head: "Purpose", cell: (receipt) => receipt.purpose },
                {
                  head: "Issued",
                  cell: (receipt) => (
                    <span className="tabular-nums">{formatBusinessDate(receipt.businessDate)}</span>
                  ),
                },
                {
                  head: "Amount",
                  className: "text-right",
                  cell: (receipt) => (
                    <span className="tabular-nums">
                      {formatMoney(receipt.amount, receipt.currency)}
                    </span>
                  ),
                },
                {
                  head: "Available",
                  className: "text-right",
                  mobile: "title",
                  cell: (receipt) => (
                    <span className="tabular-nums">
                      {formatMoney(receipt.remaining, receipt.currency)}
                    </span>
                  ),
                },
              ]}
              action={
                canRefundAdvance
                  ? (receipt) =>
                      receipt.remaining > ZERO ? (
                        <Button size="xs" variant="ghost" onClick={() => setRefundReceipt(receipt)}>
                          Refund
                        </Button>
                      ) : null
                  : undefined
              }
            />
          ) : null}
          {refundReceipt ? (
            <AdvanceRefundDialog
              orgSlug={orgSlug}
              receipt={refundReceipt}
              onClose={() => setRefundReceipt(null)}
            />
          ) : null}
        </Panel>
      </details>
    </div>
  );
}
