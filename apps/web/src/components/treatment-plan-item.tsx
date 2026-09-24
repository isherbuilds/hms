import { cn } from "@hms/ui/lib/utils";
import type { ReactNode } from "react";

import { formatMoney, percentOf } from "@/lib/money";

/**
 * One quoted plan item as its own tinted block: name, progress bar and amounts.
 * `action` sits top-right (rare actions); `children` holds the screen's main buttons.
 */
export function PlanItemRow({
  item,
  currency,
  action,
  children,
}: {
  item: {
    description: string;
    note: string | null;
    status: string;
    postedSittings: number;
    postedAmount: bigint;
    sittingsPlanned: number;
    quotedPrice: bigint;
    done: boolean;
  };
  currency: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const dropped = item.status === "dropped";

  // A free item has nothing to bill, so its bar fills once it is done.
  const percent = item.done ? 100 : percentOf(item.postedAmount, item.quotedPrice);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className={cn("text-sm font-medium", dropped && "text-muted-foreground line-through")}>
            {item.description}
            {dropped ? <span className="sr-only"> (dropped)</span> : null}
          </p>
          {item.note ? <p className="text-muted-foreground">{item.note}</p> : null}
        </div>
        {action}
      </div>
      {dropped ? (
        <p className="text-muted-foreground">Dropped</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap justify-between gap-x-3 tabular-nums">
            <span className="text-muted-foreground">
              {item.postedSittings} of ~{item.sittingsPlanned}{" "}
              {item.sittingsPlanned === 1 ? "sitting" : "sittings"} done
            </span>
            <span className={item.done ? "font-medium text-clinical-clear" : "font-medium"}>
              {item.done
                ? `Fully billed · ${formatMoney(item.quotedPrice, currency)}`
                : `${formatMoney(item.postedAmount, currency)} of ${formatMoney(item.quotedPrice, currency)} billed`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full", item.done ? "bg-clinical-clear" : "bg-primary")}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
