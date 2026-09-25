import { exactToPaise } from "@hms/api/core/receipt-math";
import { Button } from "@hms/ui/components/button";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { cn } from "@hms/ui/lib/utils";
import { Trash2Icon } from "lucide-react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";

import { ControlledField, TextField } from "@/components/form-fields";
import { Panel } from "@/components/page";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import {
  blankLine,
  fillLine,
  monthsUntil,
  type ReceiptInput,
  type Receipt,
  rowText,
} from "@/components/receipt-form";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import {
  approximateUnitCost,
  costAtOrAboveMrp,
  packSizeOf,
  rowCost,
  stockQuantities,
} from "@/lib/receipt-lines";

/** A measure has no plural: 200 capsules, but 200 ml. */
function countOf(quantity: number, unit: string) {
  return `${quantity} ${unit === "ml" || quantity === 1 ? unit : `${unit}s`}`;
}

function unitsWord(unit: string) {
  return unit === "ml" ? unit : `${unit}s`;
}

/**
 * The receipt's lines. It owns the field array, so adding or removing a batch re-renders
 * this panel and not the page around it.
 */
export function BatchLines({
  orgSlug,
  today,
  opening,
  canManageItems,
  onNewProduct,
}: {
  orgSlug: string;
  today: string;
  opening: boolean;
  canManageItems: boolean;
  /** Opens the new-product sheet for the line that will receive it. */
  onNewProduct: (index: number) => void;
}) {
  const { control, getValues } = useFormContext<ReceiptInput, unknown, Receipt>();
  const lines = useFieldArray({ control, name: "lines", keyName: "fieldKey" });

  const openNewProduct = () => {
    const available = getValues("lines").findIndex((line) => line.productId === "");

    if (available >= 0) {
      onNewProduct(available);

      return;
    }

    lines.append(blankLine());
    onNewProduct(lines.fields.length);
  };

  return (
    <Panel
      label="Products & batches"
      action={
        <span className="tabular-nums">
          {lines.fields.length} line
          {lines.fields.length === 1 ? "" : "s"}
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
            remove={lines.remove}
          />
        ))}
      </div>
      {lines.fields.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted-foreground">
          No batches yet. Add a batch to continue.
        </p>
      ) : null}
      <LinesError />
    </Panel>
  );
}

/** The array-level error alone, so row errors do not re-render the panel. */
function LinesError() {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const { errors } = useFormState({ control, name: "lines", exact: true });

  return typeof errors.lines?.message === "string" ? (
    <p role="alert" className="border-t border-border px-3 py-2 text-destructive">
      {errors.lines.message}
    </p>
  ) : null;
}

/** A snapshot of the line; RHF mutates it in place, and the copy lets `compute` skip no-op updates. */
const copyLine = (line: ReceiptInput["lines"][number]) => ({ ...line });

/**
 * One product and batch as the bill prints it. The first row names the stock; the second
 * prices it, and on an opening count asks only the printed MRP.
 */
function BatchRow({
  index,
  orgSlug,
  today,
  opening,
  remove,
}: {
  index: number;
  orgSlug: string;
  today: string;
  opening: boolean;
  remove: (index: number) => void;
}) {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const line = useWatch({ control, name: `lines.${index}`, compute: copyLine });
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
      <ProductCell index={index} orgSlug={orgSlug} />
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
      <div className={cn("order-last flex items-end lg:justify-end", !opening && "lg:order-0")}>
        <Button
          type="button"
          variant="destructive"
          className="w-full lg:w-8 lg:min-w-0 lg:px-0"
          aria-label={`Remove ${line.productName || `batch ${index + 1}`}`}
          onClick={() => remove(index)}
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

const pickedOf = (line: ReceiptInput["lines"][number]) =>
  line.productId ? { productId: line.productId, name: line.productName } : null;

/** Watches only the product, so typing elsewhere in the row leaves the picker alone. */
function ProductCell({ index, orgSlug }: { index: number; orgSlug: string }) {
  const form = useFormContext<ReceiptInput, unknown, Receipt>();
  const value = useWatch({ control: form.control, name: `lines.${index}`, compute: pickedOf });
  // Out of the render prop: the Controller calls it on every form change, and a closure
  // made there would hand the memoized picker new props each time.
  const onChange = (product: PickedProduct | null) => fillLine(form, index, product);

  return (
    <ControlledField
      name={`lines.${index}.productId`}
      label={`Product ${index + 1}`}
      className="col-span-2 min-w-0"
      render={() => (
        <FormControl>
          <ProductPicker orgSlug={orgSlug} value={value} onChange={onChange} />
        </FormControl>
      )}
    />
  );
}
