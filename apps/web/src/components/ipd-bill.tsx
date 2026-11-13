import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { Input } from "@hms/ui/components/input";
import { Separator } from "@hms/ui/components/separator";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly, Link } from "@tanstack/react-router";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import { VoidChargeDialog } from "@/components/opd-billing/void-charge-dialog";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { DataList, ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { billingPdfUrl } from "@/lib/billing-document";
import { linePriceBasis, mixedRateLabel } from "@/lib/invoice-print";
import { formatMoney, ZERO } from "@/lib/money";
import type { WalkInQuote } from "@/lib/opd-service-preview";
import { orpc } from "@/lib/orpc";
import { closeOnConflict } from "@/lib/orpc-error";

type AdmissionStatus = "admitted" | "discharge_ready" | "discharged" | "cancelled";

export const admissionBillQuery = (orgSlug: string, admissionId: string) =>
  orpc.ipd.previewInvoice.queryOptions({ input: { orgSlug, admissionId } });

export const issuedInvoiceQuery = (orgSlug: string, invoiceId: string) =>
  orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } });

type Bill = Awaited<ReturnType<typeof orpc.ipd.previewInvoice.call>>;

type BillLine = Bill["lines"][number];

export function AdmissionBill({
  orgSlug,
  admission,
  bill,
  canWrite,
  currency,
}: {
  orgSlug: string;
  admission: { id: string; status: AdmissionStatus; chargeRevision: number };
  bill: { data?: Bill; isError: boolean; error: unknown };
  canWrite: boolean;
  currency: string;
}) {
  // The collect overlay holds the bill as it was opened: the cashier settles what they
  // reviewed, and a Charge posted elsewhere blocks it until reopened.
  const [overlay, setOverlay] = useState<
    | { kind: "service" }
    | { kind: "collect"; reviewed: Bill }
    | { kind: "remove"; line: BillLine }
    | null
  >(null);

  const close = () => setOverlay(null);
  const data = bill.data;

  const issue = useMutation(
    orpc.ipd.issueInvoice.mutationOptions({
      onSuccess: () => {
        toast.success("Invoice issued");
        close();
      },
      onError: closeOnConflict(close),
    }),
  );

  if (!data) {
    return (
      <Panel label="Bill" minHeight="">
        {bill.isError ? (
          <div className="p-3">
            <ErrorNote title="Could not load the bill" error={bill.error} />
          </div>
        ) : (
          <span role="status" className="sr-only">
            Loading bill…
          </span>
        )}
      </Panel>
    );
  }

  const issued = data.invoiceId !== null;
  const canAddService = canWrite && !issued && admission.status !== "cancelled";
  // Issued medicines come back by a return, not a removal.
  const removable = (line: BillLine) => canWrite && !issued && line.admissionKind === "service";

  const billable = admission.status === "discharge_ready" || admission.status === "discharged";

  // The revision the bill was read at: a charge posted since moves it, and the server
  // refuses a settlement against the old figure.
  const stale = data.chargeRevision !== admission.chargeRevision;
  const includedTax = data.taxTotal - data.addedTaxTotal;

  // The printed Invoice's words, so the screen and the paper read alike.
  const priceLabel = (line: BillLine) => {
    const { label, suffix } = linePriceBasis(data.registered, line);
    const units = line.priceUnits > 1 ? ` / ${line.priceUnits}` : "";

    return `${label} ${formatMoney(line.unitPrice, currency)}${units}${suffix ? ` ${suffix}` : ""}`;
  };

  const quoteOf = (reviewed: Bill): WalkInQuote => ({
    currency,
    lines: reviewed.lines.map((line) => ({
      ...line,
      source: "service" as const,
      category: line.admissionKind ?? "service",
    })),
    subtotal: reviewed.subtotal,
    discountAmount: ZERO,
    taxTotal: reviewed.taxTotal,
    addedTaxTotal: reviewed.addedTaxTotal,
    registered: reviewed.registered,
    roundOff: reviewed.roundOff,
    grandTotal: reviewed.grandTotal,
  });

  const settle = (reviewed: Bill, draft: SettlementDraft) => {
    const collected = draft.payments.reduce((sum, payment) => sum + payment.amount, ZERO);

    issue.mutate({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: reviewed.chargeRevision,
      expectedGrandTotal: draft.expectedGrandTotal,
      payments: draft.payments,
      // A reason travels only with a balance: a bill paid in full has nothing to explain.
      outstandingReason: draft.expectedGrandTotal > collected ? draft.note : undefined,
    });
  };

  return (
    <Panel
      label="Bill"
      minHeight=""
      action={
        canAddService ? (
          <Button size="xs" variant="outline" onClick={() => setOverlay({ kind: "service" })}>
            Add service
          </Button>
        ) : undefined
      }
    >
      {data.lines.length === 0 ? (
        <PanelEmpty>Nothing charged yet</PanelEmpty>
      ) : (
        <DataList
          columns={[
            {
              head: "Item",
              cell: (line) => <span className="block min-w-0">{line.description}</span>,
            },
            {
              head: "Qty",
              cell: (line) => <span className="tabular-nums">× {line.qty}</span>,
              className: "text-right",
              mobile: "title",
            },
            {
              head: "Price",
              cell: (line) => (
                <span className="whitespace-nowrap tabular-nums">{priceLabel(line)}</span>
              ),
              className: "text-right",
            },
            // An organization without a GSTIN claims no GST on screen or paper (D052).
            ...(data.registered
              ? [
                  {
                    head: "GST",
                    cell: (line: BillLine) => (
                      <span className="whitespace-nowrap tabular-nums">
                        {line.taxAmount === ZERO
                          ? mixedRateLabel(line)
                          : `${formatMoney(line.taxAmount, currency)} (${mixedRateLabel(line)})`}
                      </span>
                    ),
                    className: "text-right",
                  },
                ]
              : []),
            {
              head: "Amount",
              cell: (line) => (
                <span className="font-medium tabular-nums">
                  {formatMoney(line.gross, currency)}
                </span>
              ),
              className: "text-right",
              mobile: "title",
            },
          ]}
          rows={data.lines}
          rowKey={(line) => line.chargeId}
          wrap
          action={
            data.lines.some(removable)
              ? (line) =>
                  removable(line) ? (
                    <ClientOnly fallback={<span className="inline-block size-6" />}>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-xs" />}
                          aria-label={`Actions for ${line.description}`}
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-32">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setOverlay({ kind: "remove", line })}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ClientOnly>
                  ) : null
              : undefined
          }
        />
      )}

      <div className="flex flex-col gap-3 border-t border-border p-3 sm:flex-row sm:items-end sm:justify-between">
        <dl className="grid w-full gap-1 sm:order-2 sm:max-w-64">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(data.subtotal, currency)}</dd>
          </div>
          {data.addedTaxTotal === ZERO ? null : (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{data.registered ? "GST added" : "Tax"}</dt>
              <dd className="tabular-nums">{formatMoney(data.addedTaxTotal, currency)}</dd>
            </div>
          )}
          <Separator />
          <div className="flex justify-between gap-3 font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(data.grandTotal, currency)}</dd>
          </div>
          {!data.registered || includedTax === ZERO ? null : (
            <div className="flex justify-between gap-3 text-muted-foreground">
              <dt>GST included in MRP</dt>
              <dd className="tabular-nums">{formatMoney(includedTax, currency)}</dd>
            </div>
          )}
        </dl>

        <div className="sm:order-1">
          {data.invoiceId !== null ? (
            <IssuedInvoice orgSlug={orgSlug} invoiceId={data.invoiceId} currency={currency} />
          ) : !canWrite || admission.status === "cancelled" ? null : billable ? (
            <Button
              disabled={data.lines.length === 0 || stale}
              onClick={() => setOverlay({ kind: "collect", reviewed: data })}
            >
              <span className="tabular-nums">
                Issue invoice {formatMoney(data.grandTotal, currency)}
              </span>
            </Button>
          ) : (
            <p className="text-muted-foreground">
              The bill is issued once the Patient is ready to leave.
            </p>
          )}
        </div>
      </div>

      {overlay?.kind === "service" ? (
        <AddServiceDialog
          orgSlug={orgSlug}
          admission={admission}
          currency={currency}
          onClose={close}
        />
      ) : null}
      {overlay?.kind === "remove" ? (
        <VoidChargeDialog
          charge={{ id: overlay.line.chargeId, description: overlay.line.description }}
          orgSlug={orgSlug}
          onClose={close}
        />
      ) : null}
      {overlay?.kind === "collect" ? (
        <ClientOnly fallback={null}>
          <SettlementOverlay
            quote={quoteOf(overlay.reviewed)}
            stream="ipd"
            discountable={false}
            availableCredit={{ usable: ZERO, total: ZERO }}
            description={`${overlay.reviewed.lines.length} item${overlay.reviewed.lines.length === 1 ? "" : "s"} on this admission`}
            label="Issue invoice"
            pending={issue.isPending}
            blockedReason={
              stale || data.chargeRevision !== overlay.reviewed.chargeRevision
                ? "The bill changed. Close this and review the current bill."
                : undefined
            }
            onOpenChange={(open) => {
              if (!open) close();
            }}
            onConfirm={(draft) => settle(overlay.reviewed, draft)}
          />
        </ClientOnly>
      ) : null}
    </Panel>
  );
}

function IssuedInvoice({
  orgSlug,
  invoiceId,
  currency,
}: {
  orgSlug: string;
  invoiceId: string;
  currency: string;
}) {
  const invoice = useQuery(issuedInvoiceQuery(orgSlug, invoiceId));

  if (!invoice.data) {
    return invoice.isError ? (
      <ErrorNote title="Could not load the invoice" error={invoice.error} />
    ) : null;
  }

  const { balance } = invoice.data;
  const paid = balance.paymentsTotal + balance.allocationsTotal;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <Link
          to="/$orgSlug/billing/invoices/$invoiceId"
          params={{ orgSlug, invoiceId }}
          className="font-mono font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
        >
          {invoice.data.invoice.invoiceNumber}
        </Link>
        <p className="tabular-nums text-muted-foreground">
          Paid {formatMoney(paid, currency)}
          {balance.outstanding > ZERO ? null : " · settled"}
        </p>
        {balance.outstanding > ZERO ? (
          <p className="font-medium tabular-nums">
            Outstanding {formatMoney(balance.outstanding, currency)}
          </p>
        ) : null}
      </div>
      <Button
        variant="outline"
        nativeButton={false}
        render={
          <a
            href={billingPdfUrl({
              orgSlug,
              invoiceId,
              request: { kind: "invoice", documentId: null, layout: "a4" },
            })}
            target="_blank"
            rel="noreferrer"
          />
        }
      >
        Print
      </Button>
    </div>
  );
}

// Mounted per open, so the list starts empty without an effect.
function AddServiceDialog({
  orgSlug,
  admission,
  currency,
  onClose,
}: {
  orgSlug: string;
  admission: { id: string; chargeRevision: number };
  currency: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<ServiceLine[]>([]);

  const post = useMutation(
    orpc.ipd.postServices.mutationOptions({
      onSuccess: () => {
        toast.success(lines.length === 1 ? "Service added" : "Services added");
        onClose();
      },
      onError: closeOnConflict(onClose),
    }),
  );

  const commitQty = (line: ServiceLine, input: HTMLInputElement) => {
    const qty = Math.max(1, Math.trunc(input.valueAsNumber) || 1);
    input.value = String(qty);
    setLines((current) =>
      current.map((each) => (each.catalogItemId === line.catalogItemId ? { ...each, qty } : each)),
    );
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(open) => (open || post.isPending ? undefined : onClose())}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add service</DialogTitle>
            <DialogDescription>
              Charged at today&apos;s catalog price, with GST added where the service carries it.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();

              if (lines.length === 0) return;

              post.mutate({
                orgSlug,
                admissionId: admission.id,
                expectedChargeRevision: admission.chargeRevision,
                lines: lines.map((line) => ({ catalogItemId: line.catalogItemId, qty: line.qty })),
              });
            }}
          >
            <fieldset disabled={post.isPending} className="contents">
              <ServicePicker
                orgSlug={orgSlug}
                chosen={new Set(lines.map((line) => line.catalogItemId))}
                services="any"
                onAdd={(line) => setLines((current) => [...current, line])}
              />
              {lines.length > 0 ? (
                <ul className="grid gap-2">
                  {lines.map((line) => (
                    <li
                      key={line.catalogItemId}
                      className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{line.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {formatMoney(line.unitPrice, currency)}
                          {Number(line.taxRatePercent) > 0 ? " + GST" : ""}
                        </span>
                      </span>
                      <Input
                        key={`${line.catalogItemId}:${line.qty}`}
                        type="number"
                        min={1}
                        step={1}
                        defaultValue={line.qty}
                        aria-label={`${line.name} quantity`}
                        className="tabular-nums"
                        onBlur={(event) => commitQty(line, event.currentTarget)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          commitQty(line, event.currentTarget);
                        }}
                      />
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="destructive"
                        aria-label={`Remove ${line.name}`}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((each) => each.catalogItemId !== line.catalogItemId),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <DialogFooter>
                <SubmitButton
                  isSubmitting={post.isPending}
                  aria-disabled={lines.length === 0 || undefined}
                >
                  Add to bill
                </SubmitButton>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
