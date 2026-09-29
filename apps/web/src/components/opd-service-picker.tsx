import { Combobox, ComboboxInput, ComboboxPopup } from "@hms/ui/components/combobox";
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
  const [inputValue, setInputValue] = useState("");
  const currency = useMembership(orgSlug, (membership) => membership.currency);

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
        <span className="text-muted-foreground">{item.category}</span>
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
          <Combobox<(typeof results)[number]>
            items={results}
            filteredItems={results}
            value={null}
            inputValue={inputValue}
            itemToStringLabel={(item) => item?.name ?? ""}
            onInputValueChange={(value, { reason }) => {
              setInputValue(value);

              if (reason === "input-change") search.onInputValueChange(value);
            }}
            onValueChange={(item) => {
              if (!item) return;

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
              setInputValue("");
            }}
            open={search.open}
            onOpenChange={search.setOpen}
            loopFocus
          >
            <ComboboxInput
              ref={inputRef}
              className="pl-8"
              id="service-search"
              name="service-search"
              autoComplete="off"
              placeholder="Service code, name, or category"
              aria-label="Search services"
              onFocus={() => {
                if (typed().length > 0) search.setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed().length > 0) event.preventDefault();
              }}
            />
            <ComboboxPopup
              getItemKey={(item: (typeof results)[number]) => item.id}
              itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
              renderItem={renderMatch}
              emptyContent={
                search.emptyMessage ? (
                  <p className="px-3 py-2 text-muted-foreground">{search.emptyMessage}</p>
                ) : undefined
              }
            />
          </Combobox>
        </ClientOnly>
      </div>
    </div>
  );
}
