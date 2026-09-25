import { Button } from "@hms/ui/components/button";
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FormState, useFieldArray, useFormContext, Watch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PaymentBalance, PaymentLine, PaymentLines } from "@/components/payment-lines";
import { useZodForm } from "@/hooks/use-zod-form";
import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { creditAvailableLabel, type PatientCredit } from "@/lib/patient-credit";
import { closeOnConflict } from "@/lib/orpc-error";
import {
  collectedPaise,
  MAX_PAYMENT_LINES,
  methodLabel,
  needsReference,
  nextPaymentLine,
  paymentFormSchema,
  PAYMENT_METHODS,
} from "@/lib/settlement";

const recordPaymentSchema = paymentFormSchema.extend({
  applyCredit: z.string().regex(DECIMAL_PATTERN, "Amount like 150.00").transform(parseDecimal),
});

function RecordPaymentLine({
  index,
  disabled,
  removable,
  remove,
}: {
  index: number;
  disabled: boolean;
  removable: boolean;
  remove: (index: number) => void;
}) {
  const { control } = useFormContext<z.input<typeof recordPaymentSchema>>();

  return (
    <PaymentLine
      disabled={disabled}
      removeLabel={`Remove payment ${index + 1}`}
      onRemove={removable ? () => remove(index) : undefined}
      method={
        <RegisteredFormField
          name={`payments.${index}.method`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <NativeSelect
                  {...field}
                  aria-label={`Payment ${index + 1} method`}
                  disabled={disabled}
                >
                  {PAYMENT_METHODS.map((option) => (
                    <option key={option} value={option}>
                      {methodLabel(option)}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
            </FormItem>
          )}
        />
      }
      amount={
        <RegisteredFormField
          name={`payments.${index}.amount`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  aria-label={`Payment ${index + 1} amount received`}
                  inputMode="decimal"
                  disabled={disabled}
                  className="text-right tabular-nums"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      }
      reference={
        // Only this line watches its method, so choosing one does not
        // re-render the form around it.
        <Watch
          control={control}
          name={`payments.${index}.method`}
          exact
          render={(method) =>
            needsReference(method) ? (
              <RegisteredFormField
                name={`payments.${index}.reference`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        aria-label={`Payment ${index + 1} reference`}
                        className="font-mono"
                        disabled={disabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null
          }
        />
      }
    />
  );
}

type RecordPaymentFormProps = {
  orgSlug: string;
  invoiceId: string;
  /** The server's figure; the form never recomputes it. */
  outstanding: bigint;
  /** Read when the overlay opened, so nothing here waits on a credit query. */
  availableCredit: PatientCredit;
  currency: string;
  /** After a recorded payment, and on CONFLICT: the overlay holds a stale snapshot. */
  onClose: () => void;
  submitLabel: string;
  /** Rendered beside the submit button. */
  actions?: ReactNode;
};

/**
 * Records money against an issued invoice. The billing worklist sheet and the
 * visit's invoice card both render this one form, so the split-line rules, the
 * ceiling on the total, and the CONFLICT recovery cannot drift apart.
 */
export function RecordPaymentForm({
  orgSlug,
  invoiceId,
  outstanding,
  availableCredit,
  currency,
  onClose,
  submitLabel,
  actions,
}: RecordPaymentFormProps) {
  // Credit is applied unless the cashier says otherwise; the line covers what is left.
  const seededCredit = availableCredit.usable < outstanding ? availableCredit.usable : outstanding;

  const form = useZodForm(recordPaymentSchema, {
    defaultValues: {
      payments: [
        { id: 1, method: "cash", amount: formatDecimal(outstanding - seededCredit), reference: "" },
      ],
      applyCredit: formatDecimal(seededCredit),
    },
  });

  const lines = useFieldArray({ control: form.control, name: "payments", keyName: "fieldKey" });

  // Reads on demand, so the amounts stay uncontrolled and typing re-renders nothing.
  const fillLastLine = (effectiveDue: bigint) => {
    const payments = form.getValues("payments");
    const index = payments.length - 1;
    const line = payments[index];

    if (!line) return;
    const remaining = effectiveDue - collectedPaise(payments);
    form.setValue(
      `payments.${index}.amount`,
      formatDecimal((parseMoneyInput(line.amount) ?? ZERO) + remaining),
    );
  };

  const record = useMutation(
    orpc.billing.recordPayments.mutationOptions({
      onSuccess: (_data, variables) => {
        onClose();
        toast.success(
          variables.payments?.length === 1
            ? "Payment recorded"
            : variables.payments?.length
              ? "Split payment recorded"
              : "Credit applied",
        );
      },
      onError: closeOnConflict(onClose),
    }),
  );

  const pending = record.isPending;

  return (
    <Form {...form}>
      {/* `noValidate`: Zod owns every message here. */}
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={form.handleSubmit((values) => {
          if (values.applyCredit > availableCredit.total) {
            form.setError("applyCredit", { message: "That credit is no longer available" });

            return;
          }

          // An empty line is how a bill the credit covers submits; the server takes none.
          const payments = values.payments.filter((payment) => payment.amount > ZERO);

          const collected =
            payments.reduce((sum, payment) => sum + payment.amount, ZERO) + values.applyCredit;

          if (collected === ZERO) {
            form.setError("root", { message: "Enter an amount, or apply credit" });

            return;
          }

          if (collected > outstanding) {
            form.setError("root", {
              message: `More than the ${formatMoney(outstanding, currency)} outstanding`,
            });

            return;
          }

          record.mutate({
            orgSlug,
            invoiceId,
            payments: payments.map(({ id: _id, ...payment }) => ({
              ...payment,
              reference: payment.reference || undefined,
            })),
            applyCredit: values.applyCredit,
          });
        })}
      >
        {availableCredit.total > ZERO ? (
          <RegisteredFormField
            name="applyCredit"
            render={({ field }) => (
              <FormItem>
                {/* `FormLabel` owns the association: `FormControl` overwrites a hand-written
                    id on its child, which would leave the label pointing at nothing. */}
                <FormLabel className="text-muted-foreground tabular-nums">
                  <span className="font-medium text-foreground">Use advance credit</span> ·{" "}
                  {creditAvailableLabel(availableCredit, currency)}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="decimal"
                    disabled={pending}
                    className="text-right tabular-nums"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <PaymentLines removable={lines.fields.length > 1}>
          {lines.fields.map((line, index) => (
            <RecordPaymentLine
              key={line.fieldKey}
              index={index}
              disabled={pending}
              removable={lines.fields.length > 1}
              remove={lines.remove}
            />
          ))}
        </PaymentLines>
        {/* Total-level rules live on the root; only this leaf re-renders on errors. */}
        <FormState
          control={form.control}
          render={({ errors }) =>
            errors.root?.message ? (
              <p role="alert" className="text-destructive">
                {errors.root.message}
              </p>
            ) : null
          }
        />
        {/* Only these controls watch the changing money fields. */}
        <Watch
          control={form.control}
          name={["payments", "applyCredit"]}
          render={([payments, applyCredit]) => {
            const effectiveDue = outstanding - (parseMoneyInput(applyCredit) ?? ZERO);
            const remaining = effectiveDue - collectedPaise(payments);

            return (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pending || lines.fields.length >= MAX_PAYMENT_LINES}
                  onClick={() => {
                    const line = nextPaymentLine(payments, remaining);

                    lines.append(line, {
                      // Land in the amount: the method is already the one left unused.
                      focusName: `payments.${payments.length}.amount`,
                    });
                  }}
                >
                  Split payment
                </Button>
                <PaymentBalance
                  remaining={remaining}
                  currency={currency}
                  disabled={pending}
                  onFill={() => fillLastLine(effectiveDue)}
                />
              </div>
            );
          }}
        />
        <div className="flex justify-end gap-2">
          {actions}
          <SubmitButton isSubmitting={pending}>{submitLabel}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
