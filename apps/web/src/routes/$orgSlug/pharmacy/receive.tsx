import { parseDecimal } from "@hms/api/core/money";
import { exactToPaise, RECEIPT_ADJUSTMENT_KINDS } from "@hms/api/core/receipt-math";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Form, FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  type Control,
  useFieldArray,
  useFormContext,
  useFormState,
  useWatch,
} from "react-hook-form";
import { toast } from "sonner";

import { appHead } from "@/config/site";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { ProductSheet } from "@/components/product-sheet";
import { PageBody, PageHeader } from "@/components/page";
import { BatchLines } from "@/components/receipt-batch-lines";
import {
  blankAdjustment,
  blankLine,
  fillLine,
  type Receipt,
  type ReceiptInput,
  receiptSchema,
  rowText,
} from "@/components/receipt-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { billSummary, stockQuantities } from "@/lib/receipt-lines";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/pharmacy/receive")({
  head: () => appHead("Receive goods"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { pharmacy: ["receive"] },
      "/$orgSlug/pharmacy",
    );
  },
  component: ReceiveGoodsRoute,
});

function ReceiveGoodsRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const { today } = useOrgDateTime();
  const canManageItems = useCan(orgSlug, { pharmacy: ["manageItems"] });
  const schema = receiptSchema(today);

  const form = useZodForm(schema, {
    defaultValues: {
      opening: false,
      supplierName: "",
      supplierReference: "",
      receivedOn: today,
      billTotal: "",
      note: "",
      lines: [blankLine()],
      adjustments: [],
    },
  });

  const [newProductLine, setNewProductLine] = useState<number | null>(null);
  const opening = useWatch({ control: form.control, name: "opening" });

  const receive = useMutation(
    orpc.pharmacy.receiveGoods.mutationOptions({
      onSuccess: async (_data, variables) => {
        toast.success(
          variables.lines.length === 1
            ? "1 batch received"
            : `${variables.lines.length} batches received`,
        );
        await navigate({
          to: "/$orgSlug/pharmacy/stock",
          params: { orgSlug },
          ignoreBlocker: true,
        });
      },
    }),
  );

  const locked = receive.isPending;

  const submit = form.handleSubmit((values: Receipt) => {
    receive.mutate({
      orgSlug,
      opening: values.opening,
      supplierName: values.opening ? undefined : values.supplierName,
      supplierReference: values.opening ? undefined : values.supplierReference || undefined,
      receivedOn: values.receivedOn,
      billTotal: values.opening ? undefined : parseDecimal(values.billTotal),
      note: values.note || undefined,
      adjustments: values.adjustments.map((row) => ({
        kind: row.kind,
        reason: row.reason,
        amount: parseDecimal(row.amount),
        gstAmount: parseDecimal(row.gstAmount),
      })),
      lines: values.lines.map((line) => {
        const row = rowText(line);
        const quantities = stockQuantities(row, values.opening);

        if (!quantities) throw new Error("A validated receipt line exceeds stock limits");

        return {
          productId: line.productId,
          batchNumber: line.batchNumber,
          expiryDate: line.expires ? line.expiryDate : undefined,
          qty: quantities.qty,
          pricedPer: quantities.packSize === 1 ? ("unit" as const) : ("pack" as const),
          mrp: parseDecimal(line.price),
          cost: values.opening
            ? undefined
            : {
                freeQty: quantities.freeQty,
                rate: parseDecimal(line.rate),
                discountPercent: line.discount,
                gstPercent: line.gst,
                hsnCode: line.hsn || undefined,
              },
        };
      }),
    });
  });

  return (
    <>
      <PageHeader
        title="Receive goods"
        action={
          <Button
            variant="outline"
            nativeButton={false}
            disabled={locked}
            render={<Link to="/$orgSlug/pharmacy/stock" params={{ orgSlug }} />}
          >
            Back to stock
          </Button>
        }
      />

      <PageBody width="max-w-6xl">
        <Form {...form}>
          <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
            <fieldset disabled={locked} className="contents">
              <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 id="delivery-heading" className="text-sm font-medium">
                      Delivery details
                    </h2>
                    <p className="text-muted-foreground">
                      {opening
                        ? "Enter each batch you counted on the shelf."
                        : "Work down the supplier bill. Use one line for each product and batch."}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Receive as"
                    className="flex w-fit gap-1 rounded-md border border-border p-1"
                  >
                    {[
                      { label: "Supplier", value: false },
                      { label: "Opening", value: true },
                    ].map((mode) => (
                      <Button
                        key={mode.label}
                        type="button"
                        size="xs"
                        variant={opening === mode.value ? "default" : "ghost"}
                        aria-pressed={opening === mode.value}
                        onClick={() => {
                          // An opening count has no bill, so it carries no bill adjustments.
                          if (mode.value) form.setValue("adjustments", []);
                          form.setValue("opening", mode.value, { shouldDirty: true });
                        }}
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {opening ? null : (
                    <>
                      <TextField name="supplierName" label="Supplier" placeholder="Supplier name" />
                      <TextField
                        name="supplierReference"
                        label="Bill number"
                        placeholder="Bill number"
                      />
                      <TextField
                        name="billTotal"
                        label="Bill total"
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </>
                  )}
                  <TextField
                    name="receivedOn"
                    label={opening ? "Counted on" : "Received on"}
                    type="date"
                  />
                </div>
                {opening ? null : <BillAdjustments />}
              </section>

              <BatchLines
                orgSlug={orgSlug}
                today={today}
                opening={opening}
                canManageItems={canManageItems}
                onNewProduct={setNewProductLine}
              />

              <div className="grid gap-4 lg:grid-cols-[minmax(0,36rem)_1fr]">
                <TextField
                  name="note"
                  label="Note (optional)"
                  placeholder="Optional note for the stock team"
                  multiline
                  className="[&_textarea]:min-h-20"
                />
                <div className="flex flex-wrap items-end justify-between gap-3 lg:flex-col lg:justify-end">
                  <ReceiptTotals orgSlug={orgSlug} opening={opening} />
                  <SubmitButton isSubmitting={locked}>Receive goods</SubmitButton>
                </div>
              </div>
            </fieldset>
          </form>
        </Form>
      </PageBody>

      {newProductLine !== null ? (
        <ProductSheet
          orgSlug={orgSlug}
          onClose={() => setNewProductLine(null)}
          onSaved={(product) => {
            fillLine(form, newProductLine, product);
            setNewProductLine(null);
          }}
        />
      ) : null}

      <LeaveGuard control={form.control} locked={locked} />
    </>
  );
}

const ADJUSTMENT_LABELS = {
  landed_charge: "Charge (freight, packing)",
  invoice_discount: "Discount",
} satisfies Record<(typeof RECEIPT_ADJUSTMENT_KINDS)[number], string>;

/** Charges or discounts printed apart from the lines; owns its rows without re-rendering the page. */
function BillAdjustments() {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const adjustments = useFieldArray({ control, name: "adjustments", keyName: "fieldKey" });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {adjustments.fields.map((row, index) => (
        <fieldset
          key={row.fieldKey}
          className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <legend className="sr-only">Bill adjustment {index + 1}</legend>
          <ControlledField
            name={`adjustments.${index}.kind`}
            label="Kind"
            className="col-span-2 sm:col-span-1"
            render={(field) => (
              <FormControl>
                <NativeSelect {...field}>
                  {RECEIPT_ADJUSTMENT_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {ADJUSTMENT_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
            )}
          />
          <TextField
            name={`adjustments.${index}.reason`}
            label="Reason"
            maxLength={500}
            className="col-span-2 sm:col-span-1"
          />
          <TextField
            name={`adjustments.${index}.amount`}
            label="Amount"
            inputMode="decimal"
            placeholder="0.00"
          />
          <TextField
            name={`adjustments.${index}.gstAmount`}
            label="GST"
            inputMode="decimal"
            placeholder="0.00"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="col-span-2 justify-self-end sm:col-span-1 sm:self-end"
            aria-label={`Remove adjustment ${index + 1}`}
            onClick={() => adjustments.remove(index)}
          >
            <Trash2Icon />
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="w-fit"
        onClick={() => adjustments.append(blankAdjustment())}
      >
        Add freight or discount
      </Button>
    </div>
  );
}

/** Reads `isDirty` here, so a dirty change never re-renders the page and its rows. */
function LeaveGuard({
  control,
  locked,
}: {
  control: Control<ReceiptInput, unknown, Receipt>;
  locked: boolean;
}) {
  const { isDirty } = useFormState({ control });

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty || locked,
    enableBeforeUnload: isDirty || locked,
    withResolver: true,
  });

  return blocker.status === "blocked" && !locked ? (
    <ConfirmDialog
      title="Leave without receiving these goods?"
      description="The receipt has not been saved."
      confirmLabel="Leave"
      open
      onConfirm={blocker.proceed}
      onCancel={blocker.reset}
    />
  ) : null;
}

/** Stock added, and on a delivery the bill arithmetic checked against its printed total. */
function ReceiptTotals({ orgSlug, opening }: { orgSlug: string; opening: boolean }) {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const [lines, billTotal, adjustments] = useWatch({
    control,
    name: ["lines", "billTotal", "adjustments"],
  });

  let quantity = 0;

  for (const line of lines) {
    const quantities = stockQuantities(rowText(line), opening);
    quantity += quantities ? quantities.qty + quantities.freeQty : 0;
  }

  const summary = opening ? null : billSummary(lines.map(rowText), billTotal, adjustments);

  return (
    <div className="flex flex-col gap-1 tabular-nums lg:items-end lg:text-right">
      <p className="font-medium">
        {lines.length} batch{lines.length === 1 ? "" : "es"} · {quantity} stock unit
        {quantity === 1 ? "" : "s"}
      </p>
      {summary ? (
        <>
          <p className="text-muted-foreground">
            Taxable {formatMoney(exactToPaise(summary.taxable), currency)} · GST{" "}
            {formatMoney(exactToPaise(summary.gst), currency)} · Lines{" "}
            {formatMoney(summary.net, currency)}
            {adjustments.length > 0
              ? ` · Adjustments ${formatMoney(summary.adjustments, currency)}`
              : null}
          </p>
          {summary.roundOff === null ? (
            <p className="text-muted-foreground">
              {summary.complete
                ? "Enter the bill total to check it"
                : "Price every line to check the bill"}
            </p>
          ) : (
            <p
              className="flex flex-wrap items-center gap-2 lg:justify-end"
              role={summary.matches ? undefined : "alert"}
            >
              <Badge variant={summary.matches ? "muted" : "destructive"}>
                {summary.matches ? "Matches bill" : "Does not match bill"}
              </Badge>
              <span className={summary.matches ? "text-muted-foreground" : "text-destructive"}>
                {summary.matches ? "Round-off" : "Off by"} {formatMoney(summary.roundOff, currency)}
              </span>
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
