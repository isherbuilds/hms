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

  const opd = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: { orgSlug, query, includeConsultation: services === "visit" },
    }),
    enabled: search.searching && services !== "any",
  });

  const any = useQuery({
    ...orpc.catalog.list.queryOptions({ input: { orgSlug, query, activeOnly: true } }),
    enabled: search.searching && services === "any",
  });

  const catalog = services === "any" ? any : opd;

  return {
    ...search,
    items: services === "any" ? (any.data?.items ?? []) : (opd.data ?? []),
    emptyMessage: searchEmptyMessage(search.searching, catalog, {
      noMatch,
      failed: "Could not search the catalog",
    }),
  };
}
