import { Separator } from "@hms/ui/components/separator";
import { type ReactNode } from "react";

import { formatMoney, ZERO } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";

export function FinancialSummary({
  quote,
  discountRow,
}: {
  quote: WalkInQuote;
  discountRow?: ReactNode;
}) {
  const { currency, addedTaxTotal } = quote;

  return (
    <dl className="grid gap-2 group-aria-busy/quote:opacity-50">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{formatMoney(quote.subtotal, currency)}</dd>
      </div>
      {discountRow ??
        (quote.discountAmount > ZERO ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular-nums">-{formatMoney(quote.discountAmount, currency)}</dd>
          </div>
        ) : null)}
      {addedTaxTotal === undefined ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Tax</dt>
          <dd className="tabular-nums">{formatMoney(quote.taxTotal, currency)}</dd>
        </div>
      ) : addedTaxTotal === ZERO ? null : (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">GST added</dt>
          <dd className="tabular-nums">{formatMoney(addedTaxTotal, currency)}</dd>
        </div>
      )}
      {quote.roundOff !== ZERO ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Round off</dt>
          <dd className="tabular-nums">{formatMoney(quote.roundOff, currency)}</dd>
        </div>
      ) : null}
      <Separator />
      <div className="flex items-baseline justify-between pt-1 text-xs font-medium">
        <dt>Payable</dt>
        <dd className="tabular-nums">{formatMoney(quote.grandTotal, currency)}</dd>
      </div>
      {/* Already inside the MRP lines, so it reads after the total it does not add to. */}
      {addedTaxTotal === undefined || quote.taxTotal === addedTaxTotal ? null : (
        <div className="flex justify-between text-muted-foreground">
          <dt>GST included in MRP</dt>
          <dd className="tabular-nums">{formatMoney(quote.taxTotal - addedTaxTotal, currency)}</dd>
        </div>
      )}
    </dl>
  );
}
