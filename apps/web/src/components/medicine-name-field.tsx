import { Autocomplete } from "@hms/ui/components/autocomplete";
import { FormControl, FormDescription } from "@hms/ui/components/form";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useFormContext, type ControllerRenderProps, type FieldValues } from "react-hook-form";

import { ControlledField } from "@/components/form-fields";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SEARCH_RESULT_LIMIT, searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { searchMedicines, type MedicineSuggestion } from "@/lib/medicine-suggestions";
import { orpc } from "@/lib/orpc";

type MedicineFields = {
  name: string;
  strength: string;
  form: string;
  manufacturer: string;
  unitsPerPack: string;
};

type SuggestedAttributes = {
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  unitsPerPack: number | null;
};

type PickedAttributes = Pick<MedicineFields, "strength" | "form" | "manufacturer" | "unitsPerPack">;

/** Only replace defaults and values still owned by the previous suggestion. */
export function mergeMedicineSuggestion(
  current: PickedAttributes,
  previous: Partial<PickedAttributes>,
  suggestion: SuggestedAttributes,
  existingProduct: boolean,
  packEdited = false,
): Partial<PickedAttributes> {
  const next: Partial<PickedAttributes> = {};

  for (const key of ["strength", "form", "manufacturer"] as const) {
    if (current[key] === "" || current[key] === previous[key]) {
      next[key] = suggestion[key] ?? "";
    }
  }

  if (
    !existingProduct &&
    !packEdited &&
    suggestion.unitsPerPack != null &&
    (current.unitsPerPack === "1" || current.unitsPerPack === previous.unitsPerPack)
  ) {
    next.unitsPerPack = String(suggestion.unitsPerPack);
  }

  return next;
}

/** Suggestions assist entry; they do not replace the user's editable product name. */
export function MedicineNameField({
  orgSlug,
  label,
  description,
  productId,
}: {
  orgSlug: string;
  label: string;
  description?: string;
  productId?: string;
}) {
  return (
    <ControlledField
      name="name"
      label={label}
      render={(field) => (
        <FormControl>
          <MedicineNameInput
            field={field}
            orgSlug={orgSlug}
            productId={productId}
            description={description}
          />
        </FormControl>
      )}
    />
  );
}

function MedicineNameInput({
  field,
  orgSlug,
  productId,
  description,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  field: ControllerRenderProps<FieldValues, string>;
  orgSlug: string;
  productId?: string;
  description?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const form = useFormContext<MedicineFields>();
  const previousPick = useRef<Partial<PickedAttributes>>({});
  const search = useSearchTerm(250, 3);

  const q = search.term.slice(0, 60);

  const suggestions = useQuery({
    queryKey: ["medicine-suggestions", q],
    queryFn: ({ signal }) => searchMedicines(q, signal),
    enabled: search.searching,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  // Keyed off the value, not the search, so a picked suggestion is checked too (D046: warn only).
  const name = useDebouncedValue(field.value.trim().replace(/\s+/g, " "), 250);

  const existing = useQuery({
    ...orpc.pharmacy.listProducts.queryOptions({
      input: { orgSlug, query: name.slice(0, 100), limit: SEARCH_RESULT_LIMIT },
    }),
    enabled: name.length >= 3,
    staleTime: 60 * 1000,
  });

  const duplicate = existing.data?.items.find(
    (product) =>
      product.productId !== productId && product.name.toLowerCase() === name.toLowerCase(),
  );

  const pick = (suggestion: MedicineSuggestion) => {
    field.onChange(suggestion.name);

    const current = form.getValues();

    const next = mergeMedicineSuggestion(
      current,
      previousPick.current,
      suggestion,
      !!productId,
      form.getFieldState("unitsPerPack").isDirty,
    );

    for (const key of ["strength", "form", "manufacturer", "unitsPerPack"] as const) {
      const value = next[key];

      if (value !== undefined && value !== current[key]) {
        form.setValue(key, value, { shouldDirty: key !== "unitsPerPack", shouldValidate: true });
      }
    }

    previousPick.current = next;

    search.clear();
  };

  const emptyMessage = searchEmptyMessage(search.searching, suggestions, {
    noMatch: "No suggestions",
    failed: "Suggestions unavailable",
  });

  return (
    <>
      <Autocomplete
        items={search.searching && suggestions.isSuccess ? suggestions.data : []}
        getItemKey={(item) => item.name}
        getItemLabel={(item) => item.name}
        renderItem={(item) => (
          <span className="min-w-0">
            <span className="block truncate">{item.name}</span>
            <span className="block truncate text-muted-foreground">
              {[item.strength, item.packSizeLabel, item.manufacturer].filter(Boolean).join(" · ")}
            </span>
          </span>
        )}
        value={field.value}
        inputRef={field.ref}
        inputProps={{
          id,
          "aria-describedby": ariaDescribedBy,
          "aria-invalid": ariaInvalid,
          name: field.name,
          onBlur: field.onBlur,
          autoComplete: "off",
        }}
        onValueChange={(value) => {
          field.onChange(value);
          search.onInputValueChange(value);
        }}
        onSelect={pick}
        open={search.open}
        onOpenChange={search.setOpen}
        emptyContent={
          emptyMessage ? (
            <p className="px-3 py-2 text-muted-foreground">{emptyMessage}</p>
          ) : undefined
        }
      />
      {description || (duplicate && !existing.isFetching) ? (
        <FormDescription>
          {description}
          {duplicate && !existing.isFetching ? (
            <span className="block">A product named {duplicate.name} already exists</span>
          ) : null}
        </FormDescription>
      ) : null}
    </>
  );
}
