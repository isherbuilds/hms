import {
  DECIMAL_PATTERN,
  formatDecimal,
  parseDecimal,
} from "@hms/api/core/money";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
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
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CircleDotIcon, TagIcon } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
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
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

// Kept local so no @hms/db server module reaches the client bundle (hard rule 6).
// Medicines are written only from Pharmacy → Items, so the form never offers that
// category while the list still shows and filters by it.
const EDITABLE_CATEGORIES = [
  "consultation",
  "procedure",
  "lab",
  "radiology",
  "other",
] as const;

type EditableCategory = (typeof EDITABLE_CATEGORIES)[number];

const CATALOG_CATEGORIES = [...EDITABLE_CATEGORIES, "pharmacy"] as const;

type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  lab: "Lab",
  radiology: "Radiology",
  pharmacy: "Pharmacy",
  other: "Other",
};

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
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { catalog: ["update"] },
      "/$orgSlug/settings",
    );
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

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Keep the name under 200 characters"),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(20, "Keep the code under 20 characters"),
  category: z.enum(EDITABLE_CATEGORIES),
  unitPrice: z
    .string()
    .regex(DECIMAL_PATTERN, "Amount like 150 or 150.00")
    .transform(parseDecimal),
  taxRatePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 0, 5, or 12.50"),
  taxCode: z
    .string()
    .trim()
    .max(20, "Keep the tax code under 20 characters")
    .optional(),
  customRate: z.boolean(),
});

type CatalogFormValues = z.input<typeof formSchema>;

type CatalogItem = {
  id: string;
  name: string;
  code: string;
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

const EMPTY_VALUES: CatalogFormValues = {
  name: "",
  code: "",
  category: "consultation",
  unitPrice: "",
  taxRatePercent: "0",
  taxCode: "",
  customRate: false,
};

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
                    item.id === variables.itemId
                      ? { ...item, active: variables.active }
                      : item,
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
    (item: CatalogItem) =>
      mutateToggle({ orgSlug, itemId: item.id, active: !item.active }),
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

  const setFilters = (patch: {
    q?: string;
    category?: CatalogCategory;
    activeOnly?: true;
  }) =>
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
            placeholder="Code or name"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={TagIcon} label="Category">
                  {CATALOG_CATEGORIES.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={category === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({
                          category: checked ? candidate : undefined,
                        })
                      }
                    >
                      {CATEGORY_LABELS[candidate]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
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
                    <TableHead>Code</TableHead>
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
                      pending={
                        toggleActive.isPending &&
                        toggleActive.variables?.itemId === item.id
                      }
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
                  pending={
                    toggleActive.isPending &&
                    toggleActive.variables?.itemId === item.id
                  }
                  onToggle={toggleItem}
                  onEdit={setEditing}
                />
              ))}
            </ul>
          </ListState>
        </Panel>
      </PageBody>

      <CatalogItemDialog
        mode="create"
        orgSlug={orgSlug}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {editing ? (
        <CatalogItemDialog
          key={editing.id}
          mode="edit"
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
      <TableCell className="font-mono">{item.code}</TableCell>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatDecimal(item.unitPrice)}
        {item.customRate ? (
          <span className="text-muted-foreground"> default</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.taxRatePercent}
      </TableCell>
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
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onEdit({ ...item, category })}
          >
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
        <span className="min-w-0 wrap-break-words font-medium">
          {item.name}
        </span>
        <Badge variant={item.active ? "secondary" : "muted"}>
          {item.active ? "Active" : "Inactive"}
        </Badge>
      </div>
      <p className="mt-1 text-muted-foreground">
        <span className="font-mono">{item.code}</span> ·{" "}
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
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onEdit({ ...item, category })}
          >
            Edit
          </Button>
        )}
      </div>
    </li>
  );
});

type CatalogItemDialogProps =
  | {
      mode: "create";
      orgSlug: string;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
  | {
      mode: "edit";
      orgSlug: string;
      item: EditableCatalogItem;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };

function CatalogItemDialog(props: CatalogItemDialogProps) {
  const { mode, orgSlug, open, onOpenChange } = props;
  const item = mode === "edit" ? props.item : null;

  const form = useZodForm(formSchema, {
    defaultValues: item
      ? {
          name: item.name,
          code: item.code,
          category: item.category,
          unitPrice: formatDecimal(item.unitPrice),
          taxRatePercent: item.taxRatePercent,
          taxCode: item.taxCode ?? "",
          customRate: item.customRate,
        }
      : EMPTY_VALUES,
  });

  const closeAfterSuccess = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    form.reset(item ? undefined : EMPTY_VALUES);
  };

  const handleError = (error: Error) =>
    applyOrpcFieldError(form, error, {
      duplicate: { field: "code", message: "Code already in use" },
    });

  const create = useMutation(
    orpc.catalog.create.mutationOptions({
      onSuccess: () => closeAfterSuccess("Catalog item created"),
      onError: handleError,
    }),
  );

  const update = useMutation(
    orpc.catalog.update.mutationOptions({
      onSuccess: () => closeAfterSuccess("Catalog item updated"),
      onError: handleError,
    }),
  );

  const onSubmit = form.handleSubmit((values) => {
    const shared = {
      orgSlug,
      name: values.name,
      code: values.code,
      category: values.category,
      unitPrice: values.unitPrice,
      taxRatePercent: values.taxRatePercent,
      taxCode: values.taxCode || null,
      customRate: values.customRate,
    };

    if (item) {
      update.mutate({ ...shared, itemId: item.id });
    } else {
      create.mutate(shared);
    }
  });

  const isPending = create.isPending || update.isPending;

  const changeOpen = (next: boolean) => {
    if (!next && !isPending) {
      form.reset(item ? undefined : EMPTY_VALUES);
      onOpenChange(false);
    } else if (next) {
      onOpenChange(true);
    }
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {item ? "Edit catalog item" : "New catalog item"}
            </DialogTitle>
            {!item ? (
              <DialogDescription>
                Billable services appear in the organization's catalog
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <Form {...form}>
            <form
              noValidate
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  name="name"
                  label="Name"
                  autoFocus
                  disabled={isPending}
                />
                <TextField name="code" label="Code" disabled={isPending} />
                <RegisteredFormField
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={isPending}>
                          {EDITABLE_CATEGORIES.map((option) => (
                            <option key={option} value={option}>
                              {CATEGORY_LABELS[option]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <TextField
                  name="unitPrice"
                  label="Unit price"
                  inputMode="decimal"
                  placeholder="150.00"
                  disabled={isPending}
                />
                <TextField
                  name="taxRatePercent"
                  label="Tax %"
                  inputMode="decimal"
                  placeholder="0"
                  disabled={isPending}
                />
                <TextField
                  name="taxCode"
                  label="Tax code (optional)"
                  disabled={isPending}
                />
              </div>

              <FormField
                control={form.control}
                name="customRate"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormLabel>
                      Rate set at intake (unit price is the default)
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => changeOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <SubmitButton isSubmitting={isPending}>
                  {item ? "Save changes" : "Create item"}
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
