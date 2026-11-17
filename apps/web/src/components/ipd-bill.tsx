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
import { Label } from "@hms/ui/components/label";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { keepPreviousData, useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AdvanceReceiptLink,
  AdvanceRefundDialog,
  TakeDepositDialog,
} from "@/components/advance-form";
import { FinancialSummary } from "@/components/opd-financial-summary";
import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import { InvoiceAccount } from "@/components/opd-billing/invoice-account";
import { VoidChargeDialog } from "@/components/opd-billing/void-charge-dialog";
import { ChosenServices } from "@/components/chosen-services";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { DataList, ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { formatDay } from "@/lib/org-datetime";
import { depositShortfall } from "@/lib/ipd-deposit";
import { interimBillPdfUrl } from "@/lib/ipd-interim-bill";
import { linePriceBasis, mixedRateLabel } from "@/lib/invoice-print";
import { formatMoney, ZERO } from "@/lib/money";
import { useCan } from "@/lib/membership";
import type { PatientCredit } from "@/lib/patient-credit";
import type { WalkInQuote } from "@/lib/opd-service-preview";
import { orpc } from "@/lib/orpc";
import { closeOnConflict, errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

type AdmissionStatus = "admitted" | "discharge_ready" | "discharged" | "cancelled";

const LAST_DAYS = ["full", "half", "none"] as const;

type LastDay = (typeof LAST_DAYS)[number];

const LAST_DAY_LABELS: Record<LastDay, string> = {
  full: "Full",
  half: "Half",
  none: "Don't charge",
};

export const admissionBillQuery = (
  orgSlug: string,
  admissionId: string,
  lastDay: LastDay = "full",
) => orpc.ipd.previewInvoice.queryOptions({ input: { orgSlug, admissionId, lastDay } });

export const issuedInvoiceQuery = (orgSlug: string, invoiceId: string) =>
  orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } });

type Bill = Awaited<ReturnType<typeof orpc.ipd.previewInvoice.call>>;

type BillLine = Bill["pending"]["lines"][number];

export function AdmissionBill({
  orgSlug,
  admission,
  canWrite,
  currency,
}: {
  orgSlug: string;
  admission: { id: string; patientId: string; status: AdmissionStatus; chargeRevision: number };
  canWrite: boolean;
  currency: string;
}) {
  const canRefund = useCan(orgSlug, { billing: ["advanceRefund"] });

  // The collect overlay holds the bill as it was opened: the cashier settles what they
  // reviewed, and a Charge posted elsewhere blocks it until reopened.
  const [overlay, setOverlay] = useState<
    | { kind: "service" }
    | { kind: "deposit" }
    | { kind: "collect"; reviewed: Bill; lastDay: LastDay; reason: string | undefined }
    | { kind: "remove"; line: BillLine }
    | null
  >(null);

  // The cashier's call on the last day belongs to the bill it was made on: any change to
  // the stay's charges, an issued bill among them, returns it to a full day.
  const [choice, setChoice] = useState<{ lastDay: LastDay; reason: string; revision: number }>({
    lastDay: "full",
    reason: "",
    revision: -1,
  });

  const [reasonMissing, setReasonMissing] = useState(false);

  // The total moved between review and issue, such as a bed day starting at checkout.
  const [changed, setChanged] = useState(false);

  const billable = admission.status === "discharge_ready" || admission.status === "discharged";

  const lastDay =
    billable && choice.revision === admission.chargeRevision ? choice.lastDay : "full";

  const bill = useQuery({
    ...admissionBillQuery(orgSlug, admission.id, lastDay),
    placeholderData: keepPreviousData,
  });

  // An issued bill still owed draws on the deposit first, so none of it is left over yet.
  // The same queries feed each issued bill's card below.
  const issuedOwed = useQueries({
    queries: (bill.data?.issued ?? []).map(({ invoiceId }) =>
      issuedInvoiceQuery(orgSlug, invoiceId),
    ),
    combine: (results) =>
      results.some((result) => !result.data || result.data.balance.outstanding > ZERO),
  });

  const close = () => setOverlay(null);
  const data = bill.data;

  const issue = useMutation({
    ...orpc.ipd.issueInvoice.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.invoiceId
            ? "Invoice issued"
            : "Last day marked as dealt with. Nothing to charge, so no invoice was issued.",
        );
        close();
      },
      // Any refusal closes the reviewed snapshot; only a moved bill says "The bill changed".
      onError: (error) => {
        if (!hasErrorCode(error, "CONFLICT")) return;

        if (errorReason(error) === "charges_changed") setChanged(true);
        close();
      },
    }),
    // A changed total is explained beside the refreshed bill; any other refusal is toasted
    // in the server's words.
    meta: { showsInline: (error) => errorReason(error) === "charges_changed" },
  });

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

  const { pending, issued, bedDays, credit } = data;
  const canAddService = canWrite && admission.status !== "cancelled";
  const inHospital = admission.status === "admitted" || admission.status === "discharge_ready";
  // Issued medicines come back by a return, not a removal.
  const removable = (line: BillLine) => canWrite && line.admissionKind === "service";
  const unbilledDays = bedDays.unbilled;
  const firstUnbilled = unbilledDays.at(0);
  const lastUnbilled = unbilledDays.at(-1);
  // Nothing to charge but days to close, such as one uncharged last day.
  const closesDaysOnly = pending.lines.length === 0 && unbilledDays.length > 0;
  const nothingToBill = pending.lines.length === 0 && unbilledDays.length === 0;
  // A stay that has left settles on its bill; a shortfall is a call to collect while in.
  const depositShort = inHospital ? depositShortfall(pending.grandTotal, credit.deposit) : ZERO;

  // What the stay still holds once nothing is left to bill or owed goes back to the Patient.
  const refundable =
    canRefund &&
    credit.deposit > ZERO &&
    (admission.status === "cancelled" || (billable && nothingToBill && !issuedOwed));

  // The revision the bill was read at: a charge posted since moves it, and the server
  // refuses a settlement against the old figure.
  const stale = data.chargeRevision !== admission.chargeRevision;

  // The printed Invoice's words, so the screen and the paper read alike.
  const priceLabel = (line: BillLine) => {
    const { label, suffix } = linePriceBasis(data.registered, line);
    const units = line.priceUnits > 1 ? ` / ${line.priceUnits}` : "";

    return `${label} ${formatMoney(line.unitPrice, currency)}${units}${suffix ? ` ${suffix}` : ""}`;
  };

  const quoteOf = (reviewed: Bill): WalkInQuote => ({
    currency,
    lines: reviewed.pending.lines.map((line) => ({
      ...line,
      // A bed-day line has no Charge until the bill writes it.
      chargeId: line.chargeId ?? line.description,
      source: "service" as const,
      category: line.admissionKind ?? "service",
    })),
    subtotal: reviewed.pending.subtotal,
    discountAmount: ZERO,
    taxTotal: reviewed.pending.taxTotal,
    addedTaxTotal: reviewed.pending.addedTaxTotal,
    registered: reviewed.registered,
    roundOff: reviewed.pending.roundOff,
    grandTotal: reviewed.pending.grandTotal,
  });

  const settle = (
    reviewed: Bill,
    chosen: { lastDay: LastDay; reason: string | undefined },
    draft: SettlementDraft,
  ) => {
    const collected = draft.payments.reduce((sum, payment) => sum + payment.amount, ZERO);
    const balance = draft.expectedGrandTotal - draft.applyCredit - collected;

    issue.mutate({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: reviewed.chargeRevision,
      expectedGrandTotal: draft.expectedGrandTotal,
      lastDay: chosen.lastDay,
      lastDayReason: chosen.reason,
      discountAmount: draft.discountAmount,
      // The one reason the cashier gave covers the discount and any balance alike.
      discountReason: draft.discountAmount > ZERO ? draft.note : undefined,
      applyCredit: draft.applyCredit,
      payments: draft.payments,
      // A reason travels only with a balance: a bill paid in full has nothing to explain.
      outstandingReason: balance > ZERO ? draft.note : undefined,
    });
  };

  const startIssue = () => {
    const reason = lastDay === "full" ? undefined : choice.reason.trim();

    if (reason === "") {
      setReasonMissing(true);

      return;
    }

    setChanged(false);

    if (!closesDaysOnly) {
      setOverlay({ kind: "collect", reviewed: data, lastDay, reason });

      return;
    }

    issue.mutate({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: data.chargeRevision,
      expectedGrandTotal: pending.grandTotal,
      lastDay,
      lastDayReason: reason,
    });
  };

  // Deposits are taken while the Patient is in hospital (the server refuses after).
  const takeDeposit =
    canWrite && inHospital ? (
      <Button variant="outline" onClick={() => setOverlay({ kind: "deposit" })}>
        Take deposit
      </Button>
    ) : null;

  const chooseLastDay = (value: LastDay) => {
    setReasonMissing(false);
    setChoice({ lastDay: value, reason: choice.reason, revision: admission.chargeRevision });
  };

  return (
    <Panel
      label="Bill"
      minHeight=""
      action={
        <div className="flex items-center gap-2">
          {inHospital ? (
            <Button
              size="xs"
              variant="ghost"
              nativeButton={false}
              render={
                <a
                  href={interimBillPdfUrl(orgSlug, admission.id)}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Print interim bill
            </Button>
          ) : null}
          {canAddService ? (
            <Button size="xs" variant="outline" onClick={() => setOverlay({ kind: "service" })}>
              Add service
            </Button>
          ) : null}
        </div>
      }
    >
      {pending.lines.length === 0 ? (
        <PanelEmpty>Nothing to bill</PanelEmpty>
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
          rows={pending.lines}
          rowKey={(line) => line.chargeId ?? line.description}
          wrap
          action={
            pending.lines.some(removable)
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
        {pending.lines.length === 0 && credit.deposit === ZERO ? null : (
          <div className="grid w-full gap-2 sm:order-2 sm:max-w-64">
            {/* "Nothing to bill" above says it once: no zero totals under it. While the
                Patient is still in, the total is what the stay has run up so far. */}
            {pending.lines.length === 0 ? null : (
              <FinancialSummary
                quote={quoteOf(data)}
                totalLabel={billable ? "Total" : "Running bill"}
              />
            )}
            {credit.deposit === ZERO ? null : (
              <dl className="grid gap-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Deposit held</dt>
                  <dd className="tabular-nums">{formatMoney(credit.deposit, currency)}</dd>
                </div>
                {depositShort === ZERO ? null : (
                  <div className="flex justify-between gap-3 font-medium">
                    <dt>Deposit short by</dt>
                    <dd className="tabular-nums">{formatMoney(depositShort, currency)}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3 sm:order-1">
          {unbilledDays.length > 0 || bedDays.billed > 0 ? (
            <p className="text-muted-foreground tabular-nums">
              {firstUnbilled && lastUnbilled ? (
                <>
                  Bed days to bill: {unbilledDays.length} (
                  {firstUnbilled === lastUnbilled
                    ? formatDay(lastUnbilled.date)
                    : `${formatDay(firstUnbilled.date)} to ${formatDay(lastUnbilled.date)}`}
                  ){bedDays.billed > 0 ? ` · ${bedDays.billed} already billed` : null}
                </>
              ) : (
                "Bed days up to date"
              )}
            </p>
          ) : null}
          {issued.map(({ invoiceId }) => (
            <IssuedInvoice
              key={invoiceId}
              orgSlug={orgSlug}
              invoiceId={invoiceId}
              canPay={canWrite}
              // This stay's deposit is offered in full; the Patient's other credit by hand.
              credit={{
                usable: credit.deposit,
                total: credit.deposit + credit.other,
                label: "Use deposit",
              }}
            />
          ))}
          {refundable ? (
            <StayDeposits orgSlug={orgSlug} admission={admission} currency={currency} />
          ) : null}
          {changed ? (
            <p role="status" className="border-l-2 border-border pl-3">
              The bill changed before it was issued, for example a new bed day began at checkout.
              This is the current bill: check the total and issue again.
            </p>
          ) : null}
          {!canWrite || admission.status === "cancelled" ? null : billable ? (
            nothingToBill ? (
              takeDeposit ? (
                <div>{takeDeposit}</div>
              ) : null
            ) : (
              <div className="flex flex-col gap-3">
                {lastUnbilled ? (
                  <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="last-day">Last day, {formatDay(lastUnbilled.date)}</Label>
                      <NativeSelect
                        id="last-day"
                        value={lastDay}
                        onChange={(event) => {
                          const value = LAST_DAYS.find((each) => each === event.target.value);

                          if (value) chooseLastDay(value);
                        }}
                      >
                        {LAST_DAYS.map((value) => (
                          <option key={value} value={value}>
                            {LAST_DAY_LABELS[value]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    {lastDay === "full" ? null : (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="last-day-reason">Reason</Label>
                        <Input
                          id="last-day-reason"
                          value={choice.reason}
                          maxLength={500}
                          aria-invalid={reasonMissing || undefined}
                          aria-describedby={reasonMissing ? "last-day-reason-error" : undefined}
                          onChange={(event) => {
                            setReasonMissing(false);
                            setChoice({ ...choice, reason: event.target.value });
                          }}
                        />
                        {reasonMissing ? (
                          <p id="last-day-reason-error" className="text-destructive">
                            Say why the last day is {lastDay === "half" ? "half" : "not"} charged
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
                {closesDaysOnly ? (
                  <p className="text-muted-foreground">
                    Nothing to charge, so no invoice is issued. The day is marked as dealt with.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={stale || bill.isFetching || issue.isPending}
                    onClick={startIssue}
                  >
                    {closesDaysOnly ? (
                      "Mark day as dealt with"
                    ) : (
                      <span className="tabular-nums">
                        Issue invoice {formatMoney(pending.grandTotal, currency)}
                      </span>
                    )}
                  </Button>
                  {takeDeposit}
                </div>
              </div>
            )
          ) : (
            <>
              <p className="text-muted-foreground">
                The bill is issued once the Patient is ready to leave.
              </p>
              {takeDeposit ? <div>{takeDeposit}</div> : null}
            </>
          )}
        </div>
      </div>

      {overlay?.kind === "service" ? (
        <AddServiceDialog
          orgSlug={orgSlug}
          admission={admission}
          currency={currency}
          registered={data.registered}
          onClose={close}
        />
      ) : null}
      {overlay?.kind === "deposit" ? (
        <TakeDepositDialog orgSlug={orgSlug} admission={admission} onClose={close} />
      ) : null}
      {overlay?.kind === "remove" && overlay.line.chargeId ? (
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
            // This stay's deposit is offered in full; the Patient's other credit by hand.
            availableCredit={{
              usable: overlay.reviewed.credit.deposit,
              total: overlay.reviewed.credit.deposit + overlay.reviewed.credit.other,
              label: "Use deposit",
            }}
            description={`${overlay.reviewed.pending.lines.length} item${overlay.reviewed.pending.lines.length === 1 ? "" : "s"} on this admission`}
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
            onConfirm={(draft) => settle(overlay.reviewed, overlay, draft)}
          />
        </ClientOnly>
      ) : null}
    </Panel>
  );
}

/**
 * The stay's receipts that still hold money, each refundable through the existing advance
 * refund.
 */
function StayDeposits({
  orgSlug,
  admission,
  currency,
}: {
  orgSlug: string;
  admission: { id: string; patientId: string };
  currency: string;
}) {
  const [refunding, setRefunding] = useState<{ id: string; remaining: bigint } | null>(null);

  const account = useQuery(
    orpc.patient.account.queryOptions({ input: { orgSlug, patientId: admission.patientId } }),
  );

  if (account.error) {
    return <ErrorNote title="Could not load the deposit receipts" error={account.error} />;
  }

  const mine =
    account.data?.advanceReceipts.filter(
      (receipt) => receipt.admissionId === admission.id && receipt.remaining > ZERO,
    ) ?? [];

  return (
    <div className="flex flex-col gap-2">
      {mine.map((receipt) => (
        <div key={receipt.id} className="flex flex-wrap items-center gap-3">
          <AdvanceReceiptLink orgSlug={orgSlug} id={receipt.id} label={receipt.receiptNumber} />
          <Button variant="outline" onClick={() => setRefunding(receipt)}>
            <span className="tabular-nums">
              Refund deposit {formatMoney(receipt.remaining, currency)}
            </span>
          </Button>
        </div>
      ))}
      {refunding ? (
        <AdvanceRefundDialog
          orgSlug={orgSlug}
          receipt={refunding}
          title="Refund deposit"
          description="Return what is left of this deposit to the Patient."
          onClose={() => setRefunding(null)}
        />
      ) : null}
    </div>
  );
}

// An issued bill takes payments, credit notes and refunds through the same card as an OPD visit.
function IssuedInvoice({
  orgSlug,
  invoiceId,
  canPay,
  credit,
}: {
  orgSlug: string;
  invoiceId: string;
  canPay: boolean;
  credit: PatientCredit;
}) {
  const canCredit = useCan(orgSlug, { billing: ["creditNote"] });
  const invoice = useQuery(issuedInvoiceQuery(orgSlug, invoiceId));

  if (!invoice.data) {
    return invoice.isError ? (
      <ErrorNote title="Could not load the invoice" error={invoice.error} />
    ) : null;
  }

  const { invoice: header, balance, payments, creditNotes, refunds } = invoice.data;

  return (
    <InvoiceAccount
      orgSlug={orgSlug}
      invoice={{
        id: header.id,
        patientId: header.patientId,
        invoiceNumber: header.invoiceNumber,
        currency: header.currency,
        grandTotal: header.grandTotal,
        paymentsTotal: balance.paymentsTotal,
        allocationsTotal: balance.allocationsTotal,
        outstanding: balance.outstanding,
        receipts: payments.map((payment) => ({ id: payment.id, number: payment.receiptNumber })),
        creditNotes: creditNotes.map((note) => ({ id: note.id, number: note.creditNoteNumber })),
        refunds: refunds.map((refund) => ({ id: refund.id, number: refund.refundNumber })),
      }}
      treatmentPlanId={null}
      canCredit={canCredit}
      canPay={canPay}
      stayCredit={credit}
      medicineCreditNote="Crediting a medicine corrects the amount only; the medicine itself comes back through Return under Medicines issued."
    />
  );
}

// Mounted per open, so the list starts empty without an effect.
function AddServiceDialog({
  orgSlug,
  admission,
  currency,
  registered,
  onClose,
}: {
  orgSlug: string;
  admission: { id: string; chargeRevision: number };
  currency: string;
  registered: boolean;
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

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(open) => (open || post.isPending ? undefined : onClose())}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add service</DialogTitle>
            <DialogDescription>
              {registered
                ? "Charged at today's catalog price, with GST added where the service carries it."
                : "Charged at today's catalog price."}
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
                taxedBillable={registered}
                onAdd={(line) => setLines((current) => [...current, line])}
              />
              <ChosenServices
                lines={lines}
                onChange={setLines}
                currency={currency}
                registered={registered}
              />
              {post.error ? (
                <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
                  {errorMessage(post.error, "Could not add the services")}
                </p>
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
