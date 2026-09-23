import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { DataList } from "@/components/page";
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
    <DataList
      columns={[
        {
          head: "Service",
          cell: (line) => <p className="font-medium">{line.description}</p>,
        },
        {
          head: "Category",
          cell: (line) => (
            <Badge variant="muted" className="capitalize">
              {line.category}
            </Badge>
          ),
        },
        {
          head: "Qty",
          className: "w-20",
          cell: (line) =>
            line.editable ? (
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
            ),
        },
        {
          head: "Rate",
          className: "text-right",
          cell: (line) => (
            <span className="tabular-nums">
              {line.customRate ? (
                <RateInput
                  line={line}
                  onCommit={(customUnitPrice) => onChange(line.key, { customUnitPrice })}
                />
              ) : (
                formatMoney(line.unitPrice, currency)
              )}
            </span>
          ),
        },
        {
          head: "Tax",
          className: "text-right",
          cell: (line) => (
            <span className="tabular-nums">
              {line.taxRatePercent === "0.00" ? "—" : `${line.taxRatePercent}%`}
            </span>
          ),
        },
        {
          head: "Amount",
          className: "text-right",
          cell: (line) => (
            <span className="tabular-nums group-aria-busy/quote:opacity-50">
              {line.gross !== undefined ? formatMoney(line.gross, currency) : "—"}
            </span>
          ),
        },
      ]}
      rows={lines}
      rowKey={(line) => line.key}
      action={(line) => (
        <Button
          type="button"
          size="icon-xs"
          variant="destructive"
          aria-label={`Remove ${line.description}`}
          onClick={() => onRemove(line.key, line.editable)}
        >
          <Trash2Icon />
        </Button>
      )}
    />
  );
}
