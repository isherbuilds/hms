import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { toPaise } from "@hms/api/lib/invoice-math";

import { formatMoney } from "@/lib/money";

export type ServiceLine = { catalogItemId: string; qty: number };

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  unitPrice: string;
};

export type WalkInQuote = {
  currency: string;
  lines: Array<{
    chargeId: string;
    source: "consultation" | "service";
    description: string;
    category: string;
    qty: number;
    unitPrice: string;
    taxRatePercent: string;
    gross: string;
  }>;
  subtotal: string;
  discountAmount: string;
  taxTotal: string;
  grandTotal: string;
};

export function FinancialSummary({ quote }: { quote?: WalkInQuote }) {
  const currency = quote?.currency ?? "INR";
  return (
    <dl className="grid gap-2">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{quote ? formatMoney(quote.subtotal, currency) : "—"}</dd>
      </div>
      {quote && toPaise(quote.discountAmount) > 0 ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Discount</dt>
          <dd className="tabular-nums">-{formatMoney(quote.discountAmount, currency)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Tax</dt>
        <dd className="tabular-nums">{quote ? formatMoney(quote.taxTotal, currency) : "—"}</dd>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm font-medium">
        <dt>Payable</dt>
        <dd className="tabular-nums">{quote ? formatMoney(quote.grandTotal, currency) : "—"}</dd>
      </div>
    </dl>
  );
}

export function ServicePicker({
  catalog,
  services,
  currency,
  disabled,
  onChange,
}: {
  catalog: CatalogItem[];
  services: ServiceLine[];
  currency: string;
  disabled: boolean;
  onChange: (services: ServiceLine[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "procedure" | "lab" | "radiology" | "other">(
    "all",
  );
  // The popup opens on typing, focus, or a category choice, and closes on
  // selection, Escape, or focus leaving the picker.
  const [open, setOpen] = useState(false);
  const normalized = query.trim().toLowerCase();
  const selectedIds = new Set(services.map((service) => service.catalogItemId));
  // A chosen category browses the catalog even before staff type a query.
  const searching = normalized.length > 0 || category !== "all";
  const results = searching
    ? catalog
        .filter((item) => item.category !== "consultation")
        .filter((item) => category === "all" || item.category === category)
        .filter(
          (item) =>
            !selectedIds.has(item.id) &&
            `${item.code} ${item.name} ${item.category}`.toLowerCase().includes(normalized),
        )
        .slice(0, 8)
    : [];

  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="flex w-full flex-col gap-2 text-xs font-medium sm:w-48">
        Category
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
        <Input
          id="service-search"
          name="service-search"
          value={query}
          disabled={disabled}
          autoComplete="off"
          placeholder="Search service code, name or category"
          className="pl-8"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {searching && open ? (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-border">
            {results.length > 0 ? (
              results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
                  onClick={() => {
                    onChange([...services, { catalogItemId: item.id, qty: 1 }]);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {item.code} · {item.category}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatMoney(item.unitPrice, currency)}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-muted-foreground">No unused service matches.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ServiceLines({
  quote,
  services,
  disabled,
  onChange,
}: {
  quote?: WalkInQuote;
  services: ServiceLine[];
  disabled: boolean;
  onChange: (services: ServiceLine[]) => void;
}) {
  const currency = quote?.currency ?? "INR";
  const lines = quote?.lines ?? [];
  const remove = (catalogItemId: string) =>
    onChange(services.filter((service) => service.catalogItemId !== catalogItemId));
  const setQty = (catalogItemId: string, qty: number) =>
    onChange(
      services.map((service) =>
        service.catalogItemId === catalogItemId ? { ...service, qty } : service,
      ),
    );

  if (lines.length === 0) {
    return <p className="text-muted-foreground">Choose the patient and care team to load fees.</p>;
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
            {lines.map((line) => (
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
                      type="number"
                      min={1}
                      max={999}
                      value={line.qty}
                      disabled={disabled}
                      aria-label={`${line.description} quantity`}
                      className="w-16 tabular-nums"
                      onChange={(event) =>
                        setQty(line.chargeId, Math.max(1, event.target.valueAsNumber || 1))
                      }
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
                  {line.source === "service" ? (
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
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {lines.map((line) => (
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
                    type="number"
                    min={1}
                    max={999}
                    value={line.qty}
                    disabled={disabled}
                    aria-label={`${line.description} quantity`}
                    className="w-16 tabular-nums"
                    onChange={(event) =>
                      setQty(line.chargeId, Math.max(1, event.target.valueAsNumber || 1))
                    }
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
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
