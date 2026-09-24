import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  FormControl,
  FormField,
  RegisteredFormField,
  FormItem,
  FormMessage,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { requirePaymentReference } from "@hms/api/lib/schemas";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useFormContext, useFormState, Watch } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { ErrorNote } from "@/components/page";
import { PaymentLineFields } from "@/components/payment-lines";
import { RecordPaymentForm } from "@/components/record-payment-form";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { openingCredit } from "@/lib/patient-credit";
import { paymentLineFields } from "@/lib/settlement";

const refundSchema = paymentLineFields
  .extend({ creditNoteId: z.string().min(1, "Choose a credit note") })
  .superRefine(requirePaymentReference);

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
  patientId: string | null;
  invoiceNumber: string;
  currency: string;
  grandTotal: bigint;
  paymentsTotal: bigint;
  allocationsTotal: bigint;
  outstanding: bigint;
};

// The payment form takes the credit as a snapshot, so opening it carries the figure.
type Action = { kind: "payment"; credit: bigint } | { kind: "credit" } | { kind: "refund" };

export function InvoiceAccount({
  orgSlug,
  invoice,
  canCredit,
  canPay,
}: {
  orgSlug: string;
  invoice: InvoiceHeader;
  canCredit: boolean;
  canPay: boolean;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const needsDetail = documentsOpen || action?.kind === "credit" || action?.kind === "refund";

  const detail = useQuery({
    ...orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
    enabled: needsDetail,
  });

  const openPayment = async () => {
    const credit = invoice.patientId
      ? await openingCredit(queryClient, orgSlug, invoice.patientId)
      : ZERO;

    if (credit === null) return;
    setAction({ kind: "payment", credit });
  };

  const isRefundDue = invoice.outstanding < ZERO;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to="/$orgSlug/billing/invoices/$invoiceId"
            params={{ orgSlug, invoiceId: invoice.id }}
            className="font-mono font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
          >
            {invoice.invoiceNumber}
          </Link>
          <p className="text-muted-foreground tabular-nums">
            Total {formatMoney(invoice.grandTotal, invoice.currency)} · Paid / credit{" "}
            {formatMoney(invoice.paymentsTotal + invoice.allocationsTotal, invoice.currency)}
          </p>
          <p
            className={
              isRefundDue ? "font-medium text-destructive tabular-nums" : "font-medium tabular-nums"
            }
          >
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
              onClick={() => void openPayment()}
            >
              Record payment
            </Button>
          ) : null}
          {canCredit ? (
            <>
              <Button size="xs" variant="outline" onClick={() => setAction({ kind: "credit" })}>
                Credit note
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!isRefundDue}
                onClick={() => setAction({ kind: "refund" })}
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
                Receipt <span className="font-mono">{payment.receiptNumber}</span>
              </Link>
            ))}
            {detail.data.creditNotes.map((note) => (
              <Link
                key={note.id}
                className="font-mono"
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
                className="font-mono"
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
        <div className="flex flex-col items-start gap-2">
          <ErrorNote title="Could not load invoice details" error={detail.error} />
          <Button size="xs" variant="ghost" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      <ClientOnly fallback={null}>
        {action?.kind === "payment" ? (
          <PaymentDialog
            onClose={() => setAction(null)}
            orgSlug={orgSlug}
            invoiceId={invoice.id}
            outstanding={invoice.outstanding}
            availableCredit={action.credit}
            currency={invoice.currency}
            onIssueCreditNote={canCredit ? () => setAction({ kind: "credit" }) : undefined}
          />
        ) : null}
        {action?.kind === "credit" && detail.data ? (
          <CreditDialog
            onClose={() => setAction(null)}
            orgSlug={orgSlug}
            invoiceId={invoice.id}
            lines={detail.data.lines}
            currency={invoice.currency}
          />
        ) : null}
        {action?.kind === "refund" && detail.data ? (
          <RefundDialog
            onClose={() => setAction(null)}
            orgSlug={orgSlug}
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
  invoiceId,
  outstanding,
  availableCredit,
  currency,
  onIssueCreditNote,
}: {
  onClose: () => void;
  orgSlug: string;
  invoiceId: string;
  outstanding: bigint;
  availableCredit: bigint;
  currency: string;
  onIssueCreditNote?: () => void;
}) {
  // Keep the dialog open while its payment is pending.
  const paying = useIsMutating({ mutationKey: orpc.billing.recordPayments.mutationKey() }) > 0;

  return (
    <Dialog open onOpenChange={(open) => (open || paying ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Split this payment across up to four methods.</DialogDescription>
        </DialogHeader>
        <RecordPaymentForm
          orgSlug={orgSlug}
          invoiceId={invoiceId}
          outstanding={outstanding}
          availableCredit={availableCredit}
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
  invoiceId,
  lines,
  currency,
}: {
  onClose: () => void;
  orgSlug: string;
  invoiceId: string;
  lines: Array<{ id: string; description: string; gross: bigint }>;
  currency: string;
}) {
  return (
    <FormDialog
      title="Issue credit note"
      description="Select full lines or enter a partial gross amount."
      submitLabel="Issue credit note"
      schema={creditSchema}
      defaultValues={{
        reason: "",
        lines: lines.map((line) => ({ invoiceLineId: line.id, full: false, gross: "" })),
      }}
      success="Credit note issued"
      onClose={onClose}
      contentClassName="max-w-2xl"
      run={(value) =>
        orpc.billing.issueCreditNote.call({
          orgSlug,
          invoiceId,
          reason: value.reason,
          lines: value.lines.flatMap((line): CreditLineInput[] => {
            if (line.full) return [{ invoiceLineId: line.invoiceLineId, full: true as const }];
            const gross = parseMoneyInput(line.gross ?? "");

            return gross === null ? [] : [{ invoiceLineId: line.invoiceLineId, gross }];
          }),
        })
      }
    >
      <TextField name="reason" label="Reason" multiline />
      <CreditLines lines={lines} currency={currency} />
    </FormDialog>
  );
}

function CreditLines({
  lines,
  currency,
}: {
  lines: Array<{ id: string; description: string; gross: bigint }>;
  currency: string;
}) {
  const { control } = useFormContext<z.input<typeof creditSchema>>();
  const linesError = useFormState({ control, name: "lines" }).errors.lines?.root?.message;

  return (
    <>
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
                <TableCell className="text-right">{formatMoney(line.gross, currency)}</TableCell>
                <TableCell>
                  <FormField
                    control={control}
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
                    control={control}
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
      {linesError ? <p className="text-xs text-destructive">{linesError}</p> : null}
    </>
  );
}

function RefundDialog({
  onClose,
  orgSlug,
  creditNotes,
  currency,
}: {
  onClose: () => void;
  orgSlug: string;
  creditNotes: Array<{ id: string; creditNoteNumber: string; total: bigint }>;
  currency: string;
}) {
  return (
    <FormDialog
      title="Record refund"
      description="Refund an available credit-note balance."
      submitLabel="Record refund"
      schema={refundSchema}
      defaultValues={{ creditNoteId: "", method: "cash", amount: "", reference: "" }}
      success="Refund recorded"
      onClose={onClose}
      run={(value) =>
        orpc.billing.recordRefund.call({
          orgSlug,
          creditNoteId: value.creditNoteId,
          method: value.method,
          amount: value.amount,
          reference: value.reference || undefined,
        })
      }
    >
      <ControlledField
        name="creditNoteId"
        label="Credit note"
        render={(field) => (
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
        )}
      />
      <PaymentLineFields />
    </FormDialog>
  );
}
