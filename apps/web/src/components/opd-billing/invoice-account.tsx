import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
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
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { useFormContext, useFormState, Watch } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { OptionCombobox } from "@/components/option-combobox";
import { ErrorNote } from "@/components/page";
import { PaymentLineFields } from "@/components/payment-lines";
import { RecordPaymentForm } from "@/components/record-payment-form";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { openingCredit, type PatientCredit } from "@/lib/patient-credit";
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
  receipts: Array<{ id: string; number: string }>;
  creditNotes: Array<{ id: string; number: string }>;
  refunds: Array<{ id: string; number: string }>;
};

// Plain enough to read as a link on the card: underlined, in the body colour.
const DOCUMENT_LINK = "underline underline-offset-4";

// The payment form takes the credit as a snapshot, so opening it carries the figure.
type Action = { kind: "payment"; credit: PatientCredit } | { kind: "credit" } | { kind: "refund" };

export function InvoiceAccount({
  orgSlug,
  invoice,
  treatmentPlanId,
  canCredit,
  canPay,
}: {
  orgSlug: string;
  invoice: InvoiceHeader;
  /** The visit's plan: payment defaults to its advance plus untagged credit. */
  treatmentPlanId: string | null;
  canCredit: boolean;
  canPay: boolean;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const needsDetail = action?.kind === "credit" || action?.kind === "refund";

  const detail = useQuery({
    ...orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
    enabled: needsDetail,
  });

  const openPayment = async () => {
    const credit = invoice.patientId
      ? await openingCredit(queryClient, orgSlug, invoice.patientId, treatmentPlanId)
      : { usable: ZERO, total: ZERO };

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
            Total {formatMoney(invoice.grandTotal, invoice.currency)}
            {invoice.outstanding === ZERO
              ? " · Paid"
              : ` · Paid ${formatMoney(invoice.paymentsTotal + invoice.allocationsTotal, invoice.currency)}`}
          </p>
          {invoice.outstanding === ZERO ? null : (
            <p
              className={
                isRefundDue
                  ? "font-medium text-destructive tabular-nums"
                  : "font-medium tabular-nums"
              }
            >
              {isRefundDue
                ? `Refund due ${formatMoney(-invoice.outstanding, invoice.currency)}`
                : `Outstanding ${formatMoney(invoice.outstanding, invoice.currency)}`}
            </p>
          )}
        </div>
        {/* Only the action the invoice's state allows is shown; a credit note is rare, so it waits in the menu. */}
        <div className="flex items-center gap-1">
          {canPay && invoice.outstanding > ZERO ? (
            <Button size="xs" variant="outline" onClick={() => void openPayment()}>
              Record payment
            </Button>
          ) : null}
          {canCredit && isRefundDue ? (
            <Button size="xs" variant="outline" onClick={() => setAction({ kind: "refund" })}>
              Record refund
            </Button>
          ) : null}
          {canCredit ? (
            <ClientOnly fallback={<span className="inline-block size-6" />}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-xs" />}
                  aria-label={`More actions for ${invoice.invoiceNumber}`}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-36">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setAction({ kind: "credit" })}>
                      Issue credit note
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ClientOnly>
          ) : null}
        </div>
      </div>
      {invoice.receipts.length + invoice.creditNotes.length + invoice.refunds.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {invoice.receipts.map((receipt) => (
            <Link
              key={receipt.id}
              to="/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId"
              params={{ orgSlug, invoiceId: invoice.id, paymentId: receipt.id }}
              className={DOCUMENT_LINK}
            >
              Receipt <span className="font-mono">{receipt.number}</span>
            </Link>
          ))}
          {invoice.creditNotes.map((note) => (
            <Link
              key={note.id}
              to="/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId"
              params={{ orgSlug, invoiceId: invoice.id, creditNoteId: note.id }}
              className={DOCUMENT_LINK}
            >
              Credit note <span className="font-mono">{note.number}</span>
            </Link>
          ))}
          {invoice.refunds.map((refund) => (
            <Link
              key={refund.id}
              to="/$orgSlug/billing/invoices/$invoiceId/refund/$refundId"
              params={{ orgSlug, invoiceId: invoice.id, refundId: refund.id }}
              className={DOCUMENT_LINK}
            >
              Refund <span className="font-mono">{refund.number}</span>
            </Link>
          ))}
        </div>
      ) : null}
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
  availableCredit: PatientCredit;
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
            <OptionCombobox
              {...field}
              options={creditNotes.map((note) => ({
                value: note.id,
                label: `${note.creditNoteNumber} · ${formatMoney(note.total, currency)}`,
              }))}
              placeholder="Choose a credit note"
            />
          </FormControl>
        )}
      />
      <PaymentLineFields />
    </FormDialog>
  );
}
