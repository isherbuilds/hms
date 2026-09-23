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
import { formatDecimal } from "@hms/api/core/money";

import { formatMoney, parseMoneyInput } from "@/lib/money";

type IntakeServiceLine = {
  key: string;
  description: string;
  category: string;
  qty: number;
  unitPrice: bigint;
  customRate: boolean;
  customUnitPrice?: bigint;
  taxRatePercent: string;
  gross?: bigint;
  editable: boolean;
};

function RateInput({
  line,
  onCommit,
}: {
  line: IntakeServiceLine;
  onCommit: (customUnitPrice: bigint | undefined) => void;
}) {
  const committed = line.customUnitPrice ?? line.unitPrice;

  const commit = (input: HTMLInputElement) => {
    const text = input.value.trim();
    const paise = text === "" ? line.unitPrice : parseMoneyInput(text);
    const next = paise ?? committed;

    input.value = formatDecimal(next);
    onCommit(next === line.unitPrice ? undefined : next);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      defaultValue={formatDecimal(committed)}
      aria-label={`${line.description} rate`}
      className="w-24 text-right tabular-nums"
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        commit(event.currentTarget);
      }}
    />
  );
}

export function ServiceLines({
  lines,
  currency,
  onChange,
  onRemove,
}: {
  lines: IntakeServiceLine[];
  currency: string;
  onChange: (
    key: string,
    patch: Partial<Pick<IntakeServiceLine, "qty" | "customUnitPrice">>,
  ) => void;
  onRemove: (key: string, editable: boolean) => void;
}) {
  const commitQty = (key: string, input: HTMLInputElement) => {
    const qty = Math.min(999, Math.max(1, input.valueAsNumber || 1));
    input.value = String(qty);
    onChange(key, { qty });
  };

  if (lines.length === 0) {
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
            {lines.map((line) => (
              <TableRow key={line.key}>
                <TableCell>
                  <p className="font-medium">{line.description}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="muted" className="capitalize">
                    {line.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  {line.editable ? (
                    <Input
                      key={`${line.key}:${line.qty}`}
                      type="number"
                      min={1}
                      max={999}
                      defaultValue={line.qty}
                      aria-label={`${line.description} quantity`}
                      className="w-16 tabular-nums"
                      onBlur={(event) => commitQty(line.key, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commitQty(line.key, event.currentTarget);
                      }}
                    />
                  ) : (
                    <span className="tabular-nums">1</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.customRate ? (
                    <RateInput
                      line={line}
                      onCommit={(customUnitPrice) => onChange(line.key, { customUnitPrice })}
                    />
                  ) : (
                    formatMoney(line.unitPrice, currency)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.taxRatePercent === "0.00" ? "—" : `${line.taxRatePercent}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums group-aria-busy/quote:opacity-50">
                  {line.gross !== undefined ? formatMoney(line.gross, currency) : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    aria-label={`Remove ${line.description}`}
                    onClick={() => onRemove(line.key, line.editable)}
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
        {lines.map((line) => (
          <article
            key={line.key}
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
              {line.gross !== undefined ? (
                <span className="font-medium tabular-nums group-aria-busy/quote:opacity-50">
                  {formatMoney(line.gross, currency)}
                </span>
              ) : null}
              <div className="flex items-end gap-2">
                {line.customRate ? (
                  <label className="grid justify-items-end gap-1 text-muted-foreground">
                    Rate
                    <RateInput
                      line={line}
                      onCommit={(customUnitPrice) => onChange(line.key, { customUnitPrice })}
                    />
                  </label>
                ) : null}
                {line.editable ? (
                  <label className="grid justify-items-end gap-1 text-muted-foreground">
                    Qty
                    <Input
                      key={`${line.key}:${line.qty}`}
                      type="number"
                      min={1}
                      max={999}
                      defaultValue={line.qty}
                      aria-label={`${line.description} quantity`}
                      className="w-16 tabular-nums"
                      onBlur={(event) => commitQty(line.key, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commitQty(line.key, event.currentTarget);
                      }}
                    />
                  </label>
                ) : (
                  <span
                    className="flex h-8 w-16 items-center px-2 tabular-nums"
                    aria-label={`${line.description} quantity`}
                  >
                    1
                  </span>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  aria-label={`Remove ${line.description}`}
                  onClick={() => onRemove(line.key, line.editable)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
