import { toPaise } from "@hms/api/lib/invoice-math";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useIsMobile } from "@hms/ui/hooks/use-mobile";
import { useState, type ReactNode } from "react";

import { SettlementFields } from "@/components/opd-settlement-fields";
import { MONEY_INPUT_PATTERN, parseMoneyInput } from "@/lib/money";
import { applyDiscount, type WalkInQuote } from "@/lib/opd-service-preview";
import {
  amountOf,
  type PaymentLine,
  type PaymentMethod,
  settlementProblems,
} from "@/lib/settlement";

export type SettlementDraft = {
  discountAmount: string;
  expectedGrandTotal: string;
  note?: string;
  payments: { method: PaymentMethod; amount: string; reference?: string }[];
};

type SettlementOverlayProps = {
  /** Before any discount: the overlay discounts its own copy rather than re-rendering the page behind it on every digit. */
  quote: WalkInQuote;
  description: string;
  label: string;
  pending: boolean;
  error?: string;
  /**
   * A reason the page behind knows and the draft cannot — charges that moved on
   * another terminal. Blocks the submit, because the server would refuse the stale
   * revision anyway.
   */
  blockedReason?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (settlement: SettlementDraft) => void;
};

function focusProblemField(fieldId: string, selectOnFocus?: boolean) {
  const field = document.getElementById(fieldId);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.focus();
    if (selectOnFocus) field.select();
    return;
  }
  field?.focus();
}

// Mounted only while open, which is what lets the draft start from the quote with
// no effect and no "did it just open?" bookkeeping.
export function SettlementOverlay({
  quote,
  description,
  label,
  blockedReason,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: SettlementOverlayProps) {
  const mobile = useIsMobile();
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>(() => [
    { id: 1, method: "cash", amount: quote.grandTotal, reference: "" },
  ]);
  // Quiet problems stay quiet until the operator has tried to confirm.
  const [attempted, setAttempted] = useState(false);

  const normalizedDiscount = discount.trim() || "0";
  const discountPaise = MONEY_INPUT_PATTERN.test(normalizedDiscount)
    ? parseMoneyInput(normalizedDiscount)
    : null;
  // An invalid discount is reported by `settlementProblems`; the bill stays on the
  // undiscounted figures until it is fixed.
  const discounted =
    discountPaise !== null && discountPaise <= toPaise(quote.subtotal)
      ? applyDiscount(quote, normalizedDiscount)
      : quote;
  const due = toPaise(discounted.grandTotal);
  const problems = settlementProblems({
    due,
    subtotal: toPaise(quote.subtotal),
    discount,
    note,
    payments,
    attempted,
    currency: quote.currency,
  });

  const confirm = () => {
    if (blockedReason) return;
    setAttempted(true);
    const [blocking] = problems;
    if (blocking) return focusProblemField(blocking.fieldId, blocking.selectOnFocus);

    onConfirm({
      discountAmount: normalizedDiscount,
      expectedGrandTotal: discounted.grandTotal,
      note: note.trim() || undefined,
      payments: payments
        .filter((payment) => (amountOf(payment) ?? 0) > 0)
        .map((payment) => ({
          method: payment.method,
          amount: payment.amount.trim(),
          reference: payment.reference.trim() || undefined,
        })),
    });
  };

  const body = (header: ReactNode, footer: ReactNode) => (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        // Both callers sit inside a form of their own; without this their submit handler
        // runs too and reopens the overlay that just confirmed.
        event.stopPropagation();
        confirm();
      }}
    >
      <div className="border-b border-border">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-lg content-start gap-3 p-4">
          {(error ?? blockedReason) ? (
            <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
              {error ?? blockedReason}
            </p>
          ) : null}
          <SettlementFields
            quote={discounted}
            discount={discount}
            note={note}
            payments={payments}
            pending={pending}
            due={due}
            problems={problems}
            onDiscountChange={setDiscount}
            onNoteChange={setNote}
            onPaymentsChange={setPayments}
          />
        </div>
      </div>
      <div className="border-t border-border">{footer}</div>
    </form>
  );

  const blocked = problems.length > 0 || blockedReason !== undefined;

  const submit = (
    <SubmitButton
      isSubmitting={pending}
      aria-disabled={blocked || undefined}
      className="w-40 max-w-full aria-disabled:bg-primary aria-disabled:text-primary-foreground aria-disabled:hover:bg-primary/80"
    >
      {label}
    </SubmitButton>
  );

  if (mobile) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-svh">
          {body(
            <SheetHeader className="mx-auto w-full max-w-lg border-0">
              <SheetTitle>Review and collect</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>,
            <SheetFooter className="mx-auto w-full max-w-lg border-0">{submit}</SheetFooter>,
          )}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-xl gap-0 overflow-hidden p-0">
        {body(
          <DialogHeader className="mx-auto w-full max-w-lg p-4">
            <DialogTitle>Review and collect</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>,
          <DialogFooter className="mx-auto w-full max-w-lg flex-row p-4">{submit}</DialogFooter>,
        )}
      </DialogContent>
    </Dialog>
  );
}
