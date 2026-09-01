import { fromPaise } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@hms/ui/components/field";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Textarea } from "@hms/ui/components/textarea";
import { Trash2Icon } from "lucide-react";

import { FinancialSummary } from "@/components/opd-financial-summary";
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
  // Four-way splits are valid even though the desk supports three methods.
  const method = PAYMENT_METHODS.find((candidate) => !used.has(candidate.value))?.value ?? "cash";
  return {
    id: Math.max(0, ...payments.map((payment) => payment.id)) + 1,
    method,
    amount: remaining > 0 ? fromPaise(remaining) : "",
    reference: "",
  };
}

export function SettlementFields({
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
      <FinancialSummary
        quote={quote}
        discountRow={
          <div
            className="flex items-center justify-between gap-3"
            data-invalid={Boolean(discountProblem) || undefined}
          >
            <dt>
              <FieldLabel htmlFor="settlement-discount" className="text-muted-foreground">
                Discount
              </FieldLabel>
            </dt>
            <dd className="flex w-28 flex-none flex-col items-end gap-0.5 text-right">
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
            </dd>
          </div>
        }
      />

      <FieldSet>
        <FieldLegend variant="label">Payment</FieldLegend>
        <FieldGroup className="gap-3">
          {payments.map((payment, index) => {
            const amountProblem = loudProblem(problems, `amount:${payment.id}`);
            const referenceProblem = loudProblem(problems, `reference:${payment.id}`);
            const takesReference = needsReference(payment.method);
            const referenceRequired = takesReference && (amountOf(payment) ?? 0) > 0;
            return (
              <FieldGroup key={payment.id} className="gap-2">
                <div className="flex items-start gap-2">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor={`payment-method-${payment.id}`}>
                      {payments.length > 1 ? `Payment ${index + 1}` : "Method"}
                    </FieldLabel>
                    <NativeSelect
                      id={`payment-method-${payment.id}`}
                      name={`payment-method-${payment.id}`}
                      value={payment.method}
                      disabled={pending}
                      onChange={(event) =>
                        replace(payment.id, { method: event.target.value as PaymentMethod })
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </NativeSelect>
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
                {takesReference ? (
                  <Field data-invalid={Boolean(referenceProblem) || undefined}>
                    <FieldLabel htmlFor={`payment-reference-${payment.id}`}>
                      Reference{" "}
                      {referenceRequired ? <span className="text-destructive">*</span> : null}
                    </FieldLabel>
                    {/* Nothing on screen derives from the reference until it settles,
                        so the DOM holds it and a keystroke renders nothing. */}
                    <Input
                      id={`payment-reference-${payment.id}`}
                      name={`payment-reference-${payment.id}`}
                      defaultValue={payment.reference}
                      disabled={pending}
                      placeholder="Transaction reference"
                      aria-invalid={Boolean(referenceProblem)}
                      aria-describedby={
                        referenceProblem ? `payment-reference-${payment.id}-error` : undefined
                      }
                      onBlur={(event) => replace(payment.id, { reference: event.target.value })}
                      onKeyDown={(event) => {
                        // Enter submits the form and the submit handler reads state, so
                        // the reference has to land before the browser gets there.
                        if (event.key === "Enter") {
                          replace(payment.id, { reference: event.currentTarget.value });
                        }
                      }}
                    />
                    <FieldError id={`payment-reference-${payment.id}-error`}>
                      {referenceProblem?.message}
                    </FieldError>
                  </Field>
                ) : null}
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
        {/* The note drives no readout either, so it settles on blur too. The key
            re-seeds the box when a settled draft clears the note behind it. */}
        <Textarea
          key={note}
          id="settlement-note"
          name="note"
          defaultValue={note}
          disabled={pending}
          aria-invalid={Boolean(noteProblem)}
          aria-describedby={noteProblem ? "settlement-note-error" : undefined}
          placeholder="Add details for reconciliation or an outstanding balance"
          onBlur={(event) => onNoteChange(event.target.value)}
        />
        <FieldError id="settlement-note-error">{noteProblem?.message}</FieldError>
      </Field>
    </FieldGroup>
  );
}
