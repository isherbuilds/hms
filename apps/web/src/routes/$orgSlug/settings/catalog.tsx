import { formatDecimal } from "@hms/api/core/money";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleDotIcon, TagIcon } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { z } from "zod";

import {
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
  CatalogItemDialog,
  type CatalogCategory,
  type EditableCategory,
} from "@/components/catalog-item-dialog";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  OptionFilter,
  type ActiveFilter,
} from "@/components/list-filter";
import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

const catalogListQuery = (
  orgSlug: string,
  filters: { query: string; category?: CatalogCategory; activeOnly: boolean },
) =>
  orpc.catalog.list.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      query: filters.query || undefined,
      category: filters.category,
      activeOnly: filters.activeOnly,
      cursor,
      limit: 25,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/settings/catalog")({
  head: () => ({ meta: [{ title: "Catalog · HMS" }] }),
  validateSearch: z.object({
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    category: z.enum(CATALOG_CATEGORIES).optional().catch(undefined),
    activeOnly: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    category: search.category,
    activeOnly: search.activeOnly,
  }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { catalog: ["update"] }, "/$orgSlug/settings");
    await queryClient
      .infiniteQuery(
        catalogListQuery(orgSlug, {
          query: deps.q ?? "",
          category: deps.category,
          activeOnly: deps.activeOnly ?? false,
        }),
      )
      .catch(() => {});
  },
  component: CatalogRoute,
});

type CatalogItem = {
  id: string;
  name: string;
  category: CatalogCategory;
  unitPrice: bigint;
  taxRatePercent: string;
  taxCode: string | null;
  customRate: boolean;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EditableCatalogItem = CatalogItem & { category: EditableCategory };

function CatalogRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const { q, category, activeOnly } = Route.useSearch();
  const navigate = Route.useNavigate();
  const field = useRef<HTMLDivElement>(null);
  const query = q ?? "";
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCatalogItem | null>(null);

  const toggleActive = useMutation(
    orpc.catalog.setActive.mutationOptions({
      onMutate: async (variables) => {
        const queryKey = orpc.catalog.list.key({
          input: { orgSlug },
          type: "infinite",
        });

        await queryClient.cancelQueries({ queryKey });

        const snapshot = queryClient.getQueriesData<
          InfiniteData<{
            items: CatalogItem[];
            nextCursor: { name: string; id: string } | null;
          }>
        >({ queryKey });

        queryClient.setQueriesData<
          InfiniteData<{
            items: CatalogItem[];
            nextCursor: { name: string; id: string } | null;
          }>
        >({ queryKey }, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.id === variables.itemId ? { ...item, active: variables.active } : item,
                  ),
                })),
              }
            : data,
        );

        return { snapshot };
      },
      onError: (_error, _variables, context) => {
        for (const [queryKey, data] of context?.snapshot ?? []) {
          queryClient.setQueryData(queryKey, data);
        }
      },
    }),
  );

  const mutateToggle = toggleActive.mutate;

  // A stable callback keeps the memoized rows out of unrelated status toggles.
  const toggleItem = useCallback(
    (item: CatalogItem) => mutateToggle({ orgSlug, itemId: item.id, active: !item.active }),
    [mutateToggle, orgSlug],
  );

  const catalog = useInfiniteQuery(
    catalogListQuery(orgSlug, {
      query,
      category,
      activeOnly: activeOnly ?? false,
    }),
  );

  const items = catalog.data?.pages.flatMap((page) => page.items) ?? [];

  const setFilters = (patch: { q?: string; category?: CatalogCategory; activeOnly?: true }) =>
    navigate({
      replace: true,
      search: (previous) => ({ ...previous, ...patch }),
    });

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({
      q: undefined,
      category: undefined,
      activeOnly: undefined,
    });
  };

  const chips: ActiveFilter[] = [];

  if (category)
    chips.push({
      id: "category",
      name: "Category",
      label: CATEGORY_LABELS[category],
      remove: () => setFilters({ category: undefined }),
    });

  if (activeOnly)
    chips.push({
      id: "activeOnly",
      name: "Status",
      label: "Active only",
      remove: () => setFilters({ activeOnly: undefined }),
    });

  return (
    <>
      <PageHeader
        title="Service catalog"
        action={<Button onClick={() => setCreateOpen(true)}>New item</Button>}
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search catalog"
            placeholder="Name"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <OptionFilter
                  icon={TagIcon}
                  label="Category"
                  options={CATALOG_CATEGORIES}
                  labels={CATEGORY_LABELS}
                  value={category}
                  onChange={(next) => void setFilters({ category: next })}
                />
                <FilterSubmenu icon={CircleDotIcon} label="Status">
                  <DropdownMenuCheckboxItem
                    checked={activeOnly === true}
                    onCheckedChange={(checked) =>
                      void setFilters({
                        activeOnly: checked ? true : undefined,
                      })
                    }
                  >
                    Active only
                  </DropdownMenuCheckboxItem>
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <Panel grow footer={<LoadMore query={catalog} shown={items.length} />}>
          <ListState
            query={catalog}
            errorTitle="Could not load service catalog"
            isEmpty={items.length === 0}
            empty={
              query
                ? "No matching catalog items"
                : category || activeOnly
                  ? "No catalog items match these filters"
                  : "No catalog items yet"
            }
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Tax %</TableHead>
                    <TableHead>Tax code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <CatalogRow
                      key={item.id}
                      item={item}
                      pending={toggleActive.isPending && toggleActive.variables?.itemId === item.id}
                      onToggle={toggleItem}
                      onEdit={setEditing}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="md:hidden">
              {items.map((item) => (
                <CatalogMobileRow
                  key={item.id}
                  item={item}
                  pending={toggleActive.isPending && toggleActive.variables?.itemId === item.id}
                  onToggle={toggleItem}
                  onEdit={setEditing}
                />
              ))}
            </ul>
          </ListState>
        </Panel>
      </PageBody>

      <CatalogItemDialog orgSlug={orgSlug} open={createOpen} onOpenChange={setCreateOpen} />
      {editing ? (
        <CatalogItemDialog
          key={editing.id}
          orgSlug={orgSlug}
          item={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

const CatalogRow = memo(function CatalogRow({
  item,
  pending,
  onToggle,
  onEdit,
}: {
  item: CatalogItem;
  pending: boolean;
  onToggle: (item: CatalogItem) => void;
  onEdit: (item: EditableCatalogItem) => void;
}) {
  // A const narrows inside the click closure; `item.category` would not.
  const category = item.category;

  return (
    <TableRow>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatDecimal(item.unitPrice)}
        {item.customRate ? <span className="text-muted-foreground"> default</span> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{item.taxRatePercent}</TableCell>
      <TableCell className="font-mono">{item.taxCode || "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={item.active}
            disabled={pending || item.category === "pharmacy"}
            aria-label={`Set ${item.name} ${item.active ? "inactive" : "active"}`}
            onCheckedChange={() => onToggle(item)}
          />
          <Badge variant={item.active ? "secondary" : "muted"}>
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right">
        {category === "pharmacy" ? (
          <span className="text-muted-foreground">Pharmacy → Items</span>
        ) : (
          <Button variant="ghost" size="xs" onClick={() => onEdit({ ...item, category })}>
            Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
});

const CatalogMobileRow = memo(function CatalogMobileRow({
  item,
  pending,
  onToggle,
  onEdit,
}: {
  item: CatalogItem;
  pending: boolean;
  onToggle: (item: CatalogItem) => void;
  onEdit: (item: EditableCatalogItem) => void;
}) {
  const category = item.category;

  return (
    <li className="border-b px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 wrap-break-words font-medium">{item.name}</span>
        <Badge variant={item.active ? "secondary" : "muted"}>
          {item.active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <p className="mt-1 text-muted-foreground">
        {CATEGORY_LABELS[category]} ·{" "}
        <span className="tabular-nums">{formatDecimal(item.unitPrice)}</span>
        {item.customRate ? " default" : null} · Tax {item.taxRatePercent}% ·{" "}
        <span className="font-mono">{item.taxCode || "—"}</span>
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Checkbox
          checked={item.active}
          disabled={pending || category === "pharmacy"}
          aria-label={`Set ${item.name} ${item.active ? "inactive" : "active"}`}
          onCheckedChange={() => onToggle(item)}
        />
        {category === "pharmacy" ? (
          <span className="text-muted-foreground">Pharmacy → Items</span>
        ) : (
          <Button variant="ghost" size="xs" onClick={() => onEdit({ ...item, category })}>
            Edit
          </Button>
        )}
      </div>
    </li>
  );
});
