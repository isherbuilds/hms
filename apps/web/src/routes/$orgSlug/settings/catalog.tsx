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
import { Input } from "@hms/ui/components/input";
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
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  FilterGroup,
  FilterSelect,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { MONEY_INPUT_PATTERN } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

// Mirrors CATALOG_CATEGORIES in @hms/db, kept local so no server schema module
// reaches the client bundle (hard rule 6).
const CATALOG_CATEGORIES = ["consultation", "procedure", "lab", "radiology", "other"] as const;

type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  lab: "Lab",
  radiology: "Radiology",
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
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/settings/catalog")({
  head: () => ({ meta: [{ title: "Catalog · HMS" }] }),
  validateSearch: z.object({
    category: z.enum(CATALOG_CATEGORIES).optional().catch(undefined),
    activeOnly: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ category: search.category, activeOnly: search.activeOnly }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    // Reading the catalog is org-wide; this page only edits it, so the tab strip gates
    // it on `update` too.
    await requireOrgPermission(queryClient, orgSlug, { catalog: ["update"] }, "/$orgSlug/settings");
    await queryClient
      .infiniteQuery(
        catalogListQuery(orgSlug, {
          query: "",
          category: deps.category,
          activeOnly: deps.activeOnly ?? false,
        }),
      )
      .catch(() => {});
  },
  component: CatalogRoute,
});

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Keep the name under 200 characters"),
  code: z.string().trim().min(1, "Code is required").max(20, "Keep the code under 20 characters"),
  category: z.enum(CATALOG_CATEGORIES),
  unitPrice: z.string().regex(MONEY_INPUT_PATTERN, "Amount like 150 or 150.00"),
  taxRatePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 0, 5, or 12.50"),
  taxCode: z.string().trim().max(20, "Keep the tax code under 20 characters").optional(),
  active: z.boolean(),
});

type CatalogFormValues = z.infer<typeof formSchema>;
type CatalogItem = {
  id: string;
  name: string;
  code: string;
  category: CatalogCategory;
  unitPrice: string;
  taxRatePercent: string;
  taxCode: string | null;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const EMPTY_VALUES: CatalogFormValues = {
  name: "",
  code: "",
  category: "consultation",
  unitPrice: "",
  taxRatePercent: "0",
  taxCode: "",
  active: true,
};

function CatalogRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  // Filters live in the URL, so a filtered view is shareable and Back restores it.
  const { category, activeOnly } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const toggleActive = useMutation(
    orpc.catalog.update.mutationOptions({
      onMutate: async (variables) => {
        const queryKey = orpc.catalog.list.key({ input: { orgSlug }, type: "infinite" });
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
      onError: (error, _variables, context) => {
        for (const [queryKey, data] of context?.snapshot ?? []) {
          queryClient.setQueryData(queryKey, data);
        }
        toast.error(errorMessage(error, "Could not update catalog item"));
      },
      onSettled: () => {
        // The settling mutation still counts as pending, so >1 means a sibling update is in
        // flight and refetching now would overwrite its optimistic patch.
        const pending = queryClient.isMutating({
          mutationKey: orpc.catalog.update.mutationKey(),
        });
        if (pending > 1) return;
        return queryClient.invalidateQueries({
          queryKey: orpc.catalog.list.key({ input: { orgSlug } }),
        });
      },
    }),
  );
  const mutateToggle = toggleActive.mutate;
  const toggleItem = useCallback(
    (item: CatalogItem) =>
      mutateToggle({
        orgSlug,
        itemId: item.id,
        name: item.name,
        code: item.code,
        category: item.category,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
        active: !item.active,
      }),
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

  return (
    <>
      <PageHeader
        title="Service catalog"
        description="Manage billable services, prices, and tax details"
        action={<Button onClick={() => setCreateOpen(true)}>New item</Button>}
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search catalog"
            placeholder="Search code or name"
            onQueryChange={setQuery}
          />
          {/* A select, not a toggle group: categories are data, not a fixed set. */}
          <FilterSelect<"all" | CatalogCategory>
            label="Category"
            value={category ?? "all"}
            options={[
              { value: "all", label: "All categories" },
              ...CATALOG_CATEGORIES.map((value) => ({
                value,
                label: CATEGORY_LABELS[value],
              })),
            ]}
            onValueChange={(next) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  category: next === "all" ? undefined : next,
                }),
                replace: true,
              });
            }}
          />
          <FilterGroup<"all" | "active">
            label="Status"
            value={activeOnly ? "active" : "all"}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
            ]}
            onValueChange={(next) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  activeOnly: next === "active" ? true : undefined,
                }),
                replace: true,
              });
            }}
          />
        </ListToolbar>

        <Panel label="Items" footer={<LoadMore query={catalog} shown={items.length} />}>
          <ListState
            query={catalog}
            errorTitle="Could not load service catalog"
            isEmpty={items.length === 0}
            empty={
              query
                ? "No catalog items match this search."
                : category || activeOnly
                  ? "No catalog items match these filters."
                  : "No catalog items yet."
            }
          >
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
                    pending={toggleActive.isPending && toggleActive.variables?.itemId === item.id}
                    onToggle={toggleItem}
                    onEdit={setEditing}
                  />
                ))}
              </TableBody>
            </Table>
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

/** Memoized so an optimistic toggle re-renders one row, not the whole catalog. */
const CatalogRow = memo(function CatalogRow({
  item,
  pending,
  onToggle,
  onEdit,
}: {
  item: CatalogItem;
  pending: boolean;
  onToggle: (item: CatalogItem) => void;
  onEdit: (item: CatalogItem) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono">{item.code}</TableCell>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
      <TableCell className="text-right tabular-nums">{item.unitPrice}</TableCell>
      <TableCell className="text-right tabular-nums">{item.taxRatePercent}</TableCell>
      <TableCell className="font-mono">{item.taxCode || "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={item.active}
            disabled={pending}
            aria-label={`Set ${item.name} ${item.active ? "inactive" : "active"}`}
            onCheckedChange={() => onToggle(item)}
          />
          <Badge variant={item.active ? "secondary" : "muted"}>
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="xs" onClick={() => onEdit(item)}>
          Edit
        </Button>
      </TableCell>
    </TableRow>
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
      item: CatalogItem;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };

function CatalogItemDialog(props: CatalogItemDialogProps) {
  const { mode, orgSlug, open, onOpenChange } = props;
  const queryClient = useQueryClient();
  const item = mode === "edit" ? props.item : null;
  const form = useZodForm(formSchema, {
    defaultValues: item
      ? {
          name: item.name,
          code: item.code,
          category: item.category,
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          taxCode: item.taxCode ?? "",
          active: item.active,
        }
      : EMPTY_VALUES,
  });

  // Awaiting the refetch keeps the mutation pending, so the dialog closes onto a list
  // that is already correct.
  const closeAfterSuccess = async (message: string) => {
    await queryClient.invalidateQueries({
      queryKey: orpc.catalog.list.key({ input: { orgSlug } }),
    });
    toast.success(message);
    onOpenChange(false);
    form.reset(item ? undefined : EMPTY_VALUES);
  };

  const handleError = (error: unknown) => {
    const mapped = applyOrpcFieldError(form, error, {
      duplicate: { field: "code", message: "Code already in use" },
    });
    toast.error(mapped ?? errorMessage(error, "Could not save catalog item"));
  };

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
    };

    if (item) {
      update.mutate({ ...shared, itemId: item.id, active: values.active });
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
            <DialogTitle>{item ? "Edit catalog item" : "New catalog item"}</DialogTitle>
            <DialogDescription>
              {item
                ? "Update pricing, tax details, or whether this item is available."
                : "Add a billable service to this organization's catalog."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <RegisteredFormField
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={isPending}>
                          {CATALOG_CATEGORIES.map((option) => (
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
                <RegisteredFormField
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit price</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="150.00"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="taxRatePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax %</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="taxCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax code (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {item ? (
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormLabel>Active</FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

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
