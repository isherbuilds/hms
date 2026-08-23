import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useIsMobile } from "@hms/ui/hooks/use-mobile";
import { Trash2Icon } from "lucide-react";

import { FinancialSummary, type WalkInQuote } from "@/components/opd-intake-services";
import { type SelectedPatient } from "@/components/opd-patient-picker";
import { fromPaise } from "@hms/api/lib/invoice-math";

import { formatMoney, parseMoneyInput } from "@/lib/money";

export type PaymentLine = {
  id: number;
  method: "cash" | "upi" | "card";
  amount: string;
  reference: string;
};

function SettlementFields({
  quote,
  discount,
  note,
  payments,
  pending,
  due,
  collecting,
  balance,
  paymentInvalid,
  discountInvalid,
  needsNote,
  onDiscountChange,
  onNoteChange,
  onPaymentsChange,
}: {
  quote: WalkInQuote;
  discount: string;
  note: string;
  payments: PaymentLine[];
  pending: boolean;
  due: number;
  collecting: number;
  balance: number;
  paymentInvalid: boolean;
  discountInvalid: boolean;
  needsNote: boolean;
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLine[]) => void;
}) {
  const replace = (id: number, patch: Partial<PaymentLine>) =>
    onPaymentsChange(
      payments.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)),
    );

  return (
    <div className="grid gap-4">
      <FinancialSummary quote={quote} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-muted-foreground">Discount</span>
          <Input
            id="settlement-discount"
            name="discount"
            inputMode="decimal"
            value={discount}
            placeholder="0"
            disabled={pending}
            aria-invalid={discountInvalid}
            className="tabular-nums"
            onChange={(event) => onDiscountChange(event.target.value)}
          />
        </label>
        <label className="grid gap-2">
          <span className="text-muted-foreground">
            Reason {needsNote ? <span className="text-destructive">*</span> : null}
          </span>
          <Input
            id="settlement-note"
            name="note"
            value={note}
            disabled={pending}
            placeholder={balance > 0 ? "Why is a balance being left?" : "Discount reason"}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-3">
        {payments.map((payment, index) => (
          <div
            key={payment.id}
            className="grid items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_8rem_auto]"
          >
            <label className="grid gap-2">
              <span className="text-muted-foreground">{index === 0 ? "Payment" : "And"}</span>
              <NativeSelect
                id={`payment-method-${payment.id}`}
                name={`payment-method-${payment.id}`}
                value={payment.method}
                disabled={pending}
                onChange={(event) =>
                  replace(payment.id, { method: event.target.value as PaymentLine["method"] })
                }
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
              </NativeSelect>
            </label>
            <label className="grid gap-2">
              <span className="text-muted-foreground">Reference</span>
              <Input
                id={`payment-reference-${payment.id}`}
                name={`payment-reference-${payment.id}`}
                value={payment.reference}
                disabled={pending || payment.method === "cash"}
                placeholder={payment.method === "cash" ? "Not needed" : "Transaction reference"}
                onChange={(event) => replace(payment.id, { reference: event.target.value })}
              />
            </label>
            <label className="grid gap-2">
              <span className="text-muted-foreground">Amount</span>
              <Input
                id={`payment-amount-${payment.id}`}
                name={`payment-amount-${payment.id}`}
                inputMode="decimal"
                value={payment.amount}
                disabled={pending}
                aria-invalid={parseMoneyInput(payment.amount.trim() || "0") === null}
                className="tabular-nums"
                onChange={(event) => replace(payment.id, { amount: event.target.value })}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || payments.length === 1}
              aria-label={`Remove payment ${index + 1}`}
              onClick={() => onPaymentsChange(payments.filter((line) => line.id !== payment.id))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={pending || payments.length >= 4}
          onClick={() =>
            onPaymentsChange([
              ...payments,
              {
                id: Math.max(...payments.map((payment) => payment.id)) + 1,
                method: "upi",
                amount: "",
                reference: "",
              },
            ])
          }
        >
          Split payment
        </Button>
      </div>

      {discountInvalid || paymentInvalid ? (
        <p role="alert" className="text-destructive">
          Amounts can have up to two decimal places.
        </p>
      ) : collecting > due ? (
        <p role="alert" className="text-destructive">
          Payment exceeds the bill by {formatMoney(fromPaise(collecting - due), quote.currency)}.
        </p>
      ) : balance > 0 ? (
        <p className="text-muted-foreground">
          Balance after confirmation: {formatMoney(fromPaise(balance), quote.currency)}.
        </p>
      ) : null}
    </div>
  );
}

export function SettlementOverlay({
  open,
  quote,
  patient,
  discount,
  note,
  payments,
  pending,
  canConfirm,
  due,
  collecting,
  balance,
  paymentInvalid,
  discountInvalid,
  needsNote,
  onOpenChange,
  onDiscountChange,
  onNoteChange,
  onPaymentsChange,
  onConfirm,
}: {
  open: boolean;
  quote: WalkInQuote;
  patient: SelectedPatient;
  discount: string;
  note: string;
  payments: PaymentLine[];
  pending: boolean;
  canConfirm: boolean;
  due: number;
  collecting: number;
  balance: number;
  paymentInvalid: boolean;
  discountInvalid: boolean;
  needsNote: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLine[]) => void;
  onConfirm: () => void;
}) {
  const mobile = useIsMobile();
  const fields = (
    <SettlementFields
      quote={quote}
      discount={discount}
      note={note}
      payments={payments}
      pending={pending}
      due={due}
      collecting={collecting}
      balance={balance}
      paymentInvalid={paymentInvalid}
      discountInvalid={discountInvalid}
      needsNote={needsNote}
      onDiscountChange={onDiscountChange}
      onNoteChange={onNoteChange}
      onPaymentsChange={onPaymentsChange}
    />
  );

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Review and collect</SheetTitle>
            <SheetDescription>{patient.name} · walk-in now</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-4">
            {fields}
            <SubmitButton isSubmitting={pending} disabled={!canConfirm} onClick={onConfirm}>
              Confirm walk-in
            </SubmitButton>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review and collect</DialogTitle>
          <DialogDescription>{patient.name} · walk-in now</DialogDescription>
        </DialogHeader>
        {fields}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Back
          </Button>
          <SubmitButton isSubmitting={pending} disabled={!canConfirm} onClick={onConfirm}>
            Confirm walk-in
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
