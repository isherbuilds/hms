import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";
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
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { ControlledField, TextField } from "@/components/form-fields";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError } from "@/lib/orpc-error";

// Kept local so no @hms/db server module reaches the client bundle (hard rule 6).
// Medicines are written only from Pharmacy → Items, so the form never offers that
// category while the list still shows and filters by it.
const EDITABLE_CATEGORIES = ["consultation", "procedure", "lab", "radiology", "other"] as const;

export type EditableCategory = (typeof EDITABLE_CATEGORIES)[number];

export const CATALOG_CATEGORIES = [...EDITABLE_CATEGORIES, "pharmacy"] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  lab: "Lab",
  radiology: "Radiology",
  pharmacy: "Pharmacy",
  other: "Other",
};

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Keep the name under 200 characters"),
  code: z.string().trim().min(1, "Code is required").max(20, "Keep the code under 20 characters"),
  category: z.enum(EDITABLE_CATEGORIES),
  unitPrice: z.string().regex(DECIMAL_PATTERN, "Amount like 150 or 150.00").transform(parseDecimal),
  taxRatePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 0, 5, or 12.50"),
  taxCode: z.string().trim().max(20, "Keep the tax code under 20 characters").optional(),
  customRate: z.boolean(),
});

type CatalogFormValues = z.input<typeof formSchema>;

type EditableItem = Omit<CatalogFormValues, "unitPrice" | "taxCode"> & {
  id: string;
  unitPrice: bigint;
  taxCode: string | null;
};

const EMPTY_VALUES: CatalogFormValues = {
  name: "",
  code: "",
  category: "consultation",
  unitPrice: "",
  taxRatePercent: "0",
  taxCode: "",
  customRate: false,
};

/** Creates an item, or edits `item` when given. */
export function CatalogItemDialog({
  orgSlug,
  item,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  item?: EditableItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useZodForm(formSchema, {
    defaultValues: item
      ? {
          name: item.name,
          code: item.code,
          category: item.category,
          unitPrice: formatDecimal(item.unitPrice),
          taxRatePercent: item.taxRatePercent,
          taxCode: item.taxCode ?? "",
          customRate: item.customRate,
        }
      : EMPTY_VALUES,
  });

  const close = () => {
    form.reset(item ? undefined : EMPTY_VALUES);
    onOpenChange(false);
  };

  const feedback = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      close();
    },
    onError: (error: Error) =>
      applyOrpcFieldError(form, error, {
        duplicate: { field: "code", message: "Code already in use" },
      }),
  });

  const create = useMutation(orpc.catalog.create.mutationOptions(feedback("Catalog item created")));
  const update = useMutation(orpc.catalog.update.mutationOptions(feedback("Catalog item updated")));

  const onSubmit = form.handleSubmit((values) => {
    const shared = { ...values, orgSlug, taxCode: values.taxCode || null };

    if (item) {
      update.mutate({ ...shared, itemId: item.id });
    } else {
      create.mutate(shared);
    }
  });

  const isPending = create.isPending || update.isPending;

  const changeOpen = (next: boolean) => {
    if (next) onOpenChange(true);
    else if (!isPending) close();
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{item ? "Edit catalog item" : "New catalog item"}</DialogTitle>
            {!item ? (
              <DialogDescription>
                Billable services appear in the organization's catalog
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="name" label="Name" autoFocus disabled={isPending} />
                <TextField name="code" label="Code" disabled={isPending} />
                <ControlledField
                  name="category"
                  label="Category"
                  render={(field) => (
                    <FormControl>
                      <NativeSelect {...field} disabled={isPending}>
                        {EDITABLE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                  )}
                />
                <TextField
                  name="unitPrice"
                  label="Unit price"
                  inputMode="decimal"
                  placeholder="150.00"
                  disabled={isPending}
                />
                <TextField
                  name="taxRatePercent"
                  label="Tax %"
                  inputMode="decimal"
                  placeholder="0"
                  disabled={isPending}
                />
                <TextField name="taxCode" label="Tax code (optional)" disabled={isPending} />
              </div>

              <FormField
                control={form.control}
                name="customRate"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormLabel>Rate set at intake (unit price is the default)</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => changeOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <SubmitButton isSubmitting={isPending}>
                  {item ? "Save changes" : "Create item"}
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
