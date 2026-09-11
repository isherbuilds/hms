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
  RegisteredFormField,
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
import { useFormState, Watch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { RecordPaymentForm } from "@/components/record-payment-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { useOpdErrorToast } from "@/lib/opd-error";
import { errorMessage, hasErrorCode } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";
import {
  methodLabel,
  paymentLineFields,
  PAYMENT_METHODS,
  requireTransactionReference,
} from "@/lib/settlement";

import { useBillingInvalidation } from "./use-billing-invalidation";

const refundSchema = paymentLineFields
  .omit({ id: true })
  .extend({ creditNoteId: z.string().min(1, "Choose a credit note") })
  .superRefine(requireTransactionReference);

type CreditLineInput =
  | { invoiceLineId: string; full: true }
  | { invoiceLineId: string; gross: bigint };

const creditSchema = z
  .object({
    reason: z.string().trim().min(1, "Enter a reason").max(500),
    lines: z.array(
      z.object({ invoiceLineId: z.string(), full: z.boolean(), gross: z.string().optional() }),
    ),
  })
  .superRefine((value, context) => {
    if (
      !value.lines.some((line) => line.full || (parseMoneyInput(line.gross ?? "") ?? ZERO) > ZERO)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Credit at least one full line or partial amount",
      });
    }

    value.lines.forEach((line, index) => {
      if (!line.full && line.gross && (parseMoneyInput(line.gross) ?? ZERO) <= ZERO) {
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
  grandTotal: bigint;
  paymentsTotal: bigint;
  outstanding: bigint;
};

export function InvoiceAccount({
  orgSlug,
  appointmentId,
  invoice,
  canCredit,
  canPay,
}: {
  orgSlug: string;
  appointmentId: string;
  invoice: InvoiceHeader;
  canCredit: boolean;
  canPay: boolean;
}) {
  const [action, setAction] = useState<"payment" | "credit" | "refund" | null>(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const needsDetail = documentsOpen || action === "credit" || action === "refund";

  const detail = useQuery({
    ...orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
    enabled: needsDetail,
  });

  const isRefundDue = invoice.outstanding < ZERO;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to="/$orgSlug/billing/invoices/$invoiceId"
            params={{ orgSlug, invoiceId: invoice.id }}
            className="font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
          >
            {invoice.invoiceNumber}
          </Link>
          <p className="text-muted-foreground">
            Total {formatMoney(invoice.grandTotal, invoice.currency)} · Paid{" "}
            {formatMoney(invoice.paymentsTotal, invoice.currency)}
          </p>
          <p className={isRefundDue ? "font-medium text-destructive" : "font-medium"}>
            {isRefundDue
              ? `Refund due ${formatMoney(-invoice.outstanding, invoice.currency)}`
              : `Outstanding ${formatMoney(invoice.outstanding, invoice.currency)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {canPay ? (
            <Button
              size="xs"
              variant="outline"
              disabled={invoice.outstanding <= ZERO}
              onClick={() => setAction("payment")}
            >
              Record payment
            </Button>
          ) : null}
          {canCredit ? (
            <>
              <Button size="xs" variant="outline" onClick={() => setAction("credit")}>
                Credit note
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!isRefundDue}
                onClick={() => setAction("refund")}
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
        <Button
          size="xs"
          variant="ghost"
          className="h-auto px-0 text-muted-foreground"
          onClick={() => setDocumentsOpen((open) => !open)}
        >
          {documentsOpen ? "Hide documents" : "Documents"}
        </Button>
        {documentsOpen && detail.data ? (
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
      {needsDetail && detail.isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading invoice details…
        </p>
      ) : needsDetail && detail.isError ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not load invoice details</p>
          <p className="text-muted-foreground">{errorMessage(detail.error)}</p>
          <Button size="xs" variant="ghost" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      <ClientOnly fallback={null}>
        {action === "payment" ? (
          <PaymentDialog
            onClose={() => setAction(null)}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            invoiceId={invoice.id}
            outstanding={invoice.outstanding}
            currency={invoice.currency}
            onIssueCreditNote={canCredit ? () => setAction("credit") : undefined}
          />
        ) : null}
        {action === "credit" && detail.data ? (
          <CreditDialog
            onClose={() => setAction(null)}
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            invoiceId={invoice.id}
            lines={detail.data.lines}
            currency={invoice.currency}
          />
        ) : null}
        {action === "refund" && detail.data ? (
          <RefundDialog
            onClose={() => setAction(null)}
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
  onClose,
  orgSlug,
  appointmentId,
  invoiceId,
  outstanding,
  currency,
  onIssueCreditNote,
}: {
  onClose: () => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  outstanding: bigint;
  currency: string;
  onIssueCreditNote?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Record funds received against this invoice. Split across up to four methods.
          </DialogDescription>
        </DialogHeader>
        <RecordPaymentForm
          orgSlug={orgSlug}
          appointmentId={appointmentId}
          invoiceId={invoiceId}
          outstanding={outstanding}
          currency={currency}
          onClose={onClose}
          submitLabel="Record payment"
          actions={
            onIssueCreditNote ? (
              <Button type="button" variant="outline" onClick={onIssueCreditNote}>
                Issue credit note
              </Button>
            ) : null
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({
  onClose,
  orgSlug,
  appointmentId,
  invoiceId,
  lines,
  currency,
}: {
  onClose: () => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  lines: Array<{ id: string; description: string; gross: bigint }>;
  currency: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const onOpdError = useOpdErrorToast(orgSlug);

  const form = useZodForm(creditSchema, {
    defaultValues: {
      reason: "",
      lines: lines.map((line) => ({ invoiceLineId: line.id, full: false, gross: "" })),
    },
  });

  const creditLinesError = useFormState({
    control: form.control,
    name: "lines",
  }).errors.lines?.root?.message;

  const mutation = useMutation(
    orpc.billing.issueCreditNote.mutationOptions({
      onSuccess: async () => {
        await invalidate(invoiceId);
        onClose();
        toast.success("Credit note issued");
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) onClose();
        void onOpdError(appointmentId, "billing", error);
      },
    }),
  );

  const submit = form.handleSubmit((value) =>
    mutation.mutate({
      orgSlug,
      invoiceId,
      reason: value.reason,
      lines: value.lines.flatMap((line): CreditLineInput[] => {
        if (line.full) return [{ invoiceLineId: line.invoiceLineId, full: true as const }];
        const gross = parseMoneyInput(line.gross ?? "");

        return gross === null || gross === ZERO
          ? []
          : [{ invoiceLineId: line.invoiceLineId, gross }];
      }),
    }),
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue credit note</DialogTitle>
          <DialogDescription>Select full lines or enter a partial gross amount.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <RegisteredFormField
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
                        <Watch
                          control={form.control}
                          name={`lines.${index}.full`}
                          exact
                          render={(full) => (
                            <RegisteredFormField
                              name={`lines.${index}.gross`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      aria-label={`Partial gross credit for ${line.description}`}
                                      inputMode="decimal"
                                      disabled={full}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {creditLinesError ? (
              <p className="text-xs text-destructive">{creditLinesError}</p>
            ) : null}
            <DialogFooter>
              <SubmitButton isSubmitting={mutation.isPending}>Issue credit note</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  onClose,
  orgSlug,
  appointmentId,
  invoiceId,
  creditNotes,
  currency,
}: {
  onClose: () => void;
  orgSlug: string;
  appointmentId: string;
  invoiceId: string;
  creditNotes: Array<{ id: string; creditNoteNumber: string; total: bigint }>;
  currency: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const onOpdError = useOpdErrorToast(orgSlug);

  const form = useZodForm(refundSchema, {
    defaultValues: { creditNoteId: "", method: "cash", amount: "", reference: "" },
  });

  const mutation = useMutation(
    orpc.billing.recordRefund.mutationOptions({
      onSuccess: async () => {
        await invalidate(invoiceId);
        onClose();
        toast.success("Refund recorded");
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) onClose();
        void onOpdError(appointmentId, "billing", error);
      },
    }),
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
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
            <RegisteredFormField
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
            <RegisteredFormField
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending}>
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {methodLabel(method)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RegisteredFormField
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
            <RegisteredFormField
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
              <SubmitButton isSubmitting={mutation.isPending}>Record refund</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
