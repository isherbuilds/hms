import { DECIMAL_PATTERN, parseDecimal } from "@hms/api/core/money";
import { PERCENT_PATTERN, exactToPaise } from "@hms/api/core/receipt-math";
import { expiryMonth } from "@hms/api/lib/schemas";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Form, FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { cn } from "@hms/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { NewProductSheet } from "@/components/pharmacy-new-product-sheet";
import { PageBody, PageHeader, Panel } from "@/components/page";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { useZodForm } from "@/hooks/use-zod-form";
import { numberText } from "@/lib/form-schema";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orgToday, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import {
  approximateUnitCost,
  billSummary,
  costAtOrAboveMrp,
  packSizeOf,
  type ReceiptRowText,
  rowCost,
  stockQuantities,
} from "@/lib/receipt-lines";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/pharmacy/receive")({
  head: () => ({ meta: [{ title: "Receive goods · HMS" }] }),
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

/** A measure has no plural: 200 capsules, but 200 ml. */
function countOf(quantity: number, unit: string) {
  return `${quantity} ${unit === "ml" || quantity === 1 ? unit : `${unit}s`}`;
}

function unitsWord(unit: string) {
  return unit === "ml" ? unit : `${unit}s`;
}

/** Whole months from this month to the printed one; negative once the month has passed. */
function monthsUntil(expiry: string, today: string) {
  const [thisYear, thisMonth] = today.split("-").map(Number);
  const [year, month] = expiry.split("-").map(Number);

  return (year - thisYear) * 12 + (month - thisMonth);
}

const wholeText = /^\d+$/;

// Pricing is plain text here: an opening count carries none, so the receipt-level refine
// asks for it only on a supplier delivery.
const receiptLineSchema = (today: string) =>
  z
    .object({
      productId: z.string().min(1, "Choose a product"),
      productName: z.string(),
      stockUnit: z.string(),
      unitsPerPack: z.number().int().min(1),
      batchNumber: z.string().trim().min(1, "Type the batch number").max(50),
      expiryDate: expiryMonth,
      count: numberText(z.number().int().min(1, "At least 1")),
      loose: z.boolean(),
      price: z.string().regex(DECIMAL_PATTERN, "A price like 84 or 84.20"),
      free: z.string().trim(),
      rate: z.string().trim(),
      discount: z.string().trim(),
      gst: z.string().trim(),
      hsn: z.string().trim().max(20),
    })
    .superRefine((value, context) => {
      if (monthsUntil(value.expiryDate, today) < 0) {
        context.addIssue({
          code: "custom",
          path: ["expiryDate"],
          message: "This batch has expired. Check the date on the pack.",
        });
      }
    });

const receiptSchema = (today: string) =>
  z
    .object({
      opening: z.boolean(),
      supplierName: z.string().trim().max(200),
      supplierReference: z.string().trim().max(100),
      receivedOn: z.iso.date("Use a valid date"),
      billTotal: z.string().trim(),
      note: z.string().trim().max(500),
      lines: z.array(receiptLineSchema(today)).min(1, "Add at least one batch"),
    })
    .superRefine((value, context) => {
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });

      value.lines.forEach((line, index) => {
        const row = rowText(line);

        if (!value.opening && line.free !== "" && !wholeText.test(line.free)) {
          issue(["lines", index, "free"], "Enter a whole number");
        } else if (!stockQuantities(row, value.opening)) {
          issue(["lines", index, stockQuantities(row, true) ? "free" : "count"], "Too large");
        }
      });

      if (value.opening) return;

      if (value.supplierName === "") issue(["supplierName"], "Type who delivered this");

      value.lines.forEach((line, index) => {
        if (!DECIMAL_PATTERN.test(line.rate)) issue(["lines", index, "rate"], "A rate like 76.19");

        if (!PERCENT_PATTERN.test(line.discount)) {
          issue(["lines", index, "discount"], "0 to 99.99");
        }

        if (!PERCENT_PATTERN.test(line.gst)) issue(["lines", index, "gst"], "0, 5, 12 or 18");
      });

      if (!DECIMAL_PATTERN.test(value.billTotal)) {
        issue(["billTotal"], "The grand total printed on the bill");

        return;
      }

      const summary = billSummary(value.lines.map(rowText), value.billTotal);

      if (summary.complete && !summary.matches) {
        issue(["billTotal"], "The lines do not add up to this total");
      }
    });

type ReceiptInput = z.input<ReturnType<typeof receiptSchema>>;

type ReceiptLineInput = ReceiptInput["lines"][number];

type Receipt = z.output<ReturnType<typeof receiptSchema>>;

function rowText(line: {
  unitsPerPack: number;
  loose: boolean;
  count: string | number;
  free: string;
  rate: string;
  discount: string;
  gst: string;
  price: string;
}): ReceiptRowText {
  return { ...line, count: String(line.count) };
}

function blankLine(): ReceiptLineInput {
  return {
    productId: "",
    productName: "",
    stockUnit: "",
    unitsPerPack: 1,
    batchNumber: "",
    expiryDate: "",
    count: "",
    loose: false,
    price: "",
    free: "",
    rate: "",
    discount: "0",
    gst: "",
    hsn: "",
  };
}

/**
 * What a picked product fills on its line: the unit it counts in, and its counter tax
 * where it has one. A rate or code already typed from the bill stays when it has none.
 */
function productFields(product: PickedProduct | null, line: ReceiptLineInput) {
  return {
    productId: product?.productId ?? "",
    productName: product?.name ?? "",
    stockUnit: product?.stockUnit ?? "",
    unitsPerPack: product?.unitsPerPack ?? 1,
    loose: product?.unitsPerPack === 1,
    gst: product?.taxRatePercent ? String(Number(product.taxRatePercent)) : line.gst,
    hsn: product?.taxCode ?? line.hsn,
  };
}

function ReceiveGoodsRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const { timeZone, today } = useOrgDateTime();
  const canManageItems = useCan(orgSlug, { pharmacy: ["manageItems"] });
  const schema = useMemo(() => receiptSchema(today), [today]);

  const form = useZodForm(schema, {
    defaultValues: {
      opening: false,
      supplierName: "",
      supplierReference: "",
      receivedOn: orgToday(timeZone),
      billTotal: "",
      note: "",
      lines: [blankLine()],
    },
  });

  const lines = useFieldArray({ control: form.control, name: "lines", keyName: "fieldKey" });
  const [newProductLine, setNewProductLine] = useState<number | null>(null);
  const opening = useWatch({ control: form.control, name: "opening" });
  const dirty = form.formState.isDirty;

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

  const blocker = useBlocker({
    shouldBlockFn: () => dirty || locked,
    enableBeforeUnload: dirty || locked,
    withResolver: true,
  });

  const submit = form.handleSubmit((values: Receipt) => {
    receive.mutate({
      orgSlug,
      opening: values.opening,
      supplierName: values.opening ? undefined : values.supplierName,
      supplierReference: values.opening ? undefined : values.supplierReference || undefined,
      receivedOn: values.receivedOn,
      billTotal: values.opening ? undefined : parseDecimal(values.billTotal),
      note: values.note || undefined,
      lines: values.lines.map((line) => {
        const row = rowText(line);
        const quantities = stockQuantities(row, values.opening);

        if (!quantities) throw new Error("A validated receipt line exceeds stock limits");

        return {
          productId: line.productId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
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

  const fillLine = (index: number, product: PickedProduct | null) => {
    const line = form.getValues(`lines.${index}`);

    form.setValue(
      `lines.${index}`,
      { ...line, ...productFields(product, line) },
      { shouldDirty: true },
    );

    if (form.getFieldState(`lines.${index}.productId`).error) {
      void form.trigger(`lines.${index}.productId`);
    }
  };

  const openNewProduct = () => {
    const available = form.getValues("lines").findIndex((line) => line.productId === "");

    if (available >= 0) {
      setNewProductLine(available);

      return;
    }

    const index = lines.fields.length;
    lines.append(blankLine());
    setNewProductLine(index);
  };

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
                        onClick={() => form.setValue("opening", mode.value, { shouldDirty: true })}
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
              </section>

              <Panel
                label="Products & batches"
                action={
                  <span className="tabular-nums">
                    {lines.fields.length} line{lines.fields.length === 1 ? "" : "s"}
                  </span>
                }
                minHeight="min-h-0"
                footer={
                  <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => lines.append(blankLine())}
                      size="xs"
                    >
                      Add batch
                    </Button>
                    {canManageItems ? (
                      <Button type="button" variant="link" size="xs" onClick={openNewProduct}>
                        New product
                      </Button>
                    ) : null}
                  </div>
                }
              >
                <div className="flex min-w-0 flex-col">
                  {lines.fields.map((line, index) => (
                    <BatchRow
                      key={line.fieldKey}
                      index={index}
                      orgSlug={orgSlug}
                      today={today}
                      opening={opening}
                      onPick={(product) => fillLine(index, product)}
                      onRemove={() => lines.remove(index)}
                    />
                  ))}
                </div>
                {lines.fields.length === 0 ? (
                  <p className="px-4 py-6 text-center text-muted-foreground">
                    No batches yet. Add a batch to continue.
                  </p>
                ) : null}
                {typeof form.formState.errors.lines?.message === "string" ? (
                  <p role="alert" className="border-t border-border px-3 py-2 text-destructive">
                    {form.formState.errors.lines.message}
                  </p>
                ) : null}
              </Panel>

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
        <NewProductSheet
          orgSlug={orgSlug}
          onClose={() => setNewProductLine(null)}
          onAdded={(product) => {
            fillLine(newProductLine, product);
            setNewProductLine(null);
          }}
        />
      ) : null}

      {blocker.status === "blocked" && !locked ? (
        <ConfirmDialog
          title="Leave without receiving these goods?"
          description="The receipt has not been saved."
          confirmLabel="Leave"
          open
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      ) : null}
    </>
  );
}

/**
 * One product and batch as the bill prints it. The first row names the stock; the second
 * prices it, and on an opening count asks only the printed MRP.
 */
function BatchRow({
  index,
  orgSlug,
  today,
  opening,
  onPick,
  onRemove,
}: {
  index: number;
  orgSlug: string;
  today: string;
  opening: boolean;
  onPick: (product: PickedProduct | null) => void;
  onRemove: () => void;
}) {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const line = useWatch({ control, name: `lines.${index}` });
  const row = rowText(line);
  const packSize = packSizeOf(row);
  const perCounted = packSize === 1 ? line.stockUnit || "unit" : "pack";
  const quantities = stockQuantities(row, opening);
  const quantity = quantities?.qty;
  const free = quantities?.freeQty;
  const cost = opening ? null : rowCost(row);
  const overMrp = costAtOrAboveMrp(row, cost);
  const unitCost = cost ? approximateUnitCost(row, cost) : null;

  const monthsLeft = /^\d{4}-\d{2}$/.test(line.expiryDate)
    ? monthsUntil(line.expiryDate, today)
    : null;

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-2 gap-x-3 gap-y-4 border-b border-border p-4 last:border-b-0 md:grid-cols-4",
        opening ? "lg:grid-cols-[repeat(7,minmax(0,1fr))_auto]" : "lg:grid-cols-7",
      )}
    >
      <ControlledField
        name={`lines.${index}.productId`}
        label={`Product ${index + 1}`}
        className="col-span-2 min-w-0"
        render={() => (
          <FormControl>
            <ProductPicker
              orgSlug={orgSlug}
              value={line.productId ? { productId: line.productId, name: line.productName } : null}
              onChange={onPick}
            />
          </FormControl>
        )}
      />
      <TextField name={`lines.${index}.batchNumber`} label="Batch" placeholder="Printed on pack" />
      <TextField
        name={`lines.${index}.expiryDate`}
        label="Expiry"
        type="month"
        min={today.slice(0, 7)}
        description={
          monthsLeft !== null && monthsLeft >= 0 && monthsLeft < 6
            ? monthsLeft === 0
              ? "Expires this month"
              : `Only ${monthsLeft} month${monthsLeft === 1 ? "" : "s"} left`
            : undefined
        }
      />
      <TextField
        name={`lines.${index}.count`}
        label={opening ? "Counted" : "Billed qty"}
        inputMode="numeric"
        description={quantity && line.stockUnit ? countOf(quantity, line.stockUnit) : undefined}
      />
      {line.unitsPerPack > 1 ? (
        <ControlledField
          name={`lines.${index}.loose`}
          label="Count as"
          render={(field) => (
            <FormControl>
              <NativeSelect
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={field.value ? "loose" : "packs"}
                onChange={(event) => field.onChange(event.target.value === "loose")}
                disabled={!line.productId}
              >
                <option value="packs">Packs of {line.unitsPerPack}</option>
                <option value="loose">
                  Loose {line.stockUnit ? unitsWord(line.stockUnit) : "units"}
                </option>
              </NativeSelect>
            </FormControl>
          )}
        />
      ) : (
        <span className="self-end py-2 text-muted-foreground">{line.stockUnit || "unit"}</span>
      )}
      <div className={cn("order-last flex items-end lg:justify-end", !opening && "lg:order-none")}>
        <Button
          type="button"
          variant="destructive"
          className="w-full lg:w-8 lg:min-w-0 lg:px-0"
          aria-label={`Remove ${line.productName || `batch ${index + 1}`}`}
          onClick={onRemove}
        >
          <Trash2Icon />
          <span className="lg:hidden">Remove</span>
        </Button>
      </div>

      {opening ? null : (
        <>
          <TextField
            name={`lines.${index}.free`}
            label="Free qty"
            inputMode="numeric"
            placeholder="0"
            description={free && line.stockUnit ? countOf(free, line.stockUnit) : undefined}
          />
          <TextField
            name={`lines.${index}.rate`}
            label={`Rate / ${perCounted}`}
            inputMode="decimal"
            placeholder="PTR"
          />
          <TextField name={`lines.${index}.discount`} label="Disc %" inputMode="decimal" />
          <TextField name={`lines.${index}.gst`} label="GST %" inputMode="decimal" />
        </>
      )}
      <TextField
        name={`lines.${index}.price`}
        label={`MRP / ${perCounted}`}
        inputMode="decimal"
        placeholder="0.00"
      />
      {opening ? null : (
        <>
          <TextField name={`lines.${index}.hsn`} label="HSN" placeholder="3004" />
          <div className="flex min-w-0 flex-col gap-1 tabular-nums md:items-end md:text-right">
            <span className="text-muted-foreground">Line total</span>
            <span className="py-2 font-medium">
              {cost ? formatMoney(exactToPaise(cost.net), currency) : "—"}
            </span>
            {unitCost !== null ? (
              <span className={overMrp ? "text-destructive" : "text-muted-foreground"}>
                {overMrp ? "Costs at or above MRP: " : ""}≈ {formatMoney(unitCost, currency)} /{" "}
                {line.stockUnit || "unit"}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Stock added, and on a delivery the bill arithmetic checked against its printed total. */
function ReceiptTotals({ orgSlug, opening }: { orgSlug: string; opening: boolean }) {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const [lines, billTotal] = useWatch({ control, name: ["lines", "billTotal"] });
  let quantity = 0;

  for (const line of lines) {
    const quantities = stockQuantities(rowText(line), opening);
    quantity += quantities ? quantities.qty + quantities.freeQty : 0;
  }

  const summary = opening ? null : billSummary(lines.map(rowText), billTotal);

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
