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
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { Skeleton } from "@hms/ui/components/skeleton";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/settings/catalog")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchQuery(orpc.catalog.list.queryOptions({ input: { orgSlug } }));
  },
  component: CatalogRoute,
});

const SELECT_CLASS =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30";

// Mirrors CATALOG_CATEGORIES in @hms/db/schema/catalog-items, kept
// local so no server schema module reaches the client bundle (hard rule 6).
const CATALOG_CATEGORIES = ["consultation", "procedure", "lab", "radiology", "other"] as const;

type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  lab: "Lab",
  radiology: "Radiology",
  other: "Other",
};

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Keep the name under 200 characters"),
  code: z.string().trim().min(1, "Code is required").max(20, "Keep the code under 20 characters"),
  category: z.enum(CATALOG_CATEGORIES),
  unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Amount like 150 or 150.00"),
  taxRatePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 0, 5, or 12.50"),
  taxCode: z.string().trim().max(20, "Keep the tax code under 20 characters").optional(),
  active: z.boolean(),
});

type CatalogFormValues = z.infer<typeof formSchema>;
/** Row shape returned by catalog.list/create/update, mirrored structurally like staff.tsx. */
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

function isConflictError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "CONFLICT") return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

function CatalogRoute() {
  const { orgSlug } = Route.useParams();
  const [category, setCategory] = useState<CatalogCategory | "">("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const catalog = useQuery(
    orpc.catalog.list.queryOptions({
      input: {
        orgSlug,
        category: category || undefined,
        activeOnly,
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Service catalog"
        description="Manage billable services, prices, and tax details"
        action={<Button onClick={() => setCreateOpen(true)}>New item</Button>}
      />

      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-48 flex-col gap-1.5 text-xs font-medium">
            Category
            <select
              className={SELECT_CLASS}
              value={category}
              onChange={(event) => setCategory(event.target.value as CatalogCategory | "")}
            >
              <option value="">All categories</option>
              {CATALOG_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-8 items-center gap-2 text-xs font-medium">
            <Checkbox checked={activeOnly} onCheckedChange={setActiveOnly} />
            Active only
          </label>
        </div>

        {catalog.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        ) : catalog.isError ? (
          <ErrorNote title="Could not load service catalog" detail={catalog.error.message} />
        ) : catalog.data.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            {category || activeOnly
              ? "No catalog items match these filters."
              : "No catalog items yet."}
          </div>
        ) : (
          <div className="ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit price</TableHead>
                  <TableHead>Tax %</TableHead>
                  <TableHead>Tax code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
                    <TableCell>{item.unitPrice}</TableCell>
                    <TableCell>{item.taxRatePercent}</TableCell>
                    <TableCell>{item.taxCode || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={item.active ? "secondary" : "muted"}>
                        {item.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="xs" onClick={() => setEditing(item)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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

  const closeAfterSuccess = (message: string) => {
    void queryClient.invalidateQueries({
      queryKey: orpc.catalog.list.key({ input: { orgSlug } }),
    });
    toast.success(message);
    onOpenChange(false);
    form.reset(item ? undefined : EMPTY_VALUES);
  };

  const handleError = (error: unknown) => {
    if (isConflictError(error)) {
      form.setError("code", { message: "Code already in use" });
      toast.error("Code already in use");
      return;
    }
    toast.error(error instanceof Error ? error.message : "Could not save catalog item");
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
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
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
              <FormField
                control={form.control}
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
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <select
                        className={SELECT_CLASS}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        disabled={isPending}
                      >
                        {CATALOG_CATEGORIES.map((option) => (
                          <option key={option} value={option}>
                            {CATEGORY_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
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
              <FormField
                control={form.control}
                name="taxRatePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tax %</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" placeholder="0" disabled={isPending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
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
  );
}
