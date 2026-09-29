import { Combobox, ComboboxInput, ComboboxPopup } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { memo, useState, type ComponentPropsWithoutRef } from "react";

import { SEARCH_RESULT_LIMIT, searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { orpc } from "@/lib/orpc";

export type PickedProduct = {
  productId: string;
  name: string;
  stockUnit: string;
  unitsPerPack: number;
  expires: boolean;
  pack: string | null;
  /** The counter's GST rate and HSN code; null for an internal supply. */
  taxRatePercent: string | null;
  taxCode: string | null;
};

type ProductPickerProps = {
  orgSlug: string;
  value: { productId: string; name: string } | null;
  onChange: (product: PickedProduct | null) => void;
  disabled?: boolean;
} & Pick<
  ComponentPropsWithoutRef<"input">,
  "id" | "aria-describedby" | "aria-invalid" | "aria-label"
>;

/**
 * Remote type-ahead over the product master; the caller keeps the selection. Memoized:
 * it sits in a Controller render prop, which re-runs on every form change.
 */
export const ProductPicker = memo(function ProductPicker({
  orgSlug,
  value,
  onChange,
  disabled,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: ProductPickerProps) {
  const search = useSearchTerm(300);
  const [inputValue, setInputValue] = useState("");

  const results = useQuery({
    ...orpc.pharmacy.listProducts.queryOptions({
      input: { orgSlug, query: search.term, limit: SEARCH_RESULT_LIMIT },
    }),
    enabled: !value && search.searching,
  });

  const matches = results.data?.items ?? [];

  const emptyMessage = searchEmptyMessage(search.searching, results, {
    noMatch: "No product matches",
    failed: "Could not search products",
  });

  return (
    <ClientOnly
      fallback={
        <Input
          id={id}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          placeholder="Product name"
          value={value?.name ?? ""}
          disabled
          readOnly
        />
      }
    >
      <Combobox
        items={matches}
        filteredItems={matches}
        value={value}
        inputValue={value?.name ?? inputValue}
        isItemEqualToValue={(a, b) => a.productId === b.productId}
        itemToStringLabel={(match) => match.name}
        onInputValueChange={(input, { reason }) => {
          if (reason !== "input-change") return;

          setInputValue(input);

          if (value && input !== value.name) onChange(null);

          search.onInputValueChange(input);
        }}
        onValueChange={(selected) => {
          if (!selected) {
            onChange(null);

            return;
          }

          const match = matches.find((item) => item.productId === selected.productId);

          if (!match) return;

          setInputValue("");
          search.clear();
          onChange({
            productId: match.productId,
            name: match.name,
            stockUnit: match.stockUnit,
            unitsPerPack: match.unitsPerPack,
            expires: match.expires,
            pack: match.pack,
            taxRatePercent: match.sold ? match.taxRatePercent : null,
            taxCode: match.sold ? match.taxCode : null,
          });
        }}
        open={search.open}
        onOpenChange={search.setOpen}
        disabled={disabled}
        loopFocus
      >
        <ComboboxInput
          id={id}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          placeholder="Product name"
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.currentTarget.value) event.preventDefault();
          }}
        />
        <ComboboxPopup
          getItemKey={(match: (typeof matches)[number]) => match.productId}
          itemClassName="px-3 py-2"
          renderItem={(match: (typeof matches)[number]) => (
            <span className="min-w-0 truncate">
              {match.name}
              {match.pack ? <span className="text-muted-foreground"> · {match.pack}</span> : null}
              {!match.sold && <span className="text-muted-foreground"> · Internal</span>}
            </span>
          )}
          emptyContent={
            emptyMessage ? (
              <p className="px-3 py-2 text-muted-foreground">{emptyMessage}</p>
            ) : undefined
          }
        />
      </Combobox>
    </ClientOnly>
  );
});
