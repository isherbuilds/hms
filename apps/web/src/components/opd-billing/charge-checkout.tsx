import { Button } from "@hms/ui/components/button";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { cn } from "@hms/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FinancialSummary } from "@/components/opd-financial-summary";
import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import { formatMoney, ZERO } from "@/lib/money";
import { servicePreview } from "@/lib/opd-service-preview";
import { useOpdErrorToast } from "@/lib/opd-error";
import { errorMessage, hasErrorCode } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

import { useBillingInvalidation } from "./use-billing-invalidation";

type PendingCharge = {
  id: string;
  description: string;
  qty: number;
  unitPrice: bigint;
  taxRatePercent: string;
  revenueCategory: string;
};

function quotedAmount(grossById: Map<string, bigint>, chargeId: string): bigint {
  const amount = grossById.get(chargeId);

  if (amount === undefined) throw new Error(`Quote missing pending charge ${chargeId}`);

  return amount;
}

// Charges are raised where the care is ordered, so "nothing to invoice" is a state
// of the appointment rather than something to fix here.
const CHARGES_MOVED = {
  message: "Charges changed. Review the current charges before settling.",
  fieldId: "review-updated-charges",
} as const;

// Collection happens in `SettlementOverlay` — the same overlay the intake desk
// confirms a walk-in through — so there is one settlement screen in the product.
export function ChargeCheckout({
  orgSlug,
  appointmentId,
  pending,
  chargeRevision,
  currency,
  /** `billing:write`. Without it this is a priced list and nothing more. */
  canSettle,
  onVoid,
}: {
  orgSlug: string;
  appointmentId: string;
  pending: PendingCharge[];
  chargeRevision: number;
  currency: string;
  canSettle: boolean;
  onVoid: (charge: { id: string; description: string }) => void;
}) {
  const onOpdError = useOpdErrorToast(orgSlug);
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const [reviewed, setReviewed] = useState(() => ({ pending, chargeRevision }));
  const [collecting, setCollecting] = useState(false);
  const chargesChanged = chargeRevision !== reviewed.chargeRevision;
  // Shown charges follow the reviewed snapshot, so a total cannot change mid-count.
  const shown = canSettle ? reviewed.pending : pending;

  const quote = servicePreview(
    shown.map((charge) => ({
      catalogItemId: charge.id,
      name: charge.description,
      category: charge.revenueCategory,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      taxRatePercent: charge.taxRatePercent,
    })),
    currency,
  );

  const grossById = new Map(quote.lines.map((line) => [line.chargeId, line.gross]));
  const reason = chargesChanged ? CHARGES_MOVED : undefined;

  const mutation = useMutation(
    orpc.billing.settleCharges.mutationOptions({
      onSuccess: ({ invoice, chargeRevision: settledRevision }) => {
        setCollecting(false);
        setReviewed({ pending: [], chargeRevision: settledRevision });
        toast.success(`Invoice ${invoice.invoiceNumber} issued`);
        void invalidate(invoice.id);
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) setCollecting(false);

        return onOpdError(appointmentId, "billing", error);
      },
    }),
  );

  const settle = (draft: SettlementDraft) =>
    mutation.mutate({
      orgSlug,
      appointmentId,
      expectedChargeRevision: reviewed.chargeRevision,
      ...draft,
    });

  const issue = () => {
    if (reason) {
      document.getElementById(reason.fieldId)?.focus();

      return;
    }

    // Nothing to collect, so there is nothing for the overlay to ask.
    if (quote.grandTotal === ZERO) {
      settle({ discountAmount: ZERO, expectedGrandTotal: quote.grandTotal, payments: [] });

      return;
    }

    setCollecting(true);
  };

  return (
    <div
      className={cn("grid gap-4", canSettle && "lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]")}
    >
      <section className="min-w-0">
        {chargesChanged ? (
          <div className="mb-3 flex items-center justify-between gap-3 border-l-2 border-destructive pl-3">
            <p className="text-destructive">
              Charges changed on another terminal. Your reviewed total is preserved.
            </p>
            <Button
              id="review-updated-charges"
              type="button"
              size="xs"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setReviewed({ pending, chargeRevision });
                mutation.reset();
              }}
            >
              Review updated charges
            </Button>
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="w-16 text-right">Qty</TableHead>
              <TableHead className="w-32 text-right">Unit price</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
              {canSettle ? <TableHead className="w-16" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((charge) => (
              <TableRow key={charge.id}>
                <TableCell className="font-medium">{charge.description}</TableCell>
                <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(charge.unitPrice, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(quotedAmount(grossById, charge.id), currency)}
                </TableCell>
                {canSettle ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={mutation.isPending}
                      aria-label={`Void ${charge.description}`}
                      onClick={() => onVoid(charge)}
                    >
                      Void
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {canSettle ? (
        <aside className="min-w-0 border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
          <div className="grid gap-3">
            <h3 className="text-xs text-muted-foreground">Invoice</h3>
            <FinancialSummary quote={quote} />
            <SubmitButton
              type="button"
              isSubmitting={mutation.isPending}
              aria-disabled={reason ? true : undefined}
              aria-describedby={reason ? "charge-checkout-issue" : undefined}
              onClick={issue}
            >
              {quote.grandTotal === ZERO ? "Issue invoice" : "Review and collect"}
            </SubmitButton>
            {reason ? (
              <p id="charge-checkout-issue" className="text-muted-foreground">
                {reason.message}
              </p>
            ) : null}
          </div>
        </aside>
      ) : null}

      {collecting ? (
        <ClientOnly fallback={null}>
          <SettlementOverlay
            quote={quote}
            description={`${quote.lines.length} charge${quote.lines.length === 1 ? "" : "s"} on this appointment`}
            label="Issue invoice"
            pending={mutation.isPending}
            error={
              mutation.error
                ? errorMessage(mutation.error, "Could not settle the charges")
                : undefined
            }
            blockedReason={chargesChanged ? CHARGES_MOVED.message : undefined}
            onOpenChange={(open) => {
              if (open) return;
              setCollecting(false);
              mutation.reset();
            }}
            onConfirm={settle}
          />
        </ClientOnly>
      ) : null}
    </div>
  );
}
