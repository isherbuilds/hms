import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { formatMoney, MONEY_INPUT_PATTERN } from "@/lib/money";
import { orpc } from "@/lib/orpc";

import { useBillingInvalidation } from "./use-billing-invalidation";

const paymentSchema = z.object({
  method: z.enum(["cash", "upi", "card"]),
  amount: z
    .string()
    .regex(MONEY_INPUT_PATTERN, "Amount like 150.00")
    .refine((value) => Number(value) > 0, "Enter an amount above zero"),
  reference: z.string().trim().max(100).optional(),
});

const refundSchema = paymentSchema.extend({
  creditNoteId: z.string().min(1, "Choose a credit note"),
});

const creditSchema = z
  .object({
    reason: z.string().trim().min(1, "Enter a reason").max(500),
    lines: z.array(
      z.object({ invoiceLineId: z.string(), full: z.boolean(), gross: z.string().optional() }),
    ),
  })
  .superRefine((value, context) => {
    if (
      !value.lines.some(
        (line) =>
          line.full ||
          (line.gross && MONEY_INPUT_PATTERN.test(line.gross) && Number(line.gross) > 0),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Credit at least one full line or partial amount",
      });
    }
    value.lines.forEach((line, index) => {
      if (
        !line.full &&
        line.gross &&
        (!MONEY_INPUT_PATTERN.test(line.gross) || Number(line.gross) <= 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "gross"],
          message: "Enter an amount above zero",
        });
      }
    });
  });

type InvoiceHeader = {
  id: string;
  invoiceNumber: string;
  currency: string;
  grandTotal: string;
  creditTotal: string;
  paymentsTotal: string;
  refundsTotal: string;
  outstanding: string;
};

export function InvoiceAccount({
  orgSlug,
  appointmentId,
  invoice,
  canCredit,
}: {
  orgSlug: string;
  appointmentId: string;
  invoice: InvoiceHeader;
  canCredit: boolean;
}) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const detail = useQuery(
    orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
  );
  const outstanding = Number(invoice.outstanding);
  const isRefundDue = outstanding < 0;

  return (
    <div className="flex flex-col gap-2 border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to="/$orgSlug/billing/invoices/$invoiceId"
            params={{ orgSlug, invoiceId: invoice.id }}
            className="font-semibold underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
          >
            {invoice.invoiceNumber}
          </Link>
          <p className="text-muted-foreground">
            Total {formatMoney(invoice.grandTotal, invoice.currency)} · Paid{" "}
            {formatMoney(invoice.paymentsTotal, invoice.currency)}
          </p>
          <p className={isRefundDue ? "font-medium text-destructive" : "font-medium"}>
            {isRefundDue
              ? `Refund due ${formatMoney(Math.abs(outstanding), invoice.currency)}`
              : `Outstanding ${formatMoney(invoice.outstanding, invoice.currency)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={outstanding <= 0}
            onClick={() => setPaymentOpen(true)}
          >
            Record payment
          </Button>
          {canCredit ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={!detail.data}
                onClick={() => setCreditOpen(true)}
              >
                Credit note
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!detail.data?.creditNotes.length || !isRefundDue}
                onClick={() => setRefundOpen(true)}
              >
                Record refund
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <Link
          to="/$orgSlug/billing/invoices/$invoiceId"
          params={{ orgSlug, invoiceId: invoice.id }}
          search={{ layout: undefined }}
        >
          Invoice print
        </Link>
        {detail.data ? (
          <>
            {detail.data.payments.map((payment) => (
              <Link
                key={payment.id}
                to="/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId"
                params={{ orgSlug, invoiceId: invoice.id, paymentId: payment.id }}
              >
                Receipt {payment.receiptNumber}
              </Link>
            ))}
            {detail.data.creditNotes.map((note) => (
              <Link
                key={note.id}
                to="/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId"
                params={{ orgSlug, invoiceId: invoice.id, creditNoteId: note.id }}
              >
                {note.creditNoteNumber}
              </Link>
            ))}
            {detail.data.refunds.map((refund) => (
              <Link
                key={refund.id}
                to="/$orgSlug/billing/invoices/$invoiceId/refund/$refundId"
                params={{ orgSlug, invoiceId: invoice.id, refundId: refund.id }}
              >
                {refund.refundNumber}
              </Link>
            ))}
          </>
        ) : null}
      </div>
      {detail.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading invoice activity…
        </p>
      ) : detail.isError ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not load invoice activity</p>
          <p className="text-muted-foreground">{detail.error.message}</p>
          <Button size="xs" variant="ghost" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      <ClientOnly fallback={null}>
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          orgSlug={orgSlug}
          appointmentId={appointmentId}
          invoiceId={invoice.id}
        />
        {detail.data ? (
          <CreditDialog
            open={creditOpen}
            onOpenChange={setCreditOpen}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            invoiceId={invoice.id}
            lines={detail.data.lines}
            currency={invoice.currency}
          />
        ) : null}
        {detail.data ? (
          <RefundDialog
            open={refundOpen}
            onOpenChange={setRefundOpen}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            invoiceId={invoice.id}
            creditNotes={detail.data.creditNotes}
            currency={invoice.currency}
          />
        ) : null}
      </ClientOnly>
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  orgSlug,
  appointmentId,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const form = useZodForm(paymentSchema, {
    defaultValues: { method: "cash", amount: "", reference: "" },
  });
  const mutation = useMutation(
    orpc.billing.recordPayment.mutationOptions({
      onSuccess: async () => {
        await invalidate(invoiceId);
        toast.success("Payment recorded");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Record funds received against this invoice.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((value) =>
              mutation.mutate({
                orgSlug,
                invoiceId,
                method: value.method,
                amount: value.amount,
                reference: value.reference || undefined,
              }),
            )}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending}>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Record payment</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({
  open,
  onOpenChange,
  orgSlug,
  appointmentId,
  invoiceId,
  lines,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  lines: Array<{ id: string; description: string; gross: string }>;
  currency: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const form = useZodForm(creditSchema, {
    defaultValues: {
      reason: "",
      lines: lines.map((line) => ({ invoiceLineId: line.id, full: false, gross: "" })),
    },
  });
  const mutation = useMutation(
    orpc.billing.issueCreditNote.mutationOptions({
      onSuccess: async () => {
        await invalidate(invoiceId);
        toast.success("Credit note issued");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit((value) =>
    mutation.mutate({
      orgSlug,
      invoiceId,
      reason: value.reason,
      lines: value.lines
        .filter((line) => line.full || line.gross)
        .map((line) =>
          line.full
            ? { invoiceLineId: line.invoiceLineId, full: true as const }
            : { invoiceLineId: line.invoiceLineId, gross: line.gross! },
        ),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue credit note</DialogTitle>
          <DialogDescription>Select full lines or enter a partial gross amount.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="overflow-x-auto ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Full</TableHead>
                    <TableHead>Partial gross</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{formatMoney(line.gross, currency)}</TableCell>
                      <TableCell>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.full`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Checkbox
                                  aria-label={`Credit full amount for ${line.description}`}
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.gross`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  aria-label={`Partial gross credit for ${line.description}`}
                                  inputMode="decimal"
                                  disabled={form.watch(`lines.${index}.full`)}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-destructive">{form.formState.errors.lines?.root?.message}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Issue credit note</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  orgSlug,
  appointmentId,
  invoiceId,
  creditNotes,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  creditNotes: Array<{ id: string; creditNoteNumber: string; total: string }>;
  currency: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const form = useZodForm(refundSchema, {
    defaultValues: { creditNoteId: "", method: "cash", amount: "", reference: "" },
  });
  const mutation = useMutation(
    orpc.billing.recordRefund.mutationOptions({
      onSuccess: async () => {
        await invalidate(invoiceId);
        toast.success("Refund recorded");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record refund</DialogTitle>
          <DialogDescription>Return an available credit-note amount.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((value) =>
              mutation.mutate({
                orgSlug,
                creditNoteId: value.creditNoteId,
                method: value.method,
                amount: value.amount,
                reference: value.reference || undefined,
              }),
            )}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="creditNoteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit note</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">Choose a credit note</option>
                      {creditNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.creditNoteNumber} · {formatMoney(note.total, currency)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending}>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Record refund</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
