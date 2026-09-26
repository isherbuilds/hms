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
import type { Dispatch, SetStateAction } from "react";

import type { SaleLine } from "@/components/pharmacy-batch-picker";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";

/** The cart: each line's quantity edit and removal update the desk's cart directly. */
export function SaleLines({
  lines,
  currency,
  setCart,
}: {
  lines: Array<SaleLine & { lineSubtotal: bigint }>;
  currency: string;
  setCart: Dispatch<SetStateAction<SaleLine[]>>;
}) {
  const commitQty = (line: SaleLine, input: HTMLInputElement) => {
    // The shelf is the ceiling: the server refuses more, so the field never offers it.
    const qty = Math.min(line.shelfQty, Math.max(1, Math.trunc(input.valueAsNumber) || 1));
    input.value = String(qty);
    setCart((current) =>
      current.map((each) => (each.batchId === line.batchId ? { ...each, qty } : each)),
    );
  };

  const qtyField = (line: SaleLine) => (
    <Input
      key={`${line.batchId}:${line.qty}`}
      type="number"
      min={1}
      max={line.shelfQty}
      defaultValue={line.qty}
      aria-label={`${line.productName} quantity`}
      className="w-16 tabular-nums"
      onBlur={(event) => commitQty(line, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitQty(line, event.currentTarget);
      }}
    />
  );

  const removeButton = (line: SaleLine) => (
    <Button
      type="button"
      size="icon-xs"
      variant="destructive"
      aria-label={`Remove ${line.productName}`}
      onClick={() => setCart((current) => current.filter((each) => each.batchId !== line.batchId))}
    >
      <Trash2Icon />
    </Button>
  );

  if (lines.length === 0) {
    return <p className="text-muted-foreground">No batches in this sale</p>;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg ring-1 ring-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="w-20">Qty</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.batchId}>
                <TableCell>
                  <p className="font-medium capitalize">{line.productName}</p>
                </TableCell>
                <TableCell className="font-mono">{line.batchNumber}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatBusinessDate(line.expiryDate)}
                </TableCell>
                <TableCell>{qtyField(line)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.mrp, currency)}
                  {line.mrpUnits > 1 ? ` / ${line.mrpUnits}` : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.lineSubtotal, currency)}
                </TableCell>
                <TableCell>{removeButton(line)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {lines.map((line) => (
          <article
            key={line.batchId}
            className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="wrap-break-words font-medium capitalize">{line.productName}</p>
              <p className="break-all font-mono text-muted-foreground">Batch {line.batchNumber}</p>
              <p className="text-muted-foreground">Expires {formatBusinessDate(line.expiryDate)}</p>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
              <label className="grid gap-1 text-muted-foreground">
                Qty
                {qtyField(line)}
              </label>
              <div className="min-w-0">
                <p className="text-muted-foreground">MRP</p>
                <p className="wrap-break-words tabular-nums">
                  {formatMoney(line.mrp, currency)}
                  {line.mrpUnits > 1 ? ` / ${line.mrpUnits}` : ""}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-end justify-between gap-2 border-t border-border pt-2">
              <div className="min-w-0">
                <p className="text-muted-foreground">Amount</p>
                <p className="wrap-break-words font-medium tabular-nums">
                  {formatMoney(line.lineSubtotal, currency)}
                </p>
              </div>
              {removeButton(line)}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
