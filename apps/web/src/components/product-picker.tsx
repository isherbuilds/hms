import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef } from "react";

import { SEARCH_RESULT_LIMIT, searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { orpc } from "@/lib/orpc";

export type PickedProduct = {
  productId: string;
  name: string;
  stockUnit: string;
  /** How many stock units a pack holds, so a caller can count in packs.  */
  unitsPerPack: number;
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

/** Remote type-ahead over the product master; the caller keeps the selection. */
export function ProductPicker({
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

  if (value) {
    return (
      <ClientOnly
        fallback={
          <Input
            id={id}
            value={value.name}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={ariaLabel}
            disabled
            readOnly
          />
        }
      >
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full min-w-0 justify-between font-normal"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            search.clear();
            onChange(null);
          }}
        >
          <span className="min-w-0 truncate">{value.name}</span>
          <span className="text-muted-foreground">Change</span>
        </Button>
      </ClientOnly>
    );
  }

  return (
    <ClientOnly
      fallback={
        <Input
          id={id}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          placeholder="Search product"
          disabled
        />
      }
    >
      <Combobox
        items={matches}
        getItemKey={(match) => match.productId}
        getItemLabel={(match) => match.name}
        onInputValueChange={search.onInputValueChange}
        onSelect={(match) => {
          search.clear();
          onChange({
            productId: match.productId,
            name: match.name,
            stockUnit: match.stockUnit,
            unitsPerPack: match.unitsPerPack,
            taxRatePercent: match.taxRatePercent,
            taxCode: match.taxCode,
          });
        }}
        open={search.open}
        onOpenChange={search.setOpen}
        disabled={disabled}
        inputProps={{
          id,
          "aria-describedby": ariaDescribedBy,
          "aria-invalid": ariaInvalid,
          "aria-label": ariaLabel,
          placeholder: "Search product",
          autoComplete: "off",
        }}
        itemClassName="px-3 py-2"
        renderItem={(match) => (
          <span className="min-w-0 truncate">
            {match.name} <span className="text-muted-foreground">· {match.code ?? "Internal"}</span>
          </span>
        )}
        emptyContent={
          emptyMessage ? (
            <p className="px-3 py-2 text-muted-foreground">{emptyMessage}</p>
          ) : undefined
        }
      />
    </ClientOnly>
  );
}
