import { fromPaise } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";

/**
 * The one layout every "collect money" form uses: column labels once at the top,
 * a method and an amount per row, and a reference directly under the line it
 * belongs to. Every cell names its own column, so a line without a reference or a
 * remove button cannot shift the lines under it.
 */
export function PaymentLines({
  removable,
  children,
}: {
  /** Reserves the remove column, so a split does not shift the amounts. */
  removable: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-2",
        removable ? "grid-cols-[minmax(0,1fr)_7rem_2rem]" : "grid-cols-[minmax(0,1fr)_7rem]",
      )}
    >
      <span className="col-start-1 text-muted-foreground">Method</span>
      <span className="col-start-2 text-right text-muted-foreground">Amount</span>
      {children}
    </div>
  );
}

export function PaymentLine({
  method,
  amount,
  reference,
  removeLabel,
  disabled,
  onRemove,
}: {
  method: ReactNode;
  amount: ReactNode;
  /** Only for methods that land somewhere traceable; named by its method. */
  reference?: ReactNode;
  removeLabel: string;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  return (
    <>
      <div className="col-start-1 min-w-0">{method}</div>
      <div className="col-start-2">{amount}</div>
      {onRemove ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="col-start-3 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      ) : null}
      {/* Full width, so the next line still starts at the first column. `empty:hidden`
          keeps a method that needs no reference from leaving a gap. */}
      {reference ? <div className="col-span-full empty:hidden">{reference}</div> : null}
    </>
  );
}

/**
 * What is still unallocated, live. The desk sees the gap while it types rather
 * than after a refused submit, and the figure is the control that closes it.
 */
export function PaymentBalance({
  remaining,
  currency,
  disabled,
  onFill,
}: {
  /** Paise: positive is short of the bill, negative is over it. */
  remaining: number;
  currency: string;
  disabled?: boolean;
  onFill: () => void;
}) {
  if (remaining === 0) return null;
  if (remaining < 0) {
    return (
      <span role="status" className="text-destructive tabular-nums">
        Over by {formatMoney(fromPaise(-remaining), currency)}
      </span>
    );
  }
  return (
    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onFill}>
      <span className="tabular-nums">Fill {formatMoney(fromPaise(remaining), currency)}</span>
    </Button>
  );
}
