import { Combobox } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

export type ServiceLine = {
  catalogItemId: string;
  name: string;
  category: string;
  unitPrice: bigint;
  taxRatePercent: string;
  qty: number;
};

export function ServicePicker({
  orgSlug,
  chosen,
  allowConsultation,
  onAdd,
}: {
  orgSlug: string;
  chosen: ReadonlySet<string>;
  allowConsultation: boolean;
  onAdd: (line: ServiceLine) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // The DOM holds what is typed; only the settled term becomes state.
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  // Base UI owns the input text, so clearing it after a pick means mounting a fresh one.
  const [box, setBox] = useState(0);
  const settle = useDebouncedCallback(setSearch, 250);
  const searching = search.length > 0;

  const catalogSearch = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: {
        orgSlug,
        query: search || undefined,
        includeConsultation: allowConsultation,
      },
    }),
    enabled: searching,
  });

  const results = (catalogSearch.data ?? []).filter((item) => !chosen.has(item.id));

  const renderMatch = (item: (typeof results)[number]) => (
    <>
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="font-mono text-muted-foreground">
          {item.code} · {item.category}
        </span>
      </span>
      <span className="tabular-nums">{formatMoney(item.unitPrice, currency)}</span>
    </>
  );

  const typed = () => inputRef.current?.value.trim() ?? search;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
        <ClientOnly
          fallback={
            <Input
              id="service-search"
              name="service-search"
              className="pl-8"
              placeholder="Search service code, name or category"
              aria-label="Search services"
              disabled
            />
          }
        >
          <Combobox
            key={box}
            items={results}
            getItemKey={(item) => item.id}
            getItemLabel={(item) => item.name}
            onInputValueChange={(value) => settle(value.trim())}
            onSelect={(item) => {
              onAdd({
                catalogItemId: item.id,
                name: item.name,
                category: item.category,
                unitPrice: item.unitPrice,
                taxRatePercent: item.taxRatePercent,
                qty: 1,
              });
              setSearch("");
              setOpen(false);
              setBox((mounted) => mounted + 1);
            }}
            open={open && searching}
            onOpenChange={setOpen}
            inputRef={inputRef}
            inputClassName="pl-8"
            inputProps={{
              id: "service-search",
              name: "service-search",
              autoComplete: "off",
              placeholder: "Search service code, name or category",
              // Only after a pick: a fresh input must not steal focus when the section mounts.
              autoFocus: box > 0,
              onFocus: () => {
                if (typed().length > 0) setOpen(true);
              },
              onKeyDown: (event) => {
                if (event.key === "Enter" && typed().length > 0) event.preventDefault();
              },
              "aria-label": "Search services",
            }}
            itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-none border-b border-border px-3 py-2 last:border-b-0"
            renderItem={renderMatch}
            emptyContent={
              searching ? (
                <p className="px-3 py-2 text-muted-foreground">
                  {catalogSearch.isError
                    ? errorMessage(catalogSearch.error, "Could not search the catalog")
                    : catalogSearch.isPending
                      ? "Searching…"
                      : "No unused service matches"}
                </p>
              ) : undefined
            }
          />
        </ClientOnly>
      </div>
    </div>
  );
}
