import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { Trash2Icon } from "lucide-react";

import type { ServiceLine } from "@/components/opd-service-picker";
import { formatMoney } from "@/lib/money";

/** Services picked for a stay or an estimate, each with its quantity and a remove. */
export function ChosenServices({
  lines,
  onChange,
  currency,
  registered,
}: {
  lines: ServiceLine[];
  onChange: (lines: ServiceLine[]) => void;
  currency: string;
  registered: boolean;
}) {
  if (lines.length === 0) return null;

  // Uncontrolled until committed, so typing a quantity re-renders nothing.
  const commitQty = (line: ServiceLine, input: HTMLInputElement) => {
    const qty = Math.max(1, Math.trunc(input.valueAsNumber) || 1);
    input.value = String(qty);
    onChange(
      lines.map((each) => (each.catalogItemId === line.catalogItemId ? { ...each, qty } : each)),
    );
  };

  return (
    <ul className="grid gap-2">
      {lines.map((line) => (
        <li
          key={line.catalogItemId}
          className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2"
        >
          <span className="min-w-0">
            <span className="block truncate">{line.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatMoney(line.unitPrice, currency)}
              {registered && Number(line.taxRatePercent) > 0 ? " + GST" : ""}
            </span>
          </span>
          <Input
            key={`${line.catalogItemId}:${line.qty}`}
            type="number"
            min={1}
            step={1}
            defaultValue={line.qty}
            aria-label={`${line.name} quantity`}
            className="tabular-nums"
            onBlur={(event) => commitQty(line, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commitQty(line, event.currentTarget);
            }}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="destructive"
            aria-label={`Remove ${line.name}`}
            onClick={() =>
              onChange(lines.filter((each) => each.catalogItemId !== line.catalogItemId))
            }
          >
            <Trash2Icon />
          </Button>
        </li>
      ))}
    </ul>
  );
}
