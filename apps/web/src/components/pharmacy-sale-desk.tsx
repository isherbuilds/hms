import { computeInvoiceLines } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, useBlocker, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FinancialSummary } from "@/components/opd-financial-summary";
import {
  OpdPatientSearch,
  SelectedPatientChip,
  type SelectedPatient,
} from "@/components/opd-patient-picker";
import {
  SettlementOverlay,
  type SettlementDraft,
} from "@/components/opd-settlement-overlay";
import { FormSection, Panel } from "@/components/page";
import {
  PharmacyBatchPicker,
  type SaleLine,
} from "@/components/pharmacy-batch-picker";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import type { WalkInQuote } from "@/lib/opd-service-preview";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { closeOnConflict } from "@/lib/orpc-error";
import { openingCredit } from "@/lib/patient-credit";

type Buyer = "walk-in" | "patient";

const BUYER_LABELS = [
  ["walk-in", "Walk-in"],
  ["patient", "Patient"],
] as const satisfies readonly (readonly [Buyer, string])[];

function SaleLines({
  lines,
  currency,
  onChange,
  onRemove,
}: {
  lines: Array<SaleLine & { lineSubtotal: bigint }>;
  currency: string;
  onChange: (batchId: string, qty: number) => void;
  onRemove: (batchId: string) => void;
}) {
  const commitQty = (line: SaleLine, input: HTMLInputElement) => {
    // The shelf is the ceiling: the server refuses more, so the field never offers it.
    const qty = Math.min(line.shelfQty, Math.max(1, input.valueAsNumber || 1));
    input.value = String(qty);
    onChange(line.batchId, qty);
  };

  const qtyField = (line: SaleLine) => (
    <Input
      key={`${line.batchId}:${line.qty}`}
      type="number"
      min={1}
      max={line.shelfQty}
      defaultValue={line.qty}
      aria-label={`${line.productName} quantity`}
      className="w-16 tabular-nums"
      onBlur={(event) => commitQty(line, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitQty(line, event.currentTarget);
      }}
    />
  );

  const removeButton = (line: SaleLine) => (
    <Button
      type="button"
      size="icon-xs"
      variant="destructive"
      aria-label={`Remove ${line.productName}`}
      onClick={() => onRemove(line.batchId)}
    >
      <Trash2Icon />
    </Button>
  );

  if (lines.length === 0) {
    return <p className="text-muted-foreground">No batches in this sale</p>;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg ring-1 ring-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="w-20">Qty</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.batchId}>
                <TableCell>
                  <p className="font-medium capitalize">{line.productName}</p>
                  <p className="font-mono text-muted-foreground">{line.code}</p>
                </TableCell>
                <TableCell className="font-mono">{line.batchNumber}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatBusinessDate(line.expiryDate)}
                </TableCell>
                <TableCell>{qtyField(line)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.mrp, currency)}
                  {line.mrpUnits > 1 ? ` / ${line.mrpUnits}` : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.lineSubtotal, currency)}
                </TableCell>
                <TableCell>{removeButton(line)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {lines.map((line) => (
          <article
            key={line.batchId}
            className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="wrap-break-words font-medium capitalize">
                {line.productName}
              </p>
              <p className="break-all font-mono text-muted-foreground">
                {line.code}
              </p>
              <p className="break-all font-mono text-muted-foreground">
                Batch {line.batchNumber}
              </p>
              <p className="text-muted-foreground">
                Expires {formatBusinessDate(line.expiryDate)}
              </p>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
              <label className="grid gap-1 text-muted-foreground">
                Qty
                {qtyField(line)}
              </label>
              <div className="min-w-0">
                <p className="text-muted-foreground">MRP</p>
                <p className="wrap-break-words tabular-nums">
                  {formatMoney(line.mrp, currency)}
                  {line.mrpUnits > 1 ? ` / ${line.mrpUnits}` : ""}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-end justify-between gap-2 border-t border-border pt-2">
              <div className="min-w-0">
                <p className="text-muted-foreground">Amount</p>
                <p className="wrap-break-words font-medium tabular-nums">
                  {formatMoney(line.lineSubtotal, currency)}
                </p>
              </div>
              {removeButton(line)}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function PharmacySaleDesk({ orgSlug }: { orgSlug: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // A patient buyer reads the patient master; a counter sale does not.
  const canReadPatients = useCan(orgSlug, { patient: ["read"] });

  const [cart, setCart] = useState<SaleLine[]>([]);
  const [buyerKind, setBuyerKind] = useState<Buyer>("walk-in");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [showPrescription, setShowPrescription] = useState(false);
  const [forName, setForName] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriptionReference, setPrescriptionReference] = useState("");
  const [attempted, setAttempted] = useState(false);
  // The credit the overlay opens with, read on Collect; null while it is closed.
  const [settlement, setSettlement] = useState<bigint | null>(null);

  // Freezes the buyer while the credit read is in flight, so the overlay cannot open on
  // one patient's credit while the sale names another.
  const readCredit = useMutation({
    mutationFn: (patientId: string) =>
      openingCredit(queryClient, orgSlug, patientId),
    onSuccess: (credit) => {
      if (credit !== null) setSettlement(credit);
    },
  });

  const dirty = cart.length > 0;

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  const add = (line: Omit<SaleLine, "qty">) =>
    setCart((current) => [...current, { ...line, qty: 1 }]);

  // The overlay owns the discount, so the desk only ever quotes the undiscounted bill.
  const computed = computeInvoiceLines(
    cart.map((line) => ({
      chargeId: line.batchId,
      description: line.productName,
      qty: line.qty,
      unitPrice: line.mrp,
      priceUnits: line.mrpUnits,
      taxRatePercent: line.taxRatePercent,
      taxCode: null,
    })),
    ZERO,
    "pharmacy",
  );

  const displayLines = cart.map((line, index) => {
    const priced = computed.lines[index];

    if (!priced) throw new Error("Computed sale line has no cart line");

    return { ...line, lineSubtotal: priced.lineSubtotal };
  });

  const quote: WalkInQuote = {
    currency,
    lines: computed.lines.map((line) => ({
      ...line,
      category: "pharmacy",
      source: "service" as const,
    })),
    subtotal: computed.subtotal,
    discountAmount: ZERO,
    taxTotal: computed.taxTotal,
    roundOff: computed.roundOff,
    grandTotal: computed.grandTotal,
  };

  const scheduleH1 = cart.some((line) => line.schedule === "h1");
  const prescriptionOpen = showPrescription || scheduleH1;

  const blocked =
    cart.length === 0
      ? "Add a batch to the sale."
      : buyerKind === "patient" && !patient
        ? "Choose the patient."
        : buyerKind === "walk-in" && walkInName.trim() === ""
          ? "Enter the buyer's name."
          : scheduleH1 && prescriberName.trim() === ""
            ? "A Schedule H1 medicine needs the prescriber."
            : undefined;

  const sell = useMutation(
    orpc.pharmacy.sell.mutationOptions({
      onSuccess: async (result) => {
        setSettlement(null);
        setCart([]);
        toast.success(`Sale ${result.invoiceNumber} recorded`);

        // The sales list opens the recorded sale, which is where Print lives.
        await navigate({
          to: "/$orgSlug/pharmacy",
          params: { orgSlug },
          search: { sale: result.saleId },
          ignoreBlocker: true,
        });
      },
      // Cart lines are local snapshots of shelf and price, so no refetch repairs them.
      onError: closeOnConflict(() => {
        setSettlement(null);
        setCart([]);
      }),
    }),
  );

  const collect = () => {
    setAttempted(true);

    if (blocked) return;

    if (buyerKind === "patient" && patient) {
      readCredit.mutate(patient.id);

      return;
    }

    setSettlement(ZERO);
  };

  const settle = (draft: SettlementDraft) => {
    if (blocked) return;

    sell.mutate({
      orgSlug,
      lines: cart.map((line) => ({ batchId: line.batchId, qty: line.qty })),
      buyer:
        buyerKind === "patient" && patient
          ? { patientId: patient.id }
          : { name: walkInName.trim(), phone: walkInPhone.trim() || undefined },
      forName: forName.trim() || undefined,
      prescriberName: prescriberName.trim() || undefined,
      prescriptionReference: prescriptionReference.trim() || undefined,
      discountAmount: draft.discountAmount,
      note: draft.note,
      payments: draft.payments,
      applyCredit: draft.applyCredit,
      expectedGrandTotal: draft.expectedGrandTotal,
    });
  };

  const collectButton = (id: string, messageClassName?: string) => (
    <>
      <SubmitButton
        isSubmitting={sell.isPending || readCredit.isPending}
        aria-disabled={blocked !== undefined || undefined}
        aria-describedby={attempted && blocked ? id : undefined}
        className="w-40 max-w-full aria-disabled:bg-primary aria-disabled:text-primary-foreground"
      >
        Collect
      </SubmitButton>
      {attempted && blocked ? (
        <p
          id={id}
          className={`text-muted-foreground ${messageClassName ?? ""}`}
        >
          {blocked}
        </p>
      ) : null}
    </>
  );

  const buyerLabel =
    buyerKind === "patient"
      ? (patient?.name ?? "patient")
      : walkInName.trim() || "walk-in";

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          collect();
        }}
      >
        <fieldset
          disabled={sell.isPending || readCredit.isPending}
          className="contents"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
              <FormSection title="Buyer">
                <div className="grid gap-3">
                  {canReadPatients ? (
                    <div
                      role="group"
                      aria-label="Buyer"
                      className="flex w-fit gap-1 rounded-md bg-muted p-0.5"
                    >
                      {BUYER_LABELS.map(([kind, label]) => (
                        <Button
                          key={kind}
                          type="button"
                          size="xs"
                          aria-pressed={buyerKind === kind}
                          variant={buyerKind === kind ? "secondary" : "ghost"}
                          onClick={() => setBuyerKind(kind)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  ) : null}

                  {buyerKind === "walk-in" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-muted-foreground">
                        Name <span className="sr-only">required</span>
                        <Input
                          value={walkInName}
                          aria-invalid={attempted && walkInName.trim() === ""}
                          onChange={(event) =>
                            setWalkInName(event.target.value)
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-muted-foreground">
                        Phone
                        <Input
                          value={walkInPhone}
                          inputMode="tel"
                          onChange={(event) =>
                            setWalkInPhone(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  ) : patient ? (
                    <SelectedPatientChip
                      patient={patient}
                      onClear={() => setPatient(null)}
                    />
                  ) : (
                    <OpdPatientSearch orgSlug={orgSlug} onSelect={setPatient} />
                  )}
                </div>
              </FormSection>

              <FormSection
                title="Items"
                description="Search the shelf and pick a batch"
              >
                <div className="grid gap-3">
                  <PharmacyBatchPicker
                    orgSlug={orgSlug}
                    chosen={new Set(cart.map((line) => line.batchId))}
                    onAdd={add}
                  />
                  <SaleLines
                    lines={displayLines}
                    currency={currency}
                    onChange={(batchId, qty) =>
                      setCart((current) =>
                        current.map((line) =>
                          line.batchId === batchId ? { ...line, qty } : line,
                        ),
                      )
                    }
                    onRemove={(batchId) =>
                      setCart((current) =>
                        current.filter((line) => line.batchId !== batchId),
                      )
                    }
                  />
                  <div className="border-t border-border pt-3 lg:hidden">
                    <FinancialSummary quote={quote} />
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="Prescription"
                description={
                  scheduleH1 ? "Required for Schedule H1" : "Optional"
                }
              >
                <div className="grid gap-3">
                  {scheduleH1 ? null : (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="justify-self-start"
                      aria-expanded={prescriptionOpen}
                      onClick={() => setShowPrescription((open) => !open)}
                    >
                      {prescriptionOpen ? "Hide details" : "Add details"}
                    </Button>
                  )}
                  {scheduleH1 ? (
                    <p className="text-muted-foreground">
                      A Schedule H1 medicine is on this sale: the prescriber is
                      required.
                    </p>
                  ) : null}
                  {prescriptionOpen ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="flex flex-col gap-2 text-muted-foreground">
                        For whom
                        <Input
                          value={forName}
                          onChange={(event) => setForName(event.target.value)}
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-muted-foreground">
                        Prescriber{" "}
                        {scheduleH1 ? (
                          <span className="text-destructive">*</span>
                        ) : null}
                        <Input
                          value={prescriberName}
                          aria-invalid={
                            scheduleH1 &&
                            attempted &&
                            prescriberName.trim() === ""
                          }
                          onChange={(event) =>
                            setPrescriberName(event.target.value)
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-muted-foreground">
                        Prescription reference
                        <Input
                          value={prescriptionReference}
                          onChange={(event) =>
                            setPrescriptionReference(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </FormSection>
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-0">
                <Panel label="Payment" minHeight="min-h-0" padded>
                  <FinancialSummary quote={quote} />
                  {collectButton("sale-desk-issue")}
                </Panel>
              </div>
            </aside>
          </div>

          <footer className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card p-3 lg:hidden">
            <div className="min-w-0">
              <p className="truncate text-muted-foreground">
                Payable · <span className="tabular-nums">{cart.length}</span>{" "}
                line
                {cart.length === 1 ? "" : "s"}
              </p>
              <p className="truncate text-xs font-medium tabular-nums">
                {formatMoney(quote.grandTotal, currency)}
              </p>
            </div>
            <div className="ml-auto grid shrink-0 justify-items-end gap-1">
              {collectButton("sale-desk-mobile-issue", "max-w-48 text-right")}
            </div>
          </footer>

          {settlement !== null ? (
            <ClientOnly fallback={null}>
              <SettlementOverlay
                quote={quote}
                stream="pharmacy"
                availableCredit={settlement}
                fullPayment={buyerKind !== "patient" || !patient}
                description={`${buyerLabel} · pharmacy counter`}
                label="Record sale"
                pending={sell.isPending}
                onOpenChange={(open) => {
                  if (!open) setSettlement(null);
                }}
                onConfirm={settle}
              />
            </ClientOnly>
          ) : null}
        </fieldset>
      </form>
      {blocker.status === "blocked" ? (
        <ConfirmDialog
          title="Discard this sale?"
          description="Nothing on the counter has been recorded yet."
          confirmLabel="Discard sale"
          open
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      ) : null}
    </>
  );
}
