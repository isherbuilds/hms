import { cn } from "@hms/ui/lib/utils";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";

/** One quoted plan item and its posting progress; `action` is the screen's own control. */
export function PlanItemRow({
  item,
  currency,
  action,
}: {
  item: {
    description: string;
    note: string | null;
    status: string;
    postedSittings: number;
    postedAmount: bigint;
    sittingsPlanned: number;
    quotedPrice: bigint;
    nextSittingPrice: bigint | null;
    done: boolean;
  };
  currency: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span
        className={cn(
          "flex min-w-48 flex-1 flex-col",
          item.status === "dropped" && "text-muted-foreground line-through",
        )}
      >
        {item.description}
        {item.status === "dropped" ? <span className="sr-only"> (dropped)</span> : null}
        {item.note ? <span className="text-muted-foreground">{item.note}</span> : null}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {item.postedSittings} of ~{item.sittingsPlanned}{" "}
        {item.sittingsPlanned === 1 ? "sitting" : "sittings"} ·{" "}
        {formatMoney(item.postedAmount, currency)} of {formatMoney(item.quotedPrice, currency)}{" "}
        billed
        {item.done
          ? " · fully billed"
          : item.nextSittingPrice !== null
            ? ` · next ${formatMoney(item.nextSittingPrice, currency)}`
            : null}
      </span>
      {action}
    </div>
  );
}
