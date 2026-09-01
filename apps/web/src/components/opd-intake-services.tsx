import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Trash2Icon } from "lucide-react";

import { formatMoney } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import { type ServiceLine } from "@/components/opd-service-picker";

export function ServiceLines({
  quote,
  services,
  onChange,
  onRemoveConsult,
}: {
  quote: WalkInQuote;
  services: ServiceLine[];
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
