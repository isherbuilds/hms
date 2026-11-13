import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { appHead } from "@/config/site";
import {
  CancelReservationDialog,
  ChangeDatesDialog,
  HoldBedDialog,
  RequestBedDialog,
  type Reservation,
} from "@/components/bed-reservation-dialogs";
import { AdmitDialog } from "@/components/ipd-dialogs";
import {
  DataList,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
} from "@/components/page";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH, OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { IpdTabs } from "./route";

const VIEWS = ["arrivals", "waitlist", "attention", "all"] as const;

type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  arrivals: "Arrivals",
  waitlist: "Waiting list",
  attention: "Needs attention",
  all: "All",
};

const EMPTY: Record<View, string> = {
  arrivals: "No held beds for the next two days",
  waitlist: "No one is waiting for a bed",
  attention: "Nothing needs attention",
  all: "No reservations",
};

// The worklists come back whole; `all` pages.
const reservationsQuery = (orgSlug: string, view: View) =>
  orpc.ipd.listBedReservations.infiniteOptions({
    input: (cursor: { createdAt: Date; id: string } | undefined) => ({ orgSlug, view, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    ...OPERATIONAL_INFINITE_REFETCH,
  });

const boardQuery = (orgSlug: string) =>
  orpc.ipd.bedBoard.queryOptions({ input: { orgSlug }, ...OPERATIONAL_REFETCH });

const MINUTE_MS = 60_000;

function subscribeMinutes(tick: () => void) {
  const timer = setInterval(tick, MINUTE_MS);

  return () => clearInterval(timer);
}

const currentMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

/** Wall-clock time to the minute; the first render uses the loader's clock so hydration matches. */
function useMinuteClock(initial: number) {
  return useSyncExternalStore(subscribeMinutes, currentMinute, () => initial);
}

export const Route = createFileRoute("/$orgSlug/ipd/reservations")({
  head: () => appHead("Reservations"),
  validateSearch: z.object({
    view: z.enum(VIEWS).default("arrivals").catch("arrivals"),
  }),
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { ipd: ["read"] }, "/$orgSlug/dashboard");
    await Promise.all([
      queryClient.infiniteQuery(reservationsQuery(orgSlug, deps.view)).catch(() => {}),
      // The hold dialogs choose among the beds free now.
      queryClient.query(boardQuery(orgSlug)).catch(() => {}),
    ]);

    // One clock for server and client render, so "has the window started" agrees.
    return { now: Date.now() };
  },
  component: ReservationsRoute,
});

const STATUS_LABELS: Record<Reservation["effectiveStatus"], string> = {
  requested: "Requested",
  confirmed: "Held",
  converted: "Arrived",
  cancelled: "Cancelled",
  disrupted: "Needs a bed again",
  expired: "Hold lapsed",
};

function ReservationStatus({ reservation }: { reservation: Reservation }) {
  const status = reservation.effectiveStatus;

  if (reservation.atRiskReason === "occupied") {
    return <Badge variant="pending">Bed still occupied</Badge>;
  }

  if (reservation.atRiskReason === "blocked") return <Badge variant="pending">Bed blocked</Badge>;

  const variant =
    status === "disrupted" || status === "expired"
      ? "pending"
      : status === "confirmed"
        ? "secondary"
        : status === "requested"
          ? "outline"
          : "muted";

  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

type Dialog = { kind: "admit" | "hold" | "dates" | "cancel"; reservation: Reservation };

function canAdmitNow(reservation: Reservation, now: number) {
  return (
    reservation.effectiveStatus === "confirmed" &&
    !reservation.atRisk &&
    reservation.plannedArrivalAt.getTime() <= now &&
    now < reservation.plannedDepartureAt.getTime()
  );
}

function note(reservation: Reservation, now: number) {
  if (reservation.effectiveStatus === "disrupted") return reservation.disruptedReason;

  if (reservation.effectiveStatus === "cancelled") return reservation.cancelReason;

  if (reservation.effectiveStatus === "confirmed" && reservation.plannedArrivalAt.getTime() > now) {
    return "To admit now, change the dates first.";
  }

  return null;
}

function ReservationsRoute() {
  const { orgSlug } = Route.useParams();
  const { view } = Route.useSearch();
  const now = useMinuteClock(Route.useLoaderData().now);
  const { timeZone } = useOrgDateTime();
  const reservations = useInfiniteQuery(reservationsQuery(orgSlug, view));
  const board = useQuery(boardQuery(orgSlug));
  const canCreate = useCan(orgSlug, { ipd: ["create"] });
  const canUpdate = useCan(orgSlug, { ipd: ["update"] });
  const [requesting, setRequesting] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const items = reservations.data?.pages.flatMap((page) => page.items) ?? [];
  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        title="IPD"
        action={
          canCreate ? <Button onClick={() => setRequesting(true)}>Reserve a bed</Button> : null
        }
      />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <nav aria-label="Reservation views" className="flex flex-wrap items-center gap-1">
            {VIEWS.map((item) => (
              <Link
                key={item}
                to="/$orgSlug/ipd/reservations"
                params={{ orgSlug }}
                search={{ view: item }}
                replace
                className={buttonVariants({ variant: view === item ? "secondary" : "ghost" })}
              >
                {VIEW_LABELS[item]}
              </Link>
            ))}
          </nav>
        </ListToolbar>

        <Panel grow footer={<LoadMore query={reservations} shown={items.length} />}>
          <ListState
            query={reservations}
            errorTitle="Could not load reservations"
            isEmpty={items.length === 0}
            empty={EMPTY[view]}
          >
            <DataList
              wrap
              tableAt="xl"
              columns={[
                {
                  head: "Patient",
                  cell: (item) => (
                    <span className="block min-w-0">
                      <span className="block capitalize">{item.patientName}</span>
                      <span className="block font-mono text-muted-foreground">{item.mrn}</span>
                    </span>
                  ),
                },
                { head: "Bed type", cell: (item) => item.categoryName },
                {
                  head: "Bed",
                  cell: (item) =>
                    item.bedLabel ? (
                      <span className="whitespace-nowrap">
                        {item.wardName} <span className="font-mono">{item.bedLabel}</span>
                      </span>
                    ) : (
                      "Any bed"
                    ),
                },
                {
                  head: "Planned stay",
                  cell: (item) => (
                    <span className="tabular-nums">
                      {formatDateTime(item.plannedArrivalAt, timeZone)} →{" "}
                      {formatDateTime(item.plannedDepartureAt, timeZone)}
                    </span>
                  ),
                },
                {
                  head: "Held until",
                  cell: (item) =>
                    item.holdUntil ? (
                      <span className="tabular-nums">
                        <span className="xl:hidden">Held until </span>
                        {formatDateTime(item.holdUntil, timeZone)}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  head: "Status",
                  cell: (item) => {
                    const detail = note(item, now);

                    return (
                      <>
                        <ReservationStatus reservation={item} />
                        {detail ? (
                          <span className="ml-1 text-muted-foreground xl:mt-1 xl:ml-0 xl:block">
                            {detail}
                          </span>
                        ) : null}
                      </>
                    );
                  },
                },
              ]}
              rows={items}
              rowKey={(item) => item.id}
              action={(item) => (
                <RowActions
                  reservation={item}
                  admittable={canCreate && canAdmitNow(item, now)}
                  canUpdate={canUpdate}
                  onOpen={(kind) => setDialog({ kind, reservation: item })}
                />
              )}
            />
          </ListState>
        </Panel>
      </PageBody>

      {requesting ? (
        <RequestBedDialog orgSlug={orgSlug} onClose={() => setRequesting(false)} />
      ) : null}
      {dialog?.kind === "admit" ? (
        <AdmitDialog
          orgSlug={orgSlug}
          bed={{
            id: dialog.reservation.bedId!,
            label: dialog.reservation.bedLabel!,
            wardName: dialog.reservation.wardName!,
            // Another hold on the bed must move first, or be released by an administrator.
            holds: (
              board.data?.beds.find((bed) => bed.id === dialog.reservation.bedId)?.holds ?? []
            ).filter((hold) => hold.reservationId !== dialog.reservation.id),
          }}
          reservation={{
            id: dialog.reservation.id,
            revision: dialog.reservation.revision,
            patient: {
              id: dialog.reservation.patientId,
              name: dialog.reservation.patientName,
              mrn: dialog.reservation.mrn,
            },
          }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "hold" ? (
        <HoldBedDialog orgSlug={orgSlug} reservation={dialog.reservation} onClose={close} />
      ) : null}
      {dialog?.kind === "dates" ? (
        <ChangeDatesDialog orgSlug={orgSlug} reservation={dialog.reservation} onClose={close} />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <CancelReservationDialog
          orgSlug={orgSlug}
          reservation={dialog.reservation}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function RowActions({
  reservation,
  admittable,
  canUpdate,
  onOpen,
}: {
  reservation: Reservation;
  admittable: boolean;
  canUpdate: boolean;
  onOpen: (kind: Dialog["kind"]) => void;
}) {
  const status = reservation.effectiveStatus;
  const needsBed = status === "requested" || status === "expired" || status === "disrupted";
  // The server reschedules only a request or a hold, lapsed or not.
  const movable = status === "requested" || status === "confirmed" || status === "expired";
  const who = reservation.patientName;

  return (
    <div className="flex items-center justify-end gap-1">
      {admittable ? (
        <Button aria-label={`Admit ${who}`} onClick={() => onOpen("admit")}>
          Admit
        </Button>
      ) : canUpdate && needsBed ? (
        <Button
          variant="outline"
          aria-label={`Hold a bed for ${who}`}
          onClick={() => onOpen("hold")}
        >
          Hold a bed
        </Button>
      ) : null}
      {canUpdate && (needsBed || movable) ? (
        <ClientOnly fallback={null}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" />}
              aria-label={`More for ${who}`}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              {movable ? (
                <DropdownMenuItem onClick={() => onOpen("dates")}>Change dates</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => onOpen("cancel")}>
                Cancel reservation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      ) : null}
    </div>
  );
}
