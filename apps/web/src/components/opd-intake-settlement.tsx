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
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@hms/ui/components/field";
import { Input } from "@hms/ui/components/input";
import { Separator } from "@hms/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@hms/ui/components/toggle-group";
import { useIsMobile } from "@hms/ui/hooks/use-mobile";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { FinancialSummary } from "@/components/opd-intake-services";
import { type SelectedPatient } from "@/components/opd-patient-picker";
import { fromPaise } from "@hms/api/lib/invoice-math";

import { formatMoney, parseMoneyInput } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import {
  amountOf,
  needsReference,
  PAYMENT_METHODS,
  type PaymentLine,
  type PaymentMethod,
  type SettlementProblem,
} from "@/lib/settlement";

export type { PaymentLine } from "@/lib/settlement";

const loudProblem = (problems: SettlementProblem[], key: string) =>
  problems.find((problem) => problem.key === key && !problem.quiet);

function nextPayment(payments: PaymentLine[], remaining: number): PaymentLine {
  const used = new Set(payments.map((payment) => payment.method));
  const method = PAYMENT_METHODS.find((candidate) => !used.has(candidate.value))?.value ?? "cash";
  return {
    id: Math.max(0, ...payments.map((payment) => payment.id)) + 1,
    method,
    amount: remaining > 0 ? fromPaise(remaining) : "",
    reference: "",
  };
}

function SettlementFields({
  quote,
  discount,
  note,
  payments,
  pending,
  due,
  problems,
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
  problems: SettlementProblem[];
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLine[]) => void;
}) {
  const replace = (id: number, patch: Partial<PaymentLine>) =>
    onPaymentsChange(
      payments.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)),
    );

  const collecting = payments.reduce((sum, payment) => sum + (amountOf(payment) ?? 0), 0);
  const remaining = due - collecting;
  const overCollected = loudProblem(problems, "over-collected");
  const discountProblem = loudProblem(problems, "discount");
  const noteProblem = loudProblem(problems, "note");
  const balance = remaining > 0 ? remaining : 0;
  const reasonRequired = balance > 0 || (parseMoneyInput(discount.trim() || "0") ?? 0) > 0;

  const allocateRest = () => {
    const last = payments[payments.length - 1];
    if (!last) return onPaymentsChange([nextPayment(payments, remaining)]);
    onPaymentsChange(
      payments.map((payment) =>
        payment.id === last.id
          ? { ...payment, amount: fromPaise((amountOf(payment) ?? 0) + remaining) }
          : payment,
      ),
    );
  };

  return (
    <FieldGroup className="gap-4">
      <FinancialSummary quote={quote} />
      <Separator />

      <Field orientation="horizontal" data-invalid={Boolean(discountProblem) || undefined}>
        <FieldLabel
          htmlFor="settlement-discount"
          className="h-8 items-center text-muted-foreground"
        >
          Discount
        </FieldLabel>
        <FieldContent className="max-w-32">
          <Input
            id="settlement-discount"
            name="discount"
            inputMode="decimal"
            value={discount}
            placeholder="0"
            disabled={pending}
            aria-invalid={Boolean(discountProblem)}
            aria-describedby={discountProblem ? "settlement-discount-error" : undefined}
            className="tabular-nums text-right"
            onChange={(event) => onDiscountChange(event.target.value)}
          />
          <FieldError id="settlement-discount-error">{discountProblem?.message}</FieldError>
        </FieldContent>
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Payment</FieldLegend>
        <FieldGroup className="gap-3">
          {payments.map((payment, index) => {
            const amountProblem = loudProblem(problems, `amount:${payment.id}`);
            const referenceProblem = loudProblem(problems, `reference:${payment.id}`);
            const referenceRequired =
              (amountOf(payment) ?? 0) > 0 && needsReference(payment.method);
            return (
              <FieldGroup key={payment.id} className="gap-2">
                <div className="flex items-start gap-2">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel id={`payment-method-${payment.id}-label`}>
                      {payments.length > 1 ? `Payment ${index + 1}` : "Method"}
                    </FieldLabel>
                    <ToggleGroup
                      aria-labelledby={`payment-method-${payment.id}-label`}
                      value={[payment.method]}
                      variant="outline"
                      size="sm"
                      spacing={0}
                      disabled={pending}
                      onValueChange={(value) => {
                        const method = value[0] as PaymentMethod | undefined;
                        if (method) replace(payment.id, { method });
                      }}
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <ToggleGroupItem key={method.value} value={method.value}>
                          {method.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                  <Field
                    className="w-24 shrink-0 sm:w-28"
                    data-invalid={Boolean(amountProblem) || undefined}
                  >
                    <FieldLabel htmlFor={`payment-amount-${payment.id}`}>Amount</FieldLabel>
                    <Input
                      id={`payment-amount-${payment.id}`}
                      name={`payment-amount-${payment.id}`}
                      inputMode="decimal"
                      value={payment.amount}
                      disabled={pending}
                      aria-invalid={Boolean(amountProblem)}
                      aria-describedby={
                        amountProblem ? `payment-amount-${payment.id}-error` : undefined
                      }
                      className="tabular-nums text-right"
                      onChange={(event) => replace(payment.id, { amount: event.target.value })}
                    />
                    <FieldError id={`payment-amount-${payment.id}-error`}>
                      {amountProblem?.message}
                    </FieldError>
                  </Field>
                  {payments.length > 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="mt-6"
                      disabled={pending}
                      aria-label={`Remove payment ${index + 1}`}
                      onClick={() =>
                        onPaymentsChange(payments.filter((line) => line.id !== payment.id))
                      }
                    >
                      <Trash2Icon data-icon="inline-start" />
                    </Button>
                  ) : null}
                </div>
                {referenceRequired ? (
                  <Field data-invalid={Boolean(referenceProblem) || undefined}>
                    <FieldLabel htmlFor={`payment-reference-${payment.id}`}>
                      Reference <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id={`payment-reference-${payment.id}`}
                      name={`payment-reference-${payment.id}`}
                      value={payment.reference}
                      disabled={pending}
                      placeholder="Transaction reference"
                      aria-invalid={Boolean(referenceProblem)}
                      aria-describedby={
                        referenceProblem ? `payment-reference-${payment.id}-error` : undefined
                      }
                      onChange={(event) => replace(payment.id, { reference: event.target.value })}
                    />
                    <FieldError id={`payment-reference-${payment.id}-error`}>
                      {referenceProblem?.message}
                    </FieldError>
                  </Field>
                ) : null}
                {index < payments.length - 1 ? <Separator /> : null}
              </FieldGroup>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            disabled={pending || payments.length >= 4}
            onClick={() => onPaymentsChange([...payments, nextPayment(payments, remaining)])}
          >
            Add split payment
          </Button>
        </FieldGroup>
      </FieldSet>

      {remaining > 0 ? (
        <Field orientation="horizontal">
          <FieldTitle className="text-muted-foreground">
            Balance {formatMoney(fromPaise(remaining), quote.currency)}
          </FieldTitle>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={pending}
            onClick={allocateRest}
          >
            Fill remainder
          </Button>
        </Field>
      ) : null}
      <FieldError id="settlement-over-collected">{overCollected?.message}</FieldError>

      <Field data-invalid={Boolean(noteProblem) || undefined}>
        <FieldLabel htmlFor="settlement-note">
          Note {reasonRequired ? <span className="text-destructive">*</span> : null}
        </FieldLabel>
        <Textarea
          id="settlement-note"
          name="note"
          value={note}
          disabled={pending}
          aria-invalid={Boolean(noteProblem)}
          aria-describedby={noteProblem ? "settlement-note-error" : undefined}
          placeholder="Add details for reconciliation or an outstanding balance"
          onChange={(event) => onNoteChange(event.target.value)}
        />
        <FieldError id="settlement-note-error">{noteProblem?.message}</FieldError>
      </Field>
    </FieldGroup>
  );
}

function ConfirmAction({ pending, problem }: { pending: boolean; problem?: SettlementProblem }) {
  return (
    <div className="grid w-40 max-w-full">
      <SubmitButton
        isSubmitting={pending}
        aria-disabled={problem ? true : undefined}
        className="w-full aria-disabled:bg-primary aria-disabled:text-primary-foreground aria-disabled:hover:bg-primary/80"
      >
        Confirm walk-in
      </SubmitButton>
    </div>
  );
}

type SettlementInteriorProps = {
  header: ReactNode;
  footer: ReactNode;
  quote: WalkInQuote;
  discount: string;
  note: string;
  payments: PaymentLine[];
  pending: boolean;
  error: string | undefined;
  due: number;
  problems: SettlementProblem[];
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLine[]) => void;
  onConfirm: () => void;
};

function SettlementInterior({
  header,
  footer,
  quote,
  discount,
  note,
  payments,
  pending,
  error,
  due,
  problems,
  onDiscountChange,
  onNoteChange,
  onPaymentsChange,
  onConfirm,
}: SettlementInteriorProps) {
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      }}
    >
      <div className="border-b border-border">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-lg content-start gap-3 p-4">
          {error ? (
            <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
              {error}
            </p>
          ) : null}
          <SettlementFields
            quote={quote}
            discount={discount}
            note={note}
            payments={payments}
            pending={pending}
            due={due}
            problems={problems}
            onDiscountChange={onDiscountChange}
            onNoteChange={onNoteChange}
            onPaymentsChange={onPaymentsChange}
          />
        </div>
      </div>
      <div className="border-t border-border">{footer}</div>
    </form>
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
  error,
  due,
  problems,
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
  error?: string;
  due: number;
  problems: SettlementProblem[];
  onOpenChange: (open: boolean) => void;
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLine[]) => void;
  onConfirm: () => void;
}) {
  const mobile = useIsMobile();
  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => onOpenChange(false)}
      >
        Cancel
      </Button>
      <ConfirmAction pending={pending} problem={problems[0]} />
    </>
  );
  const interiorProps = {
    quote,
    discount,
    note,
    payments,
    pending,
    error,
    due,
    problems,
    onDiscountChange,
    onNoteChange,
    onPaymentsChange,
    onConfirm,
  };

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-svh">
          <SettlementInterior
            {...interiorProps}
            header={
              <SheetHeader className="mx-auto w-full max-w-lg border-0">
                <SheetTitle>Review and collect</SheetTitle>
                <SheetDescription>{patient.name} · walk-in now</SheetDescription>
              </SheetHeader>
            }
            footer={
              <SheetFooter className="mx-auto w-full max-w-lg justify-between border-0">
                {actions}
              </SheetFooter>
            }
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-xl gap-0 overflow-hidden p-0">
        <SettlementInterior
          {...interiorProps}
          header={
            <DialogHeader className="mx-auto w-full max-w-lg p-4">
              <DialogTitle>Review and collect</DialogTitle>
              <DialogDescription>{patient.name} · walk-in now</DialogDescription>
            </DialogHeader>
          }
          footer={
            <DialogFooter className="mx-auto w-full max-w-lg flex-row items-center justify-between p-4">
              {actions}
            </DialogFooter>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
