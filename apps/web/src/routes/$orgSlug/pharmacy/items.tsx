import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Watch, useFormContext } from "react-hook-form";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { ControlledField, TextField } from "@/components/form-fields";
import { MedicineNameField } from "@/components/medicine-name-field";
import { productTaxCode, validateSoldProduct } from "@/components/pharmacy-new-product-sheet";
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
import { numberText } from "@/lib/form-schema";
import { orpc } from "@/lib/orpc";
import { SCHEDULE_LABELS, SCHEDULES, STOCK_UNITS } from "@/lib/pharmacy-labels";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

const productListQuery = (orgSlug: string, query: string) =>
  orpc.pharmacy.listProducts.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/items")({
  head: () => ({ meta: [{ title: "Products · HMS" }] }),
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

/** One row of the product master; a null `code` marks an internal supply. */
type Product = Awaited<ReturnType<typeof orpc.pharmacy.listProducts.call>>["items"][number];

const productSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    genericName: z.string().trim().max(200),
    form: z.string().trim().max(50),
    strength: z.string().trim().max(50),
    stockUnit: z.enum(STOCK_UNITS),
    unitsPerPack: numberText(z.number().int().min(1, "At least 1 per pack")),
    schedule: z.enum(SCHEDULES),
    manufacturer: z.string().trim().max(200),
    sold: z.boolean(),
    code: z.string().trim().max(20),
    taxRatePercent: z.string().trim(),
    taxCode: productTaxCode,
    active: z.boolean(),
  })
  .superRefine(validateSoldProduct);

type ProductFormValues = z.input<typeof productSchema>;

const EMPTY_VALUES: ProductFormValues = {
  name: "",
  genericName: "",
  form: "",
  strength: "",
  stockUnit: "tablet",
  unitsPerPack: "1",
  schedule: "none",
  manufacturer: "",
  sold: true,
  code: "",
  taxRatePercent: "0",
  taxCode: "",
  active: true,
};

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
            placeholder="Name, code, or generic"
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
                { head: "Name", cell: (item) => item.name },
                {
                  head: "Code",
                  cell: (item) => (
                    <span className="font-mono">
                      {item.code ?? (
                        <span className="font-sans text-muted-foreground">Internal</span>
                      )}
                    </span>
                  ),
                  mobile: "title",
                },
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
                  cell: (item) =>
                    item.catalogItemId === null ? (
                      <Badge variant="muted">Internal</Badge>
                    ) : (
                      <Badge variant={item.active ? "secondary" : "muted"}>
                        {item.active ? "Active" : "Inactive"}
                      </Badge>
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

      {creating ? (
        <ProductSheet orgSlug={orgSlug} product={null} onClose={() => setCreating(false)} />
      ) : null}
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

function ProductSheet({
  orgSlug,
  product,
  onClose,
}: {
  orgSlug: string;
  product: Product | null;
  onClose: () => void;
}) {
  // The API refuses to unlink a catalog row, so an already sold product keeps the box on.
  const lockedSold = product?.catalogItemId != null;

  return (
    <FormSheet
      title={product ? "Edit product" : "Add product"}
      description="Name, pack and tax details carry onto every sale of this product."
      submitLabel={product ? "Save changes" : "Add product"}
      schema={productSchema}
      defaultValues={
        product
          ? {
              name: product.name,
              genericName: product.genericName ?? "",
              form: product.form ?? "",
              strength: product.strength ?? "",
              stockUnit: product.stockUnit,
              unitsPerPack: String(product.unitsPerPack),
              schedule: product.schedule,
              manufacturer: product.manufacturer ?? "",
              sold: lockedSold,
              code: product.code ?? "",
              taxRatePercent: product.taxRatePercent ?? "0",
              taxCode: product.taxCode ?? "",
              active: product.active ?? true,
            }
          : EMPTY_VALUES
      }
      success={product ? "Product updated" : "Product added"}
      onClose={onClose}
      run={(values) => {
        const shared = {
          orgSlug,
          name: values.name,
          genericName: values.genericName || undefined,
          form: values.form || undefined,
          strength: values.strength || undefined,
          stockUnit: values.stockUnit,
          unitsPerPack: values.unitsPerPack,
          schedule: values.schedule,
          manufacturer: values.manufacturer || undefined,
          catalog: values.sold
            ? {
                code: values.code,
                taxRatePercent: values.taxRatePercent,
                taxCode: values.taxCode || undefined,
                active: values.active,
              }
            : undefined,
        };

        return product
          ? orpc.pharmacy.updateProduct.call({ ...shared, productId: product.productId })
          : orpc.pharmacy.createProduct.call(shared);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MedicineNameField orgSlug={orgSlug} label="Name" productId={product?.productId} />
        <TextField name="genericName" label="Generic name (optional)" />
        <TextField name="manufacturer" label="Manufacturer (optional)" />
        <TextField name="form" label="Form (optional)" placeholder="tablet" />
        <TextField name="strength" label="Strength (optional)" placeholder="500 mg" />
        <ControlledField
          name="stockUnit"
          label="Stock unit"
          render={(field) => (
            <FormControl>
              <NativeSelect {...field}>
                {STOCK_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          )}
        />
        <TextField name="unitsPerPack" label="Units per pack" inputMode="numeric" />
        <ControlledField
          name="schedule"
          label="Prescription"
          render={(field) => (
            <FormControl>
              <NativeSelect {...field}>
                {SCHEDULES.map((schedule) => (
                  <option key={schedule} value={schedule}>
                    {SCHEDULE_LABELS[schedule]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          )}
        />
      </div>

      <ControlledField
        name="sold"
        label="Sold at the counter"
        description="Off for an internal supply: stocked and issued, never billed."
        className="flex flex-wrap items-center gap-2"
        render={(field) => (
          <FormControl>
            <Checkbox
              checked={field.value}
              disabled={lockedSold}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        )}
      />

      <CatalogFields />
    </FormSheet>
  );
}

/** The billing details, present only while the product is sold at the counter. */
function CatalogFields() {
  const { control } = useFormContext();

  return (
    <Watch
      control={control}
      name="sold"
      exact
      render={(sold) =>
        sold ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="code" label="Code" />
            <TextField name="taxRatePercent" label="GST %" inputMode="decimal" placeholder="12" />
            <TextField name="taxCode" label="HSN (optional)" />
            <ControlledField
              name="active"
              label="Active"
              className="flex flex-wrap items-center gap-2"
              render={(field) => (
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              )}
            />
          </div>
        ) : null
      }
    />
  );
}
