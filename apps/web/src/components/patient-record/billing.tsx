import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { AdvanceForm, AdvanceReceiptLink, AdvanceRefundDialog } from "@/components/advance-form";
import { ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { useCan } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { formatBusinessDate, formatDate, useOrgDateTime } from "@/lib/org-datetime";

export type PatientAccount = {
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
      <p key={voucher.id} className="text-muted-foreground">
        <AdvanceReceiptLink
          orgSlug={orgSlug}
          id={receipt.id}
          refundId={voucher.id}
          label={`Refunded ${formatMoney(voucher.amount, receipt.currency)}`}
        />
        {` · ${formatBusinessDate(voucher.businessDate)}`}
      </p>
    ));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground">Credit held</p>
        {account ? (
          <p className="text-sm font-medium tabular-nums">
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

      <Panel label="Advance receipts">
        {account && account.advanceReceipts.length === 0 ? (
          <PanelEmpty>No advance receipt has been recorded for this patient.</PanelEmpty>
        ) : null}
        {account && account.advanceReceipts.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    {canRefundAdvance ? <TableHead className="w-20" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.advanceReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell>
                        <AdvanceReceiptLink
                          orgSlug={orgSlug}
                          id={receipt.id}
                          label={receipt.receiptNumber}
                        />
                        {refundLinks(receipt)}
                      </TableCell>
                      <TableCell>{receipt.purpose}</TableCell>
                      <TableCell>{formatBusinessDate(receipt.businessDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(receipt.amount, receipt.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(receipt.remaining, receipt.currency)}
                      </TableCell>
                      {canRefundAdvance ? (
                        <TableCell>
                          {receipt.remaining > ZERO ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setRefundReceipt(receipt)}
                            >
                              Refund
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul role="list" className="md:hidden">
              {account.advanceReceipts.map((receipt) => (
                <li key={receipt.id} className="border-b px-3 py-2 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <AdvanceReceiptLink
                      orgSlug={orgSlug}
                      id={receipt.id}
                      label={receipt.receiptNumber}
                    />
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(receipt.remaining, receipt.currency)} available
                    </span>
                  </div>
                  <p className="truncate">{receipt.purpose}</p>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span>{formatBusinessDate(receipt.businessDate)}</span>
                    <span className="tabular-nums">
                      Received {formatMoney(receipt.amount, receipt.currency)}
                    </span>
                    {canRefundAdvance && receipt.remaining > ZERO ? (
                      <Button size="xs" variant="ghost" onClick={() => setRefundReceipt(receipt)}>
                        Refund
                      </Button>
                    ) : null}
                  </div>
                  {refundLinks(receipt)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {refundReceipt ? (
          <AdvanceRefundDialog
            orgSlug={orgSlug}
            receipt={refundReceipt}
            onClose={() => setRefundReceipt(null)}
          />
        ) : null}
      </Panel>

      {account && firstInvoice ? (
        <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-muted-foreground">{isRefundDue ? "Refund due" : "Outstanding"}</p>
          <p
            className={cn(
              "text-sm font-medium tabular-nums",
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
          <p className="text-muted-foreground">
            {account.openCount === 0
              ? "every invoice is settled"
              : `across ${account.openCount} open ${account.openCount === 1 ? "invoice" : "invoices"}`}
          </p>
        </section>
      ) : null}

      <Panel label="Invoices">
        {account && !firstInvoice ? (
          <PanelEmpty>No invoice has been raised for this patient.</PanelEmpty>
        ) : null}
        {account && firstInvoice ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid / credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.invoices.map((invoice) => {
                const due = invoice.outstanding !== ZERO;

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
                      {formatMoney(
                        invoice.paymentsTotal + invoice.allocationsTotal,
                        invoice.currency,
                      )}
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
        ) : null}
      </Panel>
    </div>
  );
}
