import { useQuery } from "@tanstack/react-query";

import { searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { orpc } from "@/lib/orpc";

/**
 * Debounced catalog lookup shared by intake services, treatment plan items and the
 * Admission bill. `visit` and `procedure` keep to OPD billable categories (a visit also
 * offers consultations); `any` is every active service, as an Admission accepts.
 */
export function useCatalogSearch({
  orgSlug,
  services,
  noMatch,
}: {
  orgSlug: string;
  services: "visit" | "procedure" | "any";
  /** Shown once a search returned nothing. */
  noMatch: string;
}) {
  const search = useSearchTerm();
  const query = search.term || undefined;

  const catalog = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: {
        orgSlug,
        query,
        includeConsultation: services !== "procedure",
        categories: services === "any" ? "all" : "opd",
      },
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
