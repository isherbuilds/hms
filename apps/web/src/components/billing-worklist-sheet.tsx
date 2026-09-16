import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Separator } from "@hms/ui/components/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { useIsMutating } from "@tanstack/react-query";
import { ClientOnly, Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PhoneIcon } from "lucide-react";

import { RecordPaymentForm } from "@/components/record-payment-form";
import type { WorklistRow } from "@/lib/billing-worklist-row";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";

/** The row as the list shows it, with the credit read when the desk opened it. */
type OpenRow = { row: WorklistRow; credit: bigint };

export function BillingWorklistSheet({
  orgSlug,
  open,
  onClose,
}: {
  orgSlug: string;
  open: OpenRow | null;
  onClose: () => void;
}) {
  // A pending payment keeps the sheet open; reopening would mint a new request key (D039).
  const paying = useIsMutating({ mutationKey: orpc.billing.recordPayments.mutationKey() }) > 0;

  return (
    <ClientOnly fallback={null}>
      <Sheet open={open !== null} onOpenChange={(next) => (next || paying ? undefined : onClose())}>
        <SheetContent>
          {open ? (
            // Keyed by the row, not by what it owes: a background refetch must not remount the
            // panel and wipe a half-typed amount.
            <Body key={open.row.key} orgSlug={orgSlug} open={open} onClose={onClose} />
          ) : null}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}

function Body({
  orgSlug,
  open: { row, credit },
  onClose,
}: {
  orgSlug: string;
  open: OpenRow;
  onClose: () => void;
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="capitalize">{row.patientName}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-muted-foreground">
            {row.reference} · {row.patientMrn}
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`text-sm font-medium tabular-nums ${
                row.state === "stale"
                  ? "text-destructive"
                  : row.state === "late"
                    ? "text-overdue"
                    : ""
              }`}
            >
              {formatMoney(row.owed, row.currency)}
            </span>
            <span className="text-muted-foreground">
              {row.invoiceId ? "outstanding" : "not yet invoiced"}
            </span>
          </span>
          <span className="text-muted-foreground">{row.detail}</span>
        </div>

        <Separator />

        {row.invoiceId ? (
          <RecordPaymentForm
            orgSlug={orgSlug}
            invoiceId={row.invoiceId}
            outstanding={row.owed}
            availableCredit={credit}
            currency={row.currency}
            onClose={onClose}
            submitLabel="Collect"
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              Nothing is owed until the invoice is issued.
            </span>
            <Button
              size="sm"
              className="ml-auto"
              nativeButton={false}
              render={
                <Link
                  to="/$orgSlug/opd/$appointmentId/billing"
                  params={{ orgSlug, appointmentId: row.appointmentId }}
                />
              }
            >
              Issue invoice
            </Button>
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          {row.patientPhone ? (
            <Badge variant="muted" className="gap-1 font-mono">
              <PhoneIcon />
              {row.patientPhone}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            nativeButton={false}
            render={
              <Link
                to="/$orgSlug/opd/$appointmentId/billing"
                params={{ orgSlug, appointmentId: row.appointmentId }}
              />
            }
          >
            <ExternalLinkIcon />
            Open visit billing
          </Button>
        </div>
      </div>
    </>
  );
}
