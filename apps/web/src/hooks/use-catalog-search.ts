import { useQuery } from "@tanstack/react-query";

import { searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { orpc } from "@/lib/orpc";

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
  const search = useSearchTerm();

  const catalog = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: { orgSlug, query: search.term || undefined, includeConsultation },
    }),
    enabled: search.searching,
  });

  return {
    ...search,
    items: catalog.data ?? [],
    emptyMessage: searchEmptyMessage(search.searching, catalog, {
      noMatch,
      failed: "Could not search the catalog",
    }),
  };
}
