import { MAX_STOCK_QTY } from "@hms/api/core/receipt-math";
import { Checkbox } from "@hms/ui/components/checkbox";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useRef } from "react";
import { useFormContext, Watch } from "react-hook-form";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { ControlledField, TextField } from "@/components/form-fields";
import { MedicineNameField } from "@/components/medicine-name-field";
import type { PickedProduct } from "@/components/product-picker";
import { orpc } from "@/lib/orpc";
import { SCHEDULE_LABELS, SCHEDULES, STOCK_UNITS } from "@/lib/pharmacy-labels";

/** Optional HSN entered only for a sold product. */
const productTaxCode = z.string().trim().max(20);

/** Counter products need a valid GST rate; internal supplies do not. */
function validateSoldProduct(
  value: { sold: boolean; taxRatePercent: string },
  context: z.RefinementCtx,
): void {
  if (!value.sold) return;

  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value.taxRatePercent)) {
    context.addIssue({
      code: "custom",
      path: ["taxRatePercent"],
      message: value.taxRatePercent ? "Rate like 0, 5, or 12.50" : "Enter GST %",
    });
  }
}

const productSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    genericName: z.string().trim().max(200),
    form: z.string().trim().max(50),
    strength: z.string().trim().max(50),
    manufacturer: z.string().trim().max(200),
    pack: z.string().trim().max(50),
    stockUnit: z.union([z.enum(STOCK_UNITS), z.literal("")]).transform((unit, context) => {
      if (unit) return unit;
      context.addIssue({ code: "custom", message: "Choose the counted unit" });

      return z.NEVER;
    }),
    schedule: z.enum(SCHEDULES),
    sold: z.boolean(),
    expires: z.boolean(),
    taxRatePercent: z.string().trim(),
    taxCode: productTaxCode,
    active: z.boolean(),
    comesInPacks: z.boolean(),
    unitsPerPack: z.string().trim(),
  })
  .superRefine((value, context) => {
    validateSoldProduct(value, context);

    if (!value.comesInPacks) return;

    if (
      !/^(?:[2-9]|[1-9]\d+)$/.test(value.unitsPerPack) ||
      Number(value.unitsPerPack) > MAX_STOCK_QTY
    ) {
      context.addIssue({
        code: "custom",
        path: ["unitsPerPack"],
        message: `Enter a whole number from 2 to ${MAX_STOCK_QTY}`,
      });
    }
  });

type Product = {
  productId: string;
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  manufacturer: string | null;
  stockUnit: (typeof STOCK_UNITS)[number];
  unitsPerPack: number;
  expires: boolean;
  pack: string | null;
  schedule: (typeof SCHEDULES)[number];
  sold: boolean;
  taxRatePercent: string | null;
  taxCode: string | null;
  active: boolean;
};

/** Shared product editor for the master and inline receipt creation. */
export function ProductSheet({
  orgSlug,
  product,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  product?: Product;
  onClose: () => void;
  onSaved?: (product: PickedProduct) => void;
}) {
  const packChoiceTouched = useRef(false);

  return (
    <FormSheet
      title={product ? "Edit product" : "Add product"}
      description="Name, pack and tax details carry onto every sale of this product."
      submitLabel={product ? "Save changes" : "Add product"}
      schema={productSchema}
      defaultValues={
        product
          ? {
              name: product.name,
              genericName: product.genericName ?? "",
              form: product.form ?? "",
              strength: product.strength ?? "",
              manufacturer: product.manufacturer ?? "",
              pack: product.pack ?? "",
              stockUnit: product.stockUnit,
              comesInPacks: product.unitsPerPack > 1,
              unitsPerPack: product.unitsPerPack > 1 ? String(product.unitsPerPack) : "",
              expires: product.expires,
              schedule: product.schedule,
              sold: product.sold,
              taxRatePercent: product.taxRatePercent ?? "",
              taxCode: product.taxCode ?? "",
              active: product.active,
            }
          : {
              name: "",
              genericName: "",
              form: "",
              strength: "",
              manufacturer: "",
              pack: "",
              stockUnit: "",
              schedule: "none",
              comesInPacks: false,
              unitsPerPack: "",
              expires: true,
              sold: true,
              taxRatePercent: "",
              taxCode: "",
              active: true,
            }
      }
      success={product ? "Product updated" : "Product added"}
      onClose={onClose}
      run={async (values) => {
        const fields = {
          orgSlug,
          name: values.name,
          genericName: values.genericName || undefined,
          form: values.form || undefined,
          strength: values.strength || undefined,
          manufacturer: values.manufacturer || undefined,
          stockUnit: values.stockUnit,
          unitsPerPack: values.comesInPacks ? Number(values.unitsPerPack) : 1,
          expires: values.expires,
          pack: values.pack || undefined,
          schedule: values.schedule,
          sold: values.sold,
          taxRatePercent: values.sold ? values.taxRatePercent : undefined,
          taxCode: values.sold ? values.taxCode || undefined : undefined,
          active: values.active,
        };

        const saved = product
          ? await orpc.pharmacy.updateProduct.call({ ...fields, productId: product.productId })
          : await orpc.pharmacy.createProduct.call(fields);

        onSaved?.({
          productId: saved.productId,
          name: values.name,
          stockUnit: values.stockUnit,
          unitsPerPack: fields.unitsPerPack,
          expires: values.expires,
          pack: values.pack || null,
          taxRatePercent: values.sold ? values.taxRatePercent : null,
          taxCode: values.sold ? values.taxCode || null : null,
        });

        return saved;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MedicineNameField orgSlug={orgSlug} label="Name" productId={product?.productId} />
        <TextField name="genericName" label="Generic name (optional)" />
        <TextField name="manufacturer" label="Manufacturer (optional)" />
        <TextField name="form" label="Form (optional)" placeholder="tablet" />
        <TextField name="strength" label="Strength (optional)" placeholder="500 mg" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="pack" label="Printed pack size (optional)" placeholder="170 ml" />
        <StockUnitField editing={!!product} packChoiceTouched={packChoiceTouched} />
      </div>

      <PackFields packChoiceTouched={packChoiceTouched} />
      <ControlledField
        name="expires"
        label="Has an expiry date"
        className="flex flex-wrap items-center gap-2"
        render={(field) => (
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        )}
      />

      <ControlledField
        name="schedule"
        label="Prescription"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              {SCHEDULES.map((schedule) => (
                <option key={schedule} value={schedule}>
                  {SCHEDULE_LABELS[schedule]}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />

      <ControlledField
        name="sold"
        label="Sold at the counter"
        description="Off for an internal supply: stocked and issued, never billed."
        className="flex flex-wrap items-center gap-2"
        render={(field) => (
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        )}
      />

      <SoldFields />
      {product ? (
        <ControlledField
          name="active"
          label="Active"
          className="flex flex-wrap items-center gap-2"
          render={(field) => (
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          )}
        />
      ) : null}
    </FormSheet>
  );
}

function StockUnitField({
  editing,
  packChoiceTouched,
}: {
  editing: boolean;
  packChoiceTouched: { current: boolean };
}) {
  const form = useFormContext();

  return (
    <ControlledField
      name="stockUnit"
      label="Counted in"
      render={(field) => (
        <FormControl>
          <NativeSelect
            {...field}
            onChange={(event) => {
              field.onChange(event);

              if (!editing && !packChoiceTouched.current) {
                form.setValue(
                  "comesInPacks",
                  event.target.value === "tablet" || event.target.value === "capsule",
                );
              }
            }}
          >
            <option value="" disabled>
              Choose a unit
            </option>
            {STOCK_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </NativeSelect>
        </FormControl>
      )}
    />
  );
}

/** A pack size is an explicit staff entry; medicine suggestions only fill printed text. */
function PackFields({ packChoiceTouched }: { packChoiceTouched: { current: boolean } }) {
  const form = useFormContext();

  return (
    <>
      <ControlledField
        name="comesInPacks"
        label="Comes in packs"
        className="flex flex-wrap items-center gap-2"
        render={(field) => (
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => {
                packChoiceTouched.current = true;
                field.onChange(checked);
              }}
            />
          </FormControl>
        )}
      />
      <Watch
        control={form.control}
        name="comesInPacks"
        exact
        render={(comesInPacks) =>
          comesInPacks ? (
            <Watch
              control={form.control}
              name="stockUnit"
              exact
              render={(unit) => (
                <TextField
                  name="unitsPerPack"
                  label={`${unit ? `${unit[0].toUpperCase()}${unit.slice(1)}s` : "Units"} in one pack`}
                  type="number"
                  min={2}
                  max={MAX_STOCK_QTY}
                  step={1}
                  required
                />
              )}
            />
          ) : null
        }
      />
    </>
  );
}

/** The billing details, present only while the product is sold at the counter. */
function SoldFields() {
  const { control } = useFormContext();

  return (
    <Watch
      control={control}
      name="sold"
      exact
      render={(sold) =>
        sold ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="taxRatePercent" label="GST %" inputMode="decimal" placeholder="12" />
            <TextField name="taxCode" label="HSN (optional)" />
          </div>
        ) : null
      }
    />
  );
}
