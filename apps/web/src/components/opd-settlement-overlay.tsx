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
import { Input } from "@hms/ui/components/input";
import { useIsMobile } from "@hms/ui/hooks/use-mobile";
import { useState, type ReactNode } from "react";

import { SettlementFields } from "@/components/opd-settlement-fields";
import { formatDecimal } from "@hms/api/core/money";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { applyDiscount, type WalkInQuote } from "@/lib/opd-service-preview";
import {
  amountOf,
  type PaymentLine,
  type PaymentMethod,
  settlementProblems,
} from "@/lib/settlement";

export type SettlementDraft = {
  discountAmount: bigint;
  expectedGrandTotal: bigint;
  note?: string;
  payments: { method: PaymentMethod; amount: bigint; reference?: string }[];
  applyCredit: bigint;
};

type SettlementOverlayProps = {
  /** Before any discount: the overlay discounts its own copy rather than re-rendering the page behind it on every digit. */
  quote: WalkInQuote;
  description: string;
  label: string;
  pending: boolean;
  availableCredit: bigint;
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
  availableCredit,
  onOpenChange,
  onConfirm,
}: SettlementOverlayProps) {
  const mobile = useIsMobile();
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");

  // Credit is applied unless the cashier says otherwise; cash covers what is left.
  const seededCredit = availableCredit < quote.grandTotal ? availableCredit : quote.grandTotal;

  // Null until the cashier types, so the field follows the post-discount cap. A seeded
  // string would sit above that cap the moment a discount is entered and block the submit.
  const [credit, setCredit] = useState<string | null>(null);

  const [payments, setPayments] = useState<PaymentLine[]>(() => [
    {
      id: 1,
      method: "cash",
      amount: formatDecimal(quote.grandTotal - seededCredit),
      reference: "",
    },
  ]);

  // Quiet problems stay quiet until the operator has tried to confirm.
  const [attempted, setAttempted] = useState(false);

  const discountPaise = parseMoneyInput(discount.trim() || "0");

  // An invalid discount is reported by `settlementProblems`; the bill stays on the
  // undiscounted figures until it is fixed.
  const discounted =
    discountPaise !== null && discountPaise <= quote.subtotal
      ? applyDiscount(quote, discountPaise)
      : quote;

  const creditCap =
    availableCredit < discounted.grandTotal ? availableCredit : discounted.grandTotal;

  const creditValue = credit ?? formatDecimal(creditCap);
  const parsedCredit = parseMoneyInput(creditValue.trim() || "0");
  const creditInvalid = parsedCredit === null || parsedCredit > creditCap;
  const appliedCredit = creditInvalid ? ZERO : parsedCredit;

  const due = discounted.grandTotal - appliedCredit;

  const problems = settlementProblems({
    due,
    subtotal: quote.subtotal,
    discount,
    note,
    payments,
    attempted,
    currency: quote.currency,
  });

  const confirm = () => {
    if (blockedReason) return;
    setAttempted(true);

    if (creditInvalid) return focusProblemField("settlement-credit", true);
    const [blocking] = problems;

    if (blocking) return focusProblemField(blocking.fieldId, blocking.selectOnFocus);

    onConfirm({
      discountAmount: discountPaise ?? ZERO,
      expectedGrandTotal: discounted.grandTotal,
      note: note.trim() || undefined,
      payments: payments.flatMap((payment) => {
        const amount = amountOf(payment);

        if (amount === null || amount === ZERO) return [];

        return [
          { method: payment.method, amount, reference: payment.reference.trim() || undefined },
        ];
      }),
      applyCredit: appliedCredit,
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
          {blockedReason ? (
            <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
              {blockedReason}
            </p>
          ) : null}
          {availableCredit > ZERO ? (
            <label
              className="flex flex-col gap-1 text-muted-foreground"
              htmlFor="settlement-credit"
            >
              Credit available {formatMoney(availableCredit, quote.currency)}
              <Input
                id="settlement-credit"
                name="applyCredit"
                inputMode="decimal"
                value={creditValue}
                disabled={pending}
                aria-invalid={creditInvalid}
                className="text-right tabular-nums"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const applied = parseMoneyInput(value.trim() || "0") ?? ZERO;
                  const [line] = payments;

                  setCredit(value);

                  if (line && payments.length === 1) {
                    const rest = discounted.grandTotal - applied;

                    setPayments([{ ...line, amount: formatDecimal(rest > ZERO ? rest : ZERO) }]);
                  }
                }}
              />
              {creditInvalid ? (
                <span className="text-destructive">
                  Apply at most {formatMoney(creditCap, quote.currency)}
                </span>
              ) : null}
            </label>
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

  const blocked = problems.length > 0 || blockedReason !== undefined || creditInvalid;

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
