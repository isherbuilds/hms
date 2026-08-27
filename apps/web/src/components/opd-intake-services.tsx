import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Separator } from "@hms/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { toPaise } from "@hms/api/lib/invoice-math";

import { formatMoney } from "@/lib/money";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import { orpc } from "@/lib/orpc";

export type ServiceLine = {
  catalogItemId: string;
  code: string;
  name: string;
  category: string;
  unitPrice: string;
  taxRatePercent: string;
  qty: number;
};

export function FinancialSummary({ quote }: { quote: WalkInQuote }) {
  const { currency } = quote;
  return (
    <dl className="grid gap-2">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{formatMoney(quote.subtotal, currency)}</dd>
      </div>
      {toPaise(quote.discountAmount) > 0 ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Discount</dt>
          <dd className="tabular-nums">-{formatMoney(quote.discountAmount, currency)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Tax</dt>
        <dd className="tabular-nums">{formatMoney(quote.taxTotal, currency)}</dd>
      </div>
      <Separator />
      <div className="flex items-baseline justify-between pt-1 text-sm font-medium">
        <dt>Payable</dt>
        <dd className="tabular-nums">{formatMoney(quote.grandTotal, currency)}</dd>
      </div>
    </dl>
  );
}

export function ServicePicker({
  orgSlug,
  services,
  currency,
  disabled,
  onChange,
}: {
  orgSlug: string;
  services: ServiceLine[];
  currency: string;
  disabled: boolean;
  onChange: (services: ServiceLine[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "procedure" | "lab" | "radiology" | "other">(
    "all",
  );
  const [open, setOpen] = useState(false);
  const normalized = query.trim();
  const debouncedQuery = useDebouncedValue(normalized, 250);
  const searching = normalized.length > 0 || category !== "all";
  const search = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: {
        orgSlug,
        query: debouncedQuery || undefined,
        category: category === "all" ? undefined : category,
      },
    }),
    enabled: searching && debouncedQuery === normalized,
  });
  const selectedIds = new Set(services.map((service) => service.catalogItemId));
  const results =
    debouncedQuery === normalized
      ? (search.data ?? []).filter((item) => !selectedIds.has(item.id))
      : [];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex w-full flex-col gap-2 sm:w-48">
        <span className="text-muted-foreground">Category</span>
        <NativeSelect
          value={category}
          disabled={disabled}
          onChange={(event) => {
            setCategory(event.target.value as "all" | "procedure" | "lab" | "radiology" | "other");
            setOpen(true);
          }}
        >
          <option value="all">All categories</option>
          <option value="procedure">Procedure</option>
          <option value="lab">Lab</option>
          <option value="radiology">Radiology</option>
          <option value="other">Other</option>
        </NativeSelect>
      </label>
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
        <Combobox
          items={results}
          getItemKey={(item) => item.id}
          getItemLabel={(item) => item.name}
          inputValue={query}
          onInputValueChange={setQuery}
          onSelect={(item) => {
            onChange([
              ...services,
              {
                catalogItemId: item.id,
                code: item.code,
                name: item.name,
                category: item.category,
                unitPrice: item.unitPrice,
                taxRatePercent: item.taxRatePercent,
                qty: 1,
              },
            ]);
            setQuery("");
            setOpen(false);
          }}
          open={open && searching}
          onOpenChange={setOpen}
          disabled={disabled}
          inputClassName="pl-8"
          inputProps={{
            id: "service-search",
            name: "service-search",
            autoComplete: "off",
            placeholder: "Search service code, name or category",
            onFocus: () => {
              if (searching) setOpen(true);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter" && normalized.length > 0) event.preventDefault();
            },
            "aria-label": "Search services",
          }}
          itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-none border-b border-border px-3 py-2 last:border-b-0"
          renderItem={(item) => (
            <>
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="font-mono text-muted-foreground">
                  {item.code} · {item.category}
                </span>
              </span>
              <span className="tabular-nums">{formatMoney(item.unitPrice, currency)}</span>
            </>
          )}
          emptyContent={
            searching ? (
              <p className="px-3 py-2 text-muted-foreground">
                {search.isError
                  ? search.error.message
                  : search.isPending || debouncedQuery !== normalized
                    ? "Searching…"
                    : "No unused service matches"}
              </p>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

export function ServiceLines({
  quote,
  services,
  disabled,
  onChange,
  onRemoveConsult,
}: {
  quote: WalkInQuote;
  services: ServiceLine[];
  disabled: boolean;
  onChange: (services: ServiceLine[]) => void;
  onRemoveConsult: () => void;
}) {
  const { currency } = quote;
  const remove = (catalogItemId: string) =>
    onChange(services.filter((service) => service.catalogItemId !== catalogItemId));
  const setQty = (catalogItemId: string, qty: number) =>
    onChange(
      services.map((service) =>
        service.catalogItemId === catalogItemId ? { ...service, qty } : service,
      ),
    );
  const commitQty = (catalogItemId: string, input: HTMLInputElement) => {
    const qty = Math.min(999, Math.max(1, input.valueAsNumber || 1));
    input.value = String(qty);
    setQty(catalogItemId, qty);
  };

  if (quote.lines.length === 0) {
    return <p className="text-muted-foreground">No services selected</p>;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg ring-1 ring-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-20">Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quote.lines.map((line) => (
              <TableRow key={`${line.source}:${line.chargeId}`}>
                <TableCell className="font-medium">{line.description}</TableCell>
                <TableCell>
                  <Badge variant="muted" className="capitalize">
                    {line.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  {line.source === "service" ? (
                    <Input
                      key={`${line.chargeId}:${line.qty}`}
                      type="number"
                      min={1}
                      max={999}
                      defaultValue={line.qty}
                      disabled={disabled}
                      aria-label={`${line.description} quantity`}
                      className="w-16 tabular-nums"
                      onBlur={(event) => commitQty(line.chargeId, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commitQty(line.chargeId, event.currentTarget);
                      }}
                    />
                  ) : (
                    <span className="tabular-nums">1</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.unitPrice, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.taxRatePercent === "0.00" ? "—" : `${line.taxRatePercent}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.gross, currency)}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${line.description}`}
                    disabled={disabled}
                    onClick={() =>
                      line.source === "service" ? remove(line.chargeId) : onRemoveConsult()
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {quote.lines.map((line) => (
          <article
            key={`${line.source}:${line.chargeId}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{line.description}</p>
              <div className="flex flex-wrap gap-1 pt-2">
                <Badge variant="muted" className="capitalize">
                  {line.category}
                </Badge>
                <Badge variant="outline">
                  {line.taxRatePercent === "0.00" ? "No tax" : `Tax ${line.taxRatePercent}%`}
                </Badge>
              </div>
            </div>
            <div className="grid justify-items-end gap-2">
              <span className="font-medium tabular-nums">{formatMoney(line.gross, currency)}</span>
              {line.source === "service" ? (
                <div className="flex items-center gap-1">
                  <Input
                    key={`${line.chargeId}:${line.qty}`}
                    type="number"
                    min={1}
                    max={999}
                    defaultValue={line.qty}
                    disabled={disabled}
                    aria-label={`${line.description} quantity`}
                    className="w-16 tabular-nums"
                    onBlur={(event) => commitQty(line.chargeId, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      commitQty(line.chargeId, event.currentTarget);
                    }}
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${line.description}`}
                    disabled={disabled}
                    onClick={() => remove(line.chargeId)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span
                    className="flex h-8 w-16 items-center px-2 tabular-nums"
                    aria-label={`${line.description} quantity`}
                  >
                    1
                  </span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${line.description}`}
                    disabled={disabled}
                    onClick={onRemoveConsult}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
