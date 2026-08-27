import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { Separator } from "@hms/ui/components/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { ToggleGroup, ToggleGroupItem } from "@hms/ui/components/toggle-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PhoneIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { WorklistRow } from "@/lib/billing-worklist-row";
import { invalidateBillingState } from "@/lib/domain-invalidation";
import { MONEY_INPUT_PATTERN, formatMoney, parseMoneyInput } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { PAYMENT_METHODS, type PaymentMethod, needsReference } from "@/lib/settlement";

/**
 * The desk's settle panel: what is owed on one row, and the one control that
 * closes it. It sits over the worklist rather than navigating, so a cashier
 * keeps their place in the list across twenty settlements.
 *
 * Anything the panel cannot finish — issuing the invoice, crediting, refunding —
 * links to the visit's billing page rather than growing a second copy of it here.
 */
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
        {row ? <Body orgSlug={orgSlug} row={row} currency={currency} onClose={onClose} /> : null}
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
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(() => Number(row.owed).toFixed(2));
  const [reference, setReference] = useState("");

  const owedPaise = parseMoneyInput(row.owed) ?? 0;
  const amountPaise = MONEY_INPUT_PATTERN.test(amount) ? parseMoneyInput(amount) : null;
  const problem =
    amountPaise === null
      ? "Enter an amount like 450 or 450.50"
      : amountPaise === 0
        ? "Enter an amount above zero"
        : amountPaise > owedPaise
          ? `More than the ${formatMoney(row.owed, currency)} outstanding`
          : needsReference(method) && !reference.trim()
            ? "A UPI or card payment needs a reference"
            : null;

  const record = useMutation(
    orpc.billing.recordPayments.mutationOptions({
      onSuccess: async () => {
        await invalidateBillingState(
          queryClient,
          orgSlug,
          row.appointmentId,
          row.invoiceId ?? undefined,
        );
        toast.success("Payment recorded");
        onClose();
      },
      onError: (error) => toast.error(error.message),
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

        {row.invoiceId ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (problem || !row.invoiceId) return;
              record.mutate({
                orgSlug,
                invoiceId: row.invoiceId,
                payments: [{ method, amount, reference: reference.trim() || undefined }],
              });
            }}
          >
            <span className="text-muted-foreground">Take payment</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg bg-muted p-0.5">
                <ToggleGroup
                  aria-label="Payment method"
                  value={[method]}
                  size="sm"
                  spacing={1}
                  onValueChange={(value) =>
                    setMethod((value[0] as PaymentMethod | undefined) ?? method)
                  }
                >
                  {PAYMENT_METHODS.map((option) => (
                    <ToggleGroupItem key={option.value} value={option.value}>
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Amount received"
                inputMode="decimal"
                className="w-28 text-right font-mono tabular-nums"
              />
            </div>
            {needsReference(method) ? (
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                aria-label="Reference"
                placeholder="UPI or card reference"
              />
            ) : null}
            <div className="flex items-center gap-2">
              {problem ? <span className="text-destructive">{problem}</span> : null}
              <Button
                type="submit"
                size="sm"
                className="ml-auto"
                disabled={Boolean(problem) || record.isPending}
              >
                Collect {amountPaise ? formatMoney(amount, currency) : ""}
              </Button>
            </div>
          </form>
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
