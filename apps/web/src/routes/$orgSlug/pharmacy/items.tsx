import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { appHead } from "@/config/site";
import { ProductSheet } from "@/components/product-sheet";
import {
  DataList,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { orpc } from "@/lib/orpc";
import { SCHEDULE_LABELS } from "@/lib/pharmacy-labels";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

const productListQuery = (orgSlug: string, query: string) =>
  orpc.pharmacy.listProducts.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/items")({
  head: () => appHead("Products"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { pharmacy: ["manageItems"] },
      "/$orgSlug/dashboard",
    );
    await queryClient.infiniteQuery(productListQuery(orgSlug, "")).catch(() => {});
  },
  component: PharmacyItemsRoute,
});

/** One row of the product master. */
type Product = Awaited<ReturnType<typeof orpc.pharmacy.listProducts.call>>["items"][number];

function PharmacyItemsRoute() {
  const { orgSlug } = Route.useParams();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const products = useInfiniteQuery(productListQuery(orgSlug, query));
  const items = products.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Products"
        action={<Button onClick={() => setCreating(true)}>Add product</Button>}
      />
      <PharmacyTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search products"
            placeholder="Name or generic"
            onQueryChange={setQuery}
          />
        </ListToolbar>

        <Panel grow footer={<LoadMore query={products} shown={items.length} />}>
          <ListState
            query={products}
            errorTitle="Could not load products"
            isEmpty={items.length === 0}
            empty={query ? "No matching products" : "No products yet"}
          >
            <DataList
              columns={[
                { head: "Name", cell: (item) => item.name, mobile: "title" },
                { head: "Generic", cell: (item) => item.genericName || "—" },
                {
                  head: "Form",
                  cell: (item) => [item.form, item.strength].filter(Boolean).join(" ") || "—",
                },
                {
                  head: "Unit × pack",
                  cell: (item) => (
                    <span className="tabular-nums">
                      {item.stockUnit} × {item.unitsPerPack}
                      {item.pack ? ` · ${item.pack}` : ""}
                    </span>
                  ),
                },
                { head: "Prescription", cell: (item) => SCHEDULE_LABELS[item.schedule] },
                {
                  head: "GST %",
                  cell: (item) => (
                    <span className="tabular-nums">{item.taxRatePercent ?? "—"}</span>
                  ),
                  className: "text-right",
                },
                {
                  head: "HSN",
                  cell: (item) => <span className="font-mono">{item.taxCode || "—"}</span>,
                },
                {
                  head: "Status",
                  cell: (item) => (
                    <span className="flex flex-wrap gap-1">
                      {!item.sold ? <Badge variant="muted">Internal</Badge> : null}
                      {!item.active ? <Badge variant="muted">Inactive</Badge> : null}
                      {item.sold && item.active ? <Badge variant="secondary">Active</Badge> : null}
                    </span>
                  ),
                  mobile: "title",
                },
              ]}
              rows={items}
              rowKey={(item) => item.productId}
              action={(item) => (
                <Button variant="ghost" size="xs" onClick={() => setEditing(item)}>
                  Edit
                </Button>
              )}
            />
          </ListState>
        </Panel>
      </PageBody>

      {creating ? <ProductSheet orgSlug={orgSlug} onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <ProductSheet
          key={editing.productId}
          orgSlug={orgSlug}
          product={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
