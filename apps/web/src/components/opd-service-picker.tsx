import { Combobox } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { ClientOnly } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";

export type ServiceLine = {
  catalogItemId: string;
  name: string;
  category: string;
  unitPrice: bigint;
  customRate: boolean;
  taxRatePercent: string;
  qty: number;
  customUnitPrice?: bigint;
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
  // Remounts the combobox after a pick, which is what clears its input.
  const [box, setBox] = useState(0);

  const search = useCatalogSearch({
    orgSlug,
    includeConsultation: allowConsultation,
    noMatch: "No unused service matches",
  });

  const results = search.items.filter((item) => !chosen.has(item.id));

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

  const typed = () => inputRef.current?.value.trim() ?? "";

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
              placeholder="Service code, name, or category"
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
            onInputValueChange={search.onInputValueChange}
            onSelect={(item) => {
              onAdd({
                catalogItemId: item.id,
                name: item.name,
                category: item.category,
                unitPrice: item.unitPrice,
                customRate: item.customRate,
                taxRatePercent: item.taxRatePercent,
                qty: 1,
              });
              search.clear();
              setBox((mounted) => mounted + 1);
            }}
            open={search.open}
            onOpenChange={search.setOpen}
            inputRef={inputRef}
            inputClassName="pl-8"
            inputProps={{
              id: "service-search",
              name: "service-search",
              autoComplete: "off",
              placeholder: "Service code, name, or category",
              autoFocus: box > 0,
              onFocus: () => {
                if (typed().length > 0) search.setOpen(true);
              },
              onKeyDown: (event) => {
                if (event.key === "Enter" && typed().length > 0) event.preventDefault();
              },
              "aria-label": "Search services",
            }}
            itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
            renderItem={renderMatch}
            emptyContent={
              search.emptyMessage ? (
                <p className="px-3 py-2 text-muted-foreground">{search.emptyMessage}</p>
              ) : undefined
            }
          />
        </ClientOnly>
      </div>
    </div>
  );
}
