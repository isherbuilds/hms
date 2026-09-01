import { Badge } from "@hms/ui/components/badge";
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
import { Separator } from "@hms/ui/components/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PhoneIcon } from "lucide-react";
import { Watch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import type { WorklistRow } from "@/lib/billing-worklist-row";
import { invalidateBillingState } from "@/lib/domain-invalidation";
import { MONEY_INPUT_PATTERN, formatMoney, parseMoneyInput } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { PAYMENT_METHODS, needsReference } from "@/lib/settlement";

// The ceiling is per-row, so the schema is built per panel rather than at module scope.
function paymentSchema(owedPaise: number, owedLabel: string) {
  return z
    .object({
      method: z.enum(PAYMENT_METHODS.map((option) => option.value)),
      amount: z
        .string()
        .regex(MONEY_INPUT_PATTERN, "Enter an amount like 450 or 450.50")
        .refine((value) => Number(value) > 0, "Enter an amount above zero")
        .refine(
          (value) => (parseMoneyInput(value) ?? 0) <= owedPaise,
          `More than the ${owedLabel} outstanding`,
        ),
      reference: z.string().trim().max(100),
    })
    .superRefine((value, context) => {
      if (needsReference(value.method) && !value.reference) {
        context.addIssue({
          code: "custom",
          path: ["reference"],
          message: "A non-cash payment needs a reference",
        });
      }
    });
}

export function BillingWorklistSheet({
  orgSlug,
  row,
  currency,
  onClose,
}: {
  orgSlug: string;
  row: WorklistRow | null;
  currency: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent>
        {row ? (
          // Keyed by the row, not by what it owes: a background refetch must not remount the
          // panel and wipe a half-typed amount.
          <Body key={row.key} orgSlug={orgSlug} row={row} currency={currency} onClose={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  orgSlug,
  row,
  currency,
  onClose,
}: {
  orgSlug: string;
  row: WorklistRow;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const invoiceId = row.invoiceId;
  const owedPaise = parseMoneyInput(row.owed) ?? 0;
  const form = useZodForm(paymentSchema(owedPaise, formatMoney(row.owed, currency)), {
    defaultValues: { method: "cash", amount: Number(row.owed).toFixed(2), reference: "" },
  });

  const record = useMutation(
    orpc.billing.recordPayments.mutationOptions({
      onSuccess: () => {
        onClose();
        toast.success("Payment recorded");
        void invalidateBillingState(
          queryClient,
          orgSlug,
          row.appointmentId,
          row.invoiceId ?? undefined,
        );
      },
      onError: (error) => toast.error(errorMessage(error, "Could not record the payment")),
    }),
  );

  return (
    <>
      <SheetHeader>
        <SheetTitle>{row.patientName}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-muted-foreground">
            {row.reference} · {row.patientMrn}
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`text-sm font-medium tabular-nums ${
                row.state === "stale"
                  ? "text-destructive"
                  : row.state === "late"
                    ? "text-overdue"
                    : ""
              }`}
            >
              {formatMoney(row.owed, currency)}
            </span>
            <span className="text-muted-foreground">
              {row.invoiceId ? "outstanding" : "not yet invoiced"}
            </span>
          </span>
          <span className="text-muted-foreground">{row.detail}</span>
        </div>

        <Separator />

        {invoiceId ? (
          <Form {...form}>
            {/* `noValidate`: Zod owns every message here. */}
            <form
              noValidate
              className="flex flex-col gap-2"
              onSubmit={form.handleSubmit((values) =>
                record.mutate({
                  orgSlug,
                  invoiceId,
                  payments: [{ ...values, reference: values.reference || undefined }],
                }),
              )}
            >
              <span className="text-muted-foreground">Take payment</span>
              <div className="flex flex-wrap items-start gap-2">
                <RegisteredFormField
                  name="method"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NativeSelect {...field} aria-label="Payment method" className="w-36">
                          {PAYMENT_METHODS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          aria-label="Amount received"
                          inputMode="decimal"
                          className="w-28 text-right font-mono tabular-nums"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {/* Only this line watches the method, so choosing one does not
                  re-render the panel around it. */}
              <Watch
                control={form.control}
                name="method"
                exact
                render={(method) =>
                  needsReference(method) ? (
                    <RegisteredFormField
                      name="reference"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              aria-label="Reference"
                              placeholder="Transaction reference"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null
                }
              />
              <Button type="submit" size="sm" className="ml-auto" disabled={record.isPending}>
                Collect
              </Button>
            </form>
          </Form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              Nothing is owed until the invoice is issued.
            </span>
            <Button
              size="sm"
              className="ml-auto"
              nativeButton={false}
              render={
                <Link
                  to="/$orgSlug/opd/$appointmentId/billing"
                  params={{ orgSlug, appointmentId: row.appointmentId }}
                />
              }
            >
              Issue invoice
            </Button>
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          {row.patientPhone ? (
            <Badge variant="muted" className="gap-1 font-mono">
              <PhoneIcon />
              {row.patientPhone}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            nativeButton={false}
            render={
              <Link
                to="/$orgSlug/opd/$appointmentId/billing"
                params={{ orgSlug, appointmentId: row.appointmentId }}
              />
            }
          >
            <ExternalLinkIcon />
            Open visit billing
          </Button>
        </div>
      </div>
    </>
  );
}
