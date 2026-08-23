import { Button, buttonVariants } from "@hms/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import {
  CancelOpdAppointmentDialog,
  OpdAppointmentStatusBadge,
  useOpdStatusActions,
  type OpdAppointmentStatus,
} from "@/components/opd-appointment";
import { formatMoney } from "@/lib/money";
import { formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

/** What the panel needs from a day row. `opd.day` returns a superset. */
export type OpdDayVisit = {
  id: string;
  status: OpdAppointmentStatus;
  tokenNumber: number | null;
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  createdAt: Date;
  cancelReason: string | null;
  callerName: string | null;
  callerPhone: string | null;
  patientName: string | null;
  patientMrn: string | null;
  patientPhone: string | null;
  practitionerName: string;
  departmentName: string;
  /** Outstanding on this appointment's invoices, as a decimal money string. */
  balanceDue: string;
};

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Spans both columns, for a value that runs to a sentence. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * One OPD appointment as a panel over the day, rather than a page away from it:
 * the desk keeps its place in the list, which refreshes underneath.
 *
 * The row carries the only routine step — check in — so this panel carries
 * everything the desk needs when the day goes off script: cancelling, marking a
 * no show, and the way through to the full record. Same `open`/`onOpenChange`
 * contract and default `right` side as `PatientSheet`, at every width, so staff
 * learn one panel instead of one per screen.
 */
export function OpdVisitSheet({
  orgSlug,
  appointment,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  /** Null once the row has gone, which is also while the panel animates out. */
  appointment: OpdDayVisit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { timeZone } = useOrgDateTime();
  const [confirm, confirmation] = useConfirm();
  const [cancelling, setCancelling] = useState(false);
  const membership = useQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const { markNoShow } = useOpdStatusActions(orgSlug);

  // Cancelling drops the row from the list before the panel has finished
  // leaving. Holding the last one keeps the content on screen for that exit
  // instead of blanking it.
  const last = useRef(appointment);
  if (appointment) last.current = appointment;
  const visit = appointment ?? last.current;

  const currency = membership.data?.currency;
  const name = visit?.patientName ?? visit?.callerName ?? "Unnamed caller";
  const balanceDue = visit ? Number(visit.balanceDue) : 0;

  return (
    <>
      <ClientOnly fallback={null}>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent>
            {visit ? (
              <>
                <SheetHeader className="border-b border-border">
                  <SheetTitle>{name}</SheetTitle>
                  <p className="text-muted-foreground">
                    {visit.patientMrn
                      ? `${visit.patientMrn} · ${visit.patientPhone ?? "No phone"}`
                      : `${visit.callerPhone ?? "No phone"} · patient linked at check-in`}
                  </p>
                </SheetHeader>

                <div className="flex flex-col gap-4 overflow-y-auto p-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Fact label="Token">
                      {visit.tokenNumber === null ? (
                        <span className="text-muted-foreground">Assigned at check-in</span>
                      ) : (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {visit.tokenNumber}
                        </span>
                      )}
                    </Fact>
                    <Fact label="Status">
                      <OpdAppointmentStatusBadge status={visit.status} />
                    </Fact>
                    <Fact label="Practitioner">{visit.practitionerName}</Fact>
                    <Fact label="Department">{visit.departmentName}</Fact>
                    <Fact label={visit.arrivedAt ? "Arrived" : "Booked for"}>
                      <span className="tabular-nums">
                        {formatTime(
                          visit.arrivedAt ?? visit.scheduledFor ?? visit.createdAt,
                          timeZone,
                        )}
                      </span>
                    </Fact>
                    {currency ? (
                      <Fact label="Balance">
                        {balanceDue > 0 ? (
                          <span className="font-medium text-destructive tabular-nums">
                            {formatMoney(visit.balanceDue, currency)} due
                          </span>
                        ) : (
                          "Settled"
                        )}
                      </Fact>
                    ) : null}
                    {visit.cancelReason ? (
                      <Fact label="Cancellation reason" wide>
                        {visit.cancelReason}
                      </Fact>
                    ) : null}
                  </dl>

                  <div className="border-t border-border pt-4">
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to="/$orgSlug/opd/$appointmentId"
                      params={{ orgSlug, appointmentId: visit.id }}
                    >
                      Open full record
                    </Link>
                  </div>

                  {visit.status === "booked" || visit.status === "checked_in" ? (
                    <div className="border-t border-border pt-4">
                      <p className="mb-2 text-muted-foreground">
                        If this patient will not be seen:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {visit.status === "booked" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={markNoShow.isPending}
                            onClick={() =>
                              confirm({
                                title: "Mark as no show?",
                                description: `${name} did not arrive. A no show cannot be reopened — rebook if they turn up later.`,
                                confirmLabel: "Mark no show",
                                run: () =>
                                  markNoShow.mutate(
                                    { orgSlug, appointmentId: visit.id },
                                    { onSuccess: () => onOpenChange(false) },
                                  ),
                              })
                            }
                          >
                            Mark no show
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
                          Cancel appointment
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </SheetContent>
        </Sheet>
      </ClientOnly>

      <ClientOnly fallback={null}>
        {visit && cancelling ? (
          <CancelOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={visit.id}
            onCancelled={() => onOpenChange(false)}
            onClose={() => setCancelling(false)}
          />
        ) : null}
      </ClientOnly>
      {confirmation}
    </>
  );
}
