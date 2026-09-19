import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import { useQuery } from "@tanstack/react-query";

import { SEARCH_RESULT_LIMIT, searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { orpc } from "@/lib/orpc";

export type PickedProduct = { productId: string; name: string; stockUnit: string };

/** Remote type-ahead over the product master; the caller keeps the selection. */
export function ProductPicker({
  orgSlug,
  value,
  onChange,
  disabled,
}: {
  orgSlug: string;
  value: { productId: string; name: string } | null;
  onChange: (product: PickedProduct | null) => void;
  disabled?: boolean;
}) {
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
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
        <span className="min-w-0 truncate">{value.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => {
            search.clear();
            onChange(null);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
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
        });
      }}
      open={search.open}
      onOpenChange={search.setOpen}
      disabled={disabled}
      inputProps={{
        "aria-label": "Product",
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
        emptyMessage ? <p className="px-3 py-2 text-muted-foreground">{emptyMessage}</p> : undefined
      }
    />
  );
}
