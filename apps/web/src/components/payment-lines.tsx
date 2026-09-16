import { Button } from "@hms/ui/components/button";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { cn } from "@hms/ui/lib/utils";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useFormContext, Watch } from "react-hook-form";

import { ControlledField, TextField } from "@/components/form-fields";
import { formatMoney, ZERO } from "@/lib/money";
import { methodLabel, needsReference, PAYMENT_METHODS, type PaymentMethod } from "@/lib/settlement";

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
  remaining: bigint;
  currency: string;
  disabled?: boolean;
  onFill: () => void;
}) {
  if (remaining === ZERO) return null;

  if (remaining < ZERO) {
    return (
      <span role="status" className="text-destructive tabular-nums">
        Over by {formatMoney(-remaining, currency)}
      </span>
    );
  }

  return (
    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onFill}>
      <span className="tabular-nums">Fill {formatMoney(remaining, currency)}</span>
    </Button>
  );
}

/**
 * One payment's method and amount, plus the reference a traceable method needs.
 * Registers `method`, `amount` and `reference` on the surrounding form.
 */
export function PaymentLineFields() {
  const { control, setValue } = useFormContext<{ method: PaymentMethod; reference: string }>();

  return (
    <>
      <ControlledField
        name="method"
        label="Method"
        render={(field) => (
          <FormControl>
            <NativeSelect
              {...field}
              onChange={(event) => {
                field.onChange(event);
                setValue("reference", "");
              }}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {methodLabel(method)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <TextField name="amount" label="Amount" inputMode="decimal" />
      <Watch
        control={control}
        name="method"
        exact
        render={(method) =>
          needsReference(method) ? <TextField name="reference" label="Reference" /> : null
        }
      />
    </>
  );
}
