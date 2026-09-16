import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

/** Debounced catalog lookup shared by intake services and treatment plan items. */
export function useCatalogSearch({
  orgSlug,
  includeConsultation,
  noMatch,
}: {
  orgSlug: string;
  includeConsultation: boolean;
  /** Shown once a search returned nothing. */
  noMatch: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const settle = useDebouncedCallback(setQuery, 250);
  const searching = query.length > 0;

  const catalog = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: { orgSlug, query: query || undefined, includeConsultation },
    }),
    enabled: searching,
  });

  return {
    items: catalog.data ?? [],
    // Never a popup over an empty field: there is nothing to match yet.
    open: open && searching,
    setOpen,
    onInputValueChange: (value: string) => settle(value.trim()),
    clear: () => {
      setQuery("");
      setOpen(false);
    },
    emptyMessage: !searching
      ? null
      : catalog.isError
        ? errorMessage(catalog.error, "Could not search the catalog")
        : catalog.isPending
          ? "Searching…"
          : noMatch,
  };
}
