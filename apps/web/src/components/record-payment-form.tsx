import { fromPaise } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import {
  Form,
  FormControl,
  FormItem,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFieldArray, useFormState, Watch } from "react-hook-form";
import { toast } from "sonner";

import { useBillingInvalidation } from "@/components/opd-billing/use-billing-invalidation";
import { PaymentBalance, PaymentLine, PaymentLines } from "@/components/payment-lines";
import { useZodForm } from "@/hooks/use-zod-form";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { useOpdErrorToast } from "@/lib/opd-error";
import { orpc } from "@/lib/orpc";
import { hasErrorCode } from "@/lib/orpc-error";
import {
  collectedPaise,
  MAX_PAYMENT_LINES,
  methodLabel,
  needsReference,
  nextPaymentLine,
  paymentFormSchema,
  PAYMENT_METHODS,
} from "@/lib/settlement";

/**
 * Records money against an issued invoice. The billing worklist sheet and the
 * visit's invoice card both render this one form, so the split-line rules, the
 * ceiling on the total, and the CONFLICT recovery cannot drift apart.
 */
export function RecordPaymentForm({
  orgSlug,
  appointmentId,
  invoiceId,
  outstanding,
  currency,
  onClose,
  submitLabel,
  actions,
}: {
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  /** The server's figure; the form never recomputes it. */
  outstanding: string;
  currency: string;
  /** After a recorded payment, and on CONFLICT: the overlay holds a stale snapshot. */
  onClose: () => void;
  submitLabel: string;
  /** Rendered beside the submit button. */
  actions?: ReactNode;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const onOpdError = useOpdErrorToast(orgSlug);
  const owedPaise = parseMoneyInput(outstanding) ?? 0;
  const form = useZodForm(paymentFormSchema, {
    defaultValues: {
      payments: [{ id: 1, method: "cash", amount: outstanding, reference: "" }],
    },
  });
  // The ceiling is on the total, not on any one line, so it lives on the form root.
  const overCollected = useFormState({ control: form.control }).errors.root?.message;
  const lines = useFieldArray({ control: form.control, name: "payments", keyName: "fieldKey" });

  // Reads on demand, so the amounts stay uncontrolled and typing re-renders nothing.
  const fillLastLine = () => {
    const payments = form.getValues("payments");
    const index = payments.length - 1;
    const line = payments[index];
    if (!line) return;
    const remaining = owedPaise - collectedPaise(payments);
    form.setValue(
      `payments.${index}.amount`,
      fromPaise((parseMoneyInput(line.amount) ?? 0) + remaining),
    );
  };

  const record = useMutation(
    orpc.billing.recordPayments.mutationOptions({
      onSuccess: async (_data, variables) => {
        await invalidate(invoiceId);
        onClose();
        toast.success(
          variables.payments.length === 1 ? "Payment recorded" : "Split payment recorded",
        );
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) onClose();
        void onOpdError(appointmentId, "billing", error);
      },
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
          if (collectedPaise(values.payments) > owedPaise) {
            form.setError("root", {
              message: `More than the ${formatMoney(outstanding, currency)} outstanding`,
            });
            return;
          }
          record.mutate({
            orgSlug,
            invoiceId,
            payments: values.payments.map(({ id: _id, ...payment }) => ({
              ...payment,
              reference: payment.reference || undefined,
            })),
          });
        })}
      >
        <PaymentLines removable={lines.fields.length > 1}>
          {lines.fields.map((line, index) => (
            <PaymentLine
              key={line.fieldKey}
              disabled={pending}
              removeLabel={`Remove payment ${index + 1}`}
              onRemove={lines.fields.length > 1 ? () => lines.remove(index) : undefined}
              method={
                <RegisteredFormField
                  name={`payments.${index}.method`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          aria-label={`Payment ${index + 1} method`}
                          disabled={pending}
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
                          disabled={pending}
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
                  control={form.control}
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
                                disabled={pending}
                                placeholder={`${methodLabel(method)} reference`}
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
          ))}
        </PaymentLines>
        {overCollected ? (
          <p role="alert" className="text-destructive">
            {overCollected}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || lines.fields.length >= MAX_PAYMENT_LINES}
            onClick={() => {
              const payments = form.getValues("payments");
              lines.append(
                nextPaymentLine(payments, owedPaise - collectedPaise(payments)),
                // Land in the amount: the method is already the one left unused.
                { focusName: `payments.${payments.length}.amount` },
              );
            }}
          >
            Split payment
          </Button>
          {/* Only this readout watches every line, so typing an amount does not
              re-render the form around it. */}
          <Watch
            control={form.control}
            name="payments"
            render={(payments) => (
              <PaymentBalance
                remaining={owedPaise - collectedPaise(payments)}
                currency={currency}
                disabled={pending}
                onFill={fillLastLine}
              />
            )}
          />
        </div>
        <div className="flex justify-end gap-2">
          {actions}
          <SubmitButton isSubmitting={pending}>{submitLabel}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
