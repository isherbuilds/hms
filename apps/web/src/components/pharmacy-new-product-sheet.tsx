import { Checkbox } from "@hms/ui/components/checkbox";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useFormContext, Watch } from "react-hook-form";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { ControlledField, TextField } from "@/components/form-fields";
import { MedicineNameField } from "@/components/medicine-name-field";
import type { PickedProduct } from "@/components/product-picker";
import { numberText } from "@/lib/form-schema";
import { orpc } from "@/lib/orpc";
import { SCHEDULE_LABELS, SCHEDULES, STOCK_UNITS } from "@/lib/pharmacy-labels";

/** The optional HSN entered for a sold product, shared with the Products form. */
export const productTaxCode = z.string().trim().max(20);

/** Counter products need a code and a valid GST rate; internal supplies need neither. */
export function validateSoldProduct(
  value: { sold: boolean; code: string; taxRatePercent: string },
  context: z.RefinementCtx,
): void {
  if (!value.sold) return;

  if (value.code === "") {
    context.addIssue({ code: "custom", path: ["code"], message: "Code is required" });
  }

  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value.taxRatePercent)) {
    context.addIssue({
      code: "custom",
      path: ["taxRatePercent"],
      message: "Rate like 0, 5, or 12.50",
    });
  }
}

const newProductSchema = z
  .object({
    name: z.string().trim().min(1, "It needs a name").max(200),
    form: z.string().trim().max(50),
    strength: z.string().trim().max(50),
    manufacturer: z.string().trim().max(200),
    unitsPerPack: numberText(z.number().int().min(1, "At least 1 per pack")),
    stockUnit: z.enum(STOCK_UNITS),
    schedule: z.enum(SCHEDULES),
    sold: z.boolean(),
    code: z.string().trim().max(20),
    taxRatePercent: z.string().trim(),
    taxCode: productTaxCode,
  })
  .superRefine(validateSoldProduct);

/** A medicine the shelf has never held, named where it is missed, then back. */
export function NewProductSheet({
  orgSlug,
  onClose,
  onAdded,
}: {
  orgSlug: string;
  onClose: () => void;
  onAdded: (product: PickedProduct) => void;
}) {
  return (
    <FormSheet
      title="New product"
      description="Only what the shelf needs. The rest can be filled in under Products."
      submitLabel="Add product"
      schema={newProductSchema}
      defaultValues={{
        name: "",
        form: "",
        strength: "",
        manufacturer: "",
        unitsPerPack: "1",
        stockUnit: "tablet",
        schedule: "none",
        sold: true,
        code: "",
        taxRatePercent: "0",
        taxCode: "",
      }}
      success="Medicine added"
      onClose={onClose}
      run={async (values) => {
        const created = await orpc.pharmacy.createProduct.call({
          orgSlug,
          name: values.name,
          form: values.form || undefined,
          strength: values.strength || undefined,
          manufacturer: values.manufacturer || undefined,
          stockUnit: values.stockUnit,
          unitsPerPack: values.unitsPerPack,
          schedule: values.schedule,
          catalog: values.sold
            ? {
                code: values.code,
                taxRatePercent: values.taxRatePercent,
                taxCode: values.taxCode || undefined,
                active: true,
              }
            : undefined,
        });

        onAdded({
          productId: created.productId,
          name: values.name,
          stockUnit: values.stockUnit,
          unitsPerPack: values.unitsPerPack,
          taxRatePercent: values.sold ? values.taxRatePercent : null,
          taxCode: values.sold ? values.taxCode || null : null,
        });

        return created;
      }}
    >
      <MedicineNameField
        orgSlug={orgSlug}
        label="What is it called?"
        description="Exactly as it reads on the box."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="strength" label="Strength (optional)" placeholder="500 mg" />
        <TextField name="form" label="Form (optional)" placeholder="tablet" />
        <TextField name="manufacturer" label="Manufacturer (optional)" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="unitsPerPack" label="What does one pack hold?" inputMode="numeric" />
        <ControlledField
          name="stockUnit"
          label="Counted in"
          render={(field) => (
            <FormControl>
              <NativeSelect {...field}>
                {STOCK_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          )}
        />
      </div>

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
        label="We sell this at the counter"
        description="Off for an internal supply: stocked and issued, never billed."
        className="flex flex-wrap items-center gap-2"
        render={(field) => (
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        )}
      />

      <SoldFields />
    </FormSheet>
  );
}

/** The billing details, present only while the medicine is sold at the counter. */
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
            <TextField name="code" label="Code" />
            <TextField name="taxRatePercent" label="GST %" inputMode="decimal" placeholder="12" />
            <TextField name="taxCode" label="HSN (optional)" />
          </div>
        ) : null
      }
    />
  );
}
