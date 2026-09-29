import { Badge } from "@hms/ui/components/badge";
import { Combobox, ComboboxInput, ComboboxPopup } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { SEARCH_RESULT_LIMIT, searchEmptyMessage, useSearchTerm } from "@/hooks/use-remote-search";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { formatStockQty } from "@/lib/pharmacy-labels";

/** One shelf batch on the counter, with everything the sale and its money need. */
export type SaleLine = {
  batchId: string;
  productName: string;
  pack: string | null;
  unitsPerPack: number;
  batchNumber: string;
  expiryDate: string | null;
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
  const [inputValue, setInputValue] = useState("");
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const search = useSearchTerm();

  const stock = useQuery({
    ...orpc.pharmacy.searchStock.queryOptions({ input: { orgSlug, query: search.term } }),
    enabled: search.searching,
  });

  const results: Batch[] = (stock.data ?? [])
    .flatMap((product) =>
      product.batches
        .filter((batch) => !chosen.has(batch.batchId))
        .map((batch) => ({
          batchId: batch.batchId,
          productName: product.name,
          pack: product.pack,
          unitsPerPack: product.unitsPerPack,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          mrp: batch.mrp,
          mrpUnits: batch.mrpUnits,
          taxRatePercent: product.taxRatePercent,
          schedule: product.schedule,
          stockUnit: product.stockUnit,
          shelfQty: batch.shelfQty,
        })),
    )
    .slice(0, SEARCH_RESULT_LIMIT);

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
            placeholder="Name or generic"
            aria-label="Search stock"
            disabled
          />
        }
      >
        <Combobox<Batch>
          items={results}
          filteredItems={results}
          value={null}
          inputValue={inputValue}
          itemToStringLabel={(batch) =>
            batch ? `${batch.productName}${batch.pack ? ` · ${batch.pack}` : ""}` : ""
          }
          onInputValueChange={(value, { reason }) => {
            setInputValue(value);

            if (reason === "input-change") search.onInputValueChange(value);
          }}
          onValueChange={(batch) => {
            if (!batch) return;

            onAdd(batch);
            search.clear();
            setInputValue("");
          }}
          open={search.open}
          onOpenChange={search.setOpen}
          loopFocus
        >
          <ComboboxInput
            ref={inputRef}
            className="pl-8"
            id="stock-search"
            name="stock-search"
            autoComplete="off"
            placeholder="Name or generic"
            aria-label="Search stock"
            onFocus={() => {
              if (typed().length > 0) search.setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && typed().length > 0) event.preventDefault();
            }}
          />
          <ComboboxPopup
            getItemKey={(batch: Batch) => batch.batchId}
            itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
            renderItem={(batch: Batch) => (
              <>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium capitalize">
                      {batch.productName}
                      {batch.pack ? (
                        <span className="text-muted-foreground"> · {batch.pack}</span>
                      ) : null}
                    </span>
                    {batch.schedule === "none" ? null : (
                      <Badge variant="muted" className="uppercase">
                        Schedule {batch.schedule}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-mono">{batch.batchNumber}</span> ·{" "}
                    {batch.expiryDate
                      ? `expires ${formatBusinessDate(batch.expiryDate)}`
                      : "No expiry"}
                  </span>
                </span>
                <span className="grid justify-items-end">
                  <span className="tabular-nums">
                    {formatMoney(batch.mrp, currency)}
                    {batch.mrpUnits > 1 ? ` / ${batch.mrpUnits}` : ""}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatStockQty({ qty: batch.shelfQty, ...batch })}
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
        </Combobox>
      </ClientOnly>
    </div>
  );
}
