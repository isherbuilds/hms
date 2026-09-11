import { Button } from "@hms/ui/components/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@hms/ui/components/field";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Textarea } from "@hms/ui/components/textarea";

import { FinancialSummary } from "@/components/opd-financial-summary";
import { PaymentBalance, PaymentLine, PaymentLines } from "@/components/payment-lines";
import { formatDecimal } from "@hms/api/core/money";
import { parseMoneyInput, ZERO } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import {
  amountOf,
  collectedPaise,
  MAX_PAYMENT_LINES,
  methodLabel,
  needsReference,
  nextPaymentLine,
  PAYMENT_METHODS,
  type PaymentLine as PaymentLineValue,
  type PaymentMethod,
  type SettlementProblem,
} from "@/lib/settlement";

const loudProblem = (problems: SettlementProblem[], key: string) =>
  problems.find((problem) => problem.key === key && !problem.quiet);

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
  payments: PaymentLineValue[];
  pending: boolean;
  due: bigint;
  problems: SettlementProblem[];
  onDiscountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPaymentsChange: (payments: PaymentLineValue[]) => void;
}) {
  const replace = (id: number, patch: Partial<PaymentLineValue>) =>
    onPaymentsChange(
      payments.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)),
    );

  const remaining = due - collectedPaise(payments);
  const overCollected = loudProblem(problems, "over-collected");
  const discountProblem = loudProblem(problems, "discount");
  const noteProblem = loudProblem(problems, "note");

  const reasonRequired =
    remaining > ZERO || (parseMoneyInput(discount.trim() || "0") ?? ZERO) > ZERO;

  const allocateRest = () => {
    const last = payments[payments.length - 1];

    if (!last) return onPaymentsChange([nextPaymentLine(payments, remaining)]);
    onPaymentsChange(
      payments.map((payment) =>
        payment.id === last.id
          ? { ...payment, amount: formatDecimal((amountOf(payment) ?? ZERO) + remaining) }
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
          <PaymentLines removable={payments.length > 1}>
            {payments.map((payment, index) => {
              const amountProblem = loudProblem(problems, `amount:${payment.id}`);
              const referenceProblem = loudProblem(problems, `reference:${payment.id}`);
              const referenceRequired = (amountOf(payment) ?? ZERO) > ZERO;

              return (
                <PaymentLine
                  key={payment.id}
                  disabled={pending}
                  removeLabel={`Remove payment ${index + 1}`}
                  onRemove={
                    payments.length > 1
                      ? () => onPaymentsChange(payments.filter((line) => line.id !== payment.id))
                      : undefined
                  }
                  method={
                    <Field>
                      <NativeSelect
                        id={`payment-method-${payment.id}`}
                        name={`payment-method-${payment.id}`}
                        aria-label={`Payment ${index + 1} method`}
                        value={payment.method}
                        disabled={pending}
                        onChange={(event) => {
                          // SAFETY: the options are rendered from PAYMENT_METHODS.
                          replace(payment.id, { method: event.target.value as PaymentMethod });
                        }}
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {methodLabel(method)}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  }
                  amount={
                    <Field data-invalid={Boolean(amountProblem) || undefined}>
                      <Input
                        id={`payment-amount-${payment.id}`}
                        name={`payment-amount-${payment.id}`}
                        aria-label={`Payment ${index + 1} amount`}
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
                  }
                  reference={
                    needsReference(payment.method) ? (
                      <Field data-invalid={Boolean(referenceProblem) || undefined}>
                        <Input
                          id={`payment-reference-${payment.id}`}
                          name={`payment-reference-${payment.id}`}
                          aria-label={`Payment ${index + 1} ${methodLabel(payment.method)} reference`}
                          defaultValue={payment.reference}
                          disabled={pending}
                          placeholder={`${methodLabel(payment.method)} reference${
                            referenceRequired ? " *" : ""
                          }`}
                          aria-invalid={Boolean(referenceProblem)}
                          aria-describedby={
                            referenceProblem ? `payment-reference-${payment.id}-error` : undefined
                          }
                          onBlur={(event) => replace(payment.id, { reference: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              replace(payment.id, { reference: event.currentTarget.value });
                            }
                          }}
                        />
                        <FieldError id={`payment-reference-${payment.id}-error`}>
                          {referenceProblem?.message}
                        </FieldError>
                      </Field>
                    ) : null
                  }
                />
              );
            })}
          </PaymentLines>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || payments.length >= MAX_PAYMENT_LINES}
              onClick={() => {
                const line = nextPaymentLine(payments, remaining);
                onPaymentsChange([...payments, line]);
                requestAnimationFrame(() =>
                  document.getElementById(`payment-amount-${line.id}`)?.focus(),
                );
              }}
            >
              Split payment
            </Button>
            <PaymentBalance
              remaining={remaining}
              currency={quote.currency}
              disabled={pending}
              onFill={allocateRest}
            />
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldError id="settlement-over-collected">{overCollected?.message}</FieldError>

      <Field data-invalid={Boolean(noteProblem) || undefined}>
        <FieldLabel htmlFor="settlement-note">
          Note {reasonRequired ? <span className="text-destructive">*</span> : null}
        </FieldLabel>
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
