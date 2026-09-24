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
    // Actions stay top-right at every width, so a phone never strands them on their own line.
    <div className="flex items-start gap-2 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn(item.status === "dropped" && "text-muted-foreground line-through")}>
          {item.description}
          {item.status === "dropped" ? <span className="sr-only"> (dropped)</span> : null}
        </span>
        {item.note ? <span className="text-muted-foreground">{item.note}</span> : null}
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
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
