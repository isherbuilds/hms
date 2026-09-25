import { DECIMAL_PATTERN } from "@hms/api/core/money";
import { requirePaymentReference } from "@hms/api/lib/schemas";
import { Button } from "@hms/ui/components/button";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Separator } from "@hms/ui/components/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useState } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { ErrorNote } from "@/components/page";
import { numberText } from "@/lib/form-schema";
import { billingPdfUrl } from "@/lib/billing-document";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney, parseMoneyInput, ZERO } from "@/lib/money";
import { formatBusinessDate, formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { methodLabel, PAYMENT_METHODS } from "@/lib/settlement";

// Kept local so no @hms/db server module reaches the client bundle (hard rule 6).
const RETURN_REASON_CODES = [
  "damaged",
  "wrong_item",
  "unwanted",
  "expired_on_shelf",
  "correction",
] as const;

const REASON_LABELS: Record<(typeof RETURN_REASON_CODES)[number], string> = {
  damaged: "Damaged",
  wrong_item: "Wrong item",
  unwanted: "Unwanted",
  expired_on_shelf: "Expired on shelf",
  correction: "Correction",
};

export function PharmacySaleSheet({
  orgSlug,
  saleId,
  onClose,
}: {
  orgSlug: string;
  saleId: string | null;
  onClose: () => void;
}) {
  return (
    <ClientOnly fallback={null}>
      <Sheet open={saleId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
        <SheetContent>
          {saleId ? <SaleBody key={saleId} orgSlug={orgSlug} saleId={saleId} /> : null}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}

function SaleBody({ orgSlug, saleId }: { orgSlug: string; saleId: string }) {
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const { timeZone } = useOrgDateTime();
  const canReturn = useCan(orgSlug, { pharmacy: ["return"] });
  const [returning, setReturning] = useState(false);

  const sale = useQuery(orpc.pharmacy.getSale.queryOptions({ input: { orgSlug, saleId } }));
  const data = sale.data;

  if (sale.isPending) {
    return (
      <SheetHeader>
        <SheetTitle>Sale</SheetTitle>
      </SheetHeader>
    );
  }

  if (!data) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Sale</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          <ErrorNote title="Could not load this sale" error={sale.error} />
        </div>
      </>
    );
  }

  const returnedByLine = new Map<string, number>();

  for (const saleReturn of data.returns) {
    for (const line of saleReturn.lines) {
      returnedByLine.set(
        line.invoiceLineId,
        (returnedByLine.get(line.invoiceLineId) ?? 0) + line.qty,
      );
    }
  }

  const returnable = data.lines.flatMap((line) => {
    const remaining = line.qty - (returnedByLine.get(line.id) ?? 0);

    return remaining > 0
      ? [{ invoiceLineId: line.id, description: line.description, remaining }]
      : [];
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="capitalize">{data.sale.buyerName}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-4 overflow-y-auto p-4 text-xs">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            <span className="font-mono">{data.invoice.invoiceNumber}</span> ·{" "}
            {formatBusinessDate(data.invoice.businessDate)}
          </span>
          {data.sale.buyerPhone ? (
            <span className="font-mono text-muted-foreground">{data.sale.buyerPhone}</span>
          ) : null}
          {data.sale.forName ? <span>For {data.sale.forName}</span> : null}
          {data.sale.prescriberName ? (
            <span className="text-muted-foreground">
              Prescriber {data.sale.prescriberName}
              {data.sale.prescriptionReference ? ` · ${data.sale.prescriptionReference}` : ""}
            </span>
          ) : null}
          <span className="text-xs font-medium tabular-nums">
            {formatMoney(data.invoice.grandTotal, currency)}
          </span>
          {data.invoice.roundOff !== ZERO ? (
            <span className="text-muted-foreground tabular-nums">
              Round off {formatMoney(data.invoice.roundOff, currency)}
            </span>
          ) : null}
          {data.refundDue > ZERO ? (
            <span className="font-medium text-destructive tabular-nums">
              Refund due {formatMoney(data.refundDue, currency)}
            </span>
          ) : null}
        </div>

        <Separator />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Gross</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.description}</TableCell>
                <TableCell className="font-mono">{line.batchNumber}</TableCell>
                <TableCell>{formatBusinessDate(line.expiryDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.gross, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {data.payments.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Payments</h3>
            {data.payments.map((payment) => (
              <span key={payment.id} className="flex items-center gap-2">
                <span className="font-mono">{payment.receiptNumber}</span>
                <span className="text-muted-foreground">{methodLabel(payment.method)}</span>
                <span className="ml-auto tabular-nums">
                  {formatMoney(payment.amount, currency)}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {data.returns.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-muted-foreground">Returns</h3>
            {data.returns.map((saleReturn) => (
              <div key={saleReturn.id} className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span>{REASON_LABELS[saleReturn.reasonCode]}</span>
                  <span className="text-muted-foreground">
                    {formatDate(saleReturn.createdAt, timeZone)}
                  </span>
                </span>
                {saleReturn.note ? (
                  <span className="text-muted-foreground">{saleReturn.note}</span>
                ) : null}
                {saleReturn.lines.map((line) => (
                  <span key={line.id} className="flex items-center gap-2 pl-3">
                    <span className="tabular-nums">{line.qty}</span>
                    <span className="text-muted-foreground">returned</span>
                    <span className="ml-auto tabular-nums">
                      {formatMoney(line.gross, currency)}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {data.refunds.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Refunds</h3>
            {data.refunds.map((refund) => (
              <span key={refund.id} className="flex items-center gap-2">
                <span className="font-mono">{refund.refundNumber}</span>
                <span className="text-muted-foreground">{methodLabel(refund.method)}</span>
                <span className="ml-auto tabular-nums">{formatMoney(refund.amount, currency)}</span>
              </span>
            ))}
          </div>
        ) : null}

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={billingPdfUrl({
                  orgSlug,
                  invoiceId: data.invoice.id,
                  request: { kind: "invoice", documentId: null, layout: "a4" },
                })}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Print
          </Button>
          {canReturn && returnable.length > 0 ? (
            <Button className="ml-auto" aria-haspopup="dialog" onClick={() => setReturning(true)}>
              Return
            </Button>
          ) : null}
        </div>
      </div>

      {returning ? (
        <ReturnDialog
          orgSlug={orgSlug}
          saleId={saleId}
          lines={returnable}
          onClose={() => setReturning(false)}
        />
      ) : null}
    </>
  );
}

const returnSchema = z
  .object({
    lines: z.array(
      z.object({
        invoiceLineId: z.string(),
        qty: numberText(z.number().int().min(0, "Quantity cannot be negative")),
      }),
    ),
    reasonCode: z.enum(RETURN_REASON_CODES),
    note: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
    refund: z
      .object({
        // Blank is "credit it, refund later"; a figure hands the money back with the return.
        amount: z
          .string()
          .refine(
            (value) => value.trim() === "" || DECIMAL_PATTERN.test(value),
            "Amount like 150.00",
          )
          .refine(
            (value) => value.trim() === "" || (parseMoneyInput(value) ?? ZERO) > ZERO,
            "Enter an amount above zero",
          ),
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().trim().max(100).optional(),
      })
      .superRefine((value, context) => {
        if (value.amount.trim() === "") return;
        requirePaymentReference(value, context);
      }),
  })
  .refine((value) => value.lines.some((line) => line.qty > 0), {
    path: ["lines"],
    message: "Enter a quantity on at least one line",
  });

type ReturnableLine = { invoiceLineId: string; description: string; remaining: number };

function ReturnLines({ lines }: { lines: ReturnableLine[] }) {
  const { control } = useFormContext<z.input<typeof returnSchema>>();
  const linesError = useFormState({ control, name: "lines" }).errors.lines?.root?.message;

  return (
    <>
      {lines.map((line, index) => (
        <div key={line.invoiceLineId} className="flex items-end gap-2">
          <RegisteredFormField
            name={`lines.${index}.invoiceLineId`}
            render={({ field }) => <input type="hidden" {...field} />}
          />
          <TextField
            name={`lines.${index}.qty`}
            label={
              <>
                {line.description} (<span className="tabular-nums">{line.remaining}</span> sold)
              </>
            }
            type="number"
            min={0}
            max={line.remaining}
            className="flex-1 tabular-nums"
            inputMode="numeric"
          />
        </div>
      ))}
      {linesError ? <p className="text-xs text-destructive">{linesError}</p> : null}
    </>
  );
}

function ReturnDialog({
  orgSlug,
  saleId,
  lines,
  onClose,
}: {
  orgSlug: string;
  saleId: string;
  lines: ReturnableLine[];
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Accept a return"
      description="Returned goods go to quarantine; the credit note posts against this sale."
      submitLabel="Record return"
      success="Return recorded"
      schema={returnSchema}
      defaultValues={{
        lines: lines.map((line) => ({
          invoiceLineId: line.invoiceLineId,
          qty: "0",
        })),
        reasonCode: "damaged",
        note: "",
        refund: { amount: "", method: "cash", reference: "" },
      }}
      onClose={onClose}
      run={(value) =>
        orpc.pharmacy.returnSale.call({
          orgSlug,
          saleId,
          reasonCode: value.reasonCode,
          note: value.note || undefined,
          lines: value.lines.filter((line) => line.qty > 0),
          refund:
            value.refund.amount.trim() === ""
              ? undefined
              : {
                  method: value.refund.method,
                  amount: parseMoneyInput(value.refund.amount) ?? ZERO,
                  reference: value.refund.reference || undefined,
                },
        })
      }
    >
      <ReturnLines lines={lines} />

      <ControlledField
        name="reasonCode"
        label="Reason"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              {RETURN_REASON_CODES.map((reason) => (
                <option key={reason} value={reason}>
                  {REASON_LABELS[reason]}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />

      <TextField name="note" label="Note" multiline />

      <div className="grid gap-3 sm:grid-cols-3">
        <RegisteredFormField
          name="refund.amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Refund now</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode="decimal"
                  placeholder="Leave blank"
                  className="text-right tabular-nums"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <ControlledField
          name="refund.method"
          label="Refund method"
          render={(field) => (
            <FormControl>
              <NativeSelect {...field}>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {methodLabel(method)}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          )}
        />
        <TextField name="refund.reference" label="Refund reference" />
      </div>
    </FormDialog>
  );
}
