import { Badge } from "@hms/ui/components/badge";
import { Combobox } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

/** One shelf batch on the counter, with everything the sale and its money need. */
export type SaleLine = {
  batchId: string;
  productName: string;
  code: string;
  batchNumber: string;
  expiryDate: string;
  mrp: bigint;
  mrpUnits: number;
  taxRatePercent: string;
  schedule: string;
  stockUnit: string;
  shelfQty: number;
  qty: number;
};

type Batch = Omit<SaleLine, "qty">;

/**
 * The counter picks a batch, not a product: expiry and MRP belong to the batch, so a
 * product-level result would only ask the operator to choose again.
 */
export function PharmacyBatchPicker({
  orgSlug,
  chosen,
  onAdd,
}: {
  orgSlug: string;
  chosen: ReadonlySet<string>;
  onAdd: (batch: Batch) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // Remounts the combobox after a pick, which is what clears its input.
  const [box, setBox] = useState(0);
  const search = useSearchTerm();

  const stock = useQuery({
    ...orpc.pharmacy.searchStock.queryOptions({ input: { orgSlug, query: search.term } }),
    enabled: search.searching,
  });

  const results: Batch[] = (stock.data ?? []).flatMap((product) =>
    product.batches
      .filter((batch) => !chosen.has(batch.batchId))
      .map((batch) => ({
        batchId: batch.batchId,
        productName: product.name,
        code: product.code,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        mrp: batch.mrp,
        mrpUnits: batch.mrpUnits,
        taxRatePercent: product.taxRatePercent,
        schedule: product.schedule,
        stockUnit: product.stockUnit,
        shelfQty: batch.shelfQty,
      })),
  );

  const emptyMessage = searchEmptyMessage(search.searching, stock, {
    noMatch: "No batch on the shelf matches",
    failed: "Could not search stock",
  });

  const typed = () => inputRef.current?.value.trim() ?? "";

  return (
    <div className="relative min-w-0">
      <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
      <ClientOnly
        fallback={
          <Input
            id="stock-search"
            name="stock-search"
            className="pl-8"
            placeholder="Name, code, or generic"
            aria-label="Search stock"
            disabled
          />
        }
      >
        <Combobox
          key={box}
          items={results}
          getItemKey={(batch) => batch.batchId}
          getItemLabel={(batch) => batch.productName}
          onInputValueChange={search.onInputValueChange}
          onSelect={(batch) => {
            onAdd(batch);
            search.clear();
            setBox((mounted) => mounted + 1);
          }}
          open={search.open}
          onOpenChange={search.setOpen}
          inputRef={inputRef}
          inputClassName="pl-8"
          inputProps={{
            id: "stock-search",
            name: "stock-search",
            autoComplete: "off",
            placeholder: "Name, code, or generic",
            autoFocus: box > 0,
            onFocus: () => {
              if (typed().length > 0) search.setOpen(true);
            },
            "aria-label": "Search stock",
          }}
          itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
          renderItem={(batch) => (
            <>
              <span className="min-w-0">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-medium capitalize">{batch.productName}</span>
                  {batch.schedule === "none" ? null : (
                    <Badge variant="muted" className="uppercase">
                      Schedule {batch.schedule}
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground">
                  <span className="font-mono">{batch.batchNumber}</span> · expires{" "}
                  {formatBusinessDate(batch.expiryDate)}
                </span>
              </span>
              <span className="grid justify-items-end">
                <span className="tabular-nums">
                  {formatMoney(batch.mrp, currency)}
                  {batch.mrpUnits > 1 ? ` / ${batch.mrpUnits}` : ""}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {batch.shelfQty} {batch.stockUnit}
                </span>
              </span>
            </>
          )}
          emptyContent={
            emptyMessage ? (
              <p className="px-3 py-2 text-muted-foreground">{emptyMessage}</p>
            ) : undefined
          }
        />
      </ClientOnly>
    </div>
  );
}
