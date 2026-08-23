import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  OPD_STATUS_LABELS,
  OpdAppointmentStatusBadge,
  useOpdStatusActions,
} from "@/components/opd-appointment";
import { CheckInOpdAppointmentDialog } from "@/components/opd-appointment-dialogs";
import { OpdVisitSheet } from "@/components/opd-visit-sheet";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatMoney } from "@/lib/money";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatBusinessDate, formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

/** Moves the day one business date at a time without a date picker popup. */
function DayStepper({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const shift = (days: number) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        aria-label="Previous day"
        onClick={() => onChange(shift(-1))}
      >
        <ChevronLeftIcon />
      </Button>
      {date !== today && (
        <Button size="xs" variant="ghost" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
      <Input
        type="date"
        aria-label="OPD date"
        value={date}
        onChange={(event) => onChange(event.target.value || today)}
        className="h-7 w-32"
      />
      <Button size="xs" variant="ghost" aria-label="Next day" onClick={() => onChange(shift(1))}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

function OpdSearchInput({ onDebouncedChange }: { onDebouncedChange: (value: string) => void }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => onDebouncedChange(value.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [onDebouncedChange, value]);

  return (
    <div className="relative min-w-56 max-w-md flex-1">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search name, MRN, phone or token"
        aria-label="Search the OPD day"
        className="pl-8"
      />
    </div>
  );
}

/**
 * The date is a search param, not a hard-coded "today", so yesterday's list and
 * tomorrow's bookings are a filter change rather than a second page. Search and
 * `includeClosed` stay local: they are how one person reads this list right
 * now, not a place worth returning to.
 */
const opdDaySearchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const dayQuery = (orgSlug: string, date: string | undefined, q: string, includeClosed: boolean) =>
  orpc.opd.day.infiniteOptions({
    input: (cursor: { dayOrderAt: Date; id: string } | undefined) => ({
      orgSlug,
      date,
      // Absent, not empty: a blank field reads the whole day.
      q: q || undefined,
      includeClosed,
      cursor,
      limit: 100,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/opd/")({
  head: () => ({ meta: [{ title: "OPD · HMS" }] }),
  validateSearch: opdDaySearchSchema,
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: async ({ context: { queryClient }, deps: { date }, params: { orgSlug } }) => {
    await queryClient.prefetchInfiniteQuery(dayQuery(orgSlug, date, "", false));
  },
  component: OpdRoute,
});

function OpdRoute() {
  const { orgSlug } = Route.useParams();
  const { date } = Route.useSearch();
  const navigate = useNavigate();
  const { timeZone, today } = useOrgDateTime();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<{
    id: string;
    callerName: string | null;
    callerPhone: string | null;
  } | null>(null);

  const membership = useQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data?.roles;
  const currency = membership.data?.currency;
  // Registering the patient is part of the same dialog, so both grants are
  // required before offering it. Hidden until roles land, so the action never
  // appears and then disappears.
  const canCreateOpdAppointments = roles
    ? authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] })
    : false;
  const canSettleWalkIn =
    canCreateOpdAppointments && Boolean(roles && authorize(roles, { billing: ["write"] }));
  const shownDate = date ?? today;

  const day = useInfiniteQuery({
    ...dayQuery(orgSlug, date, debouncedSearch, includeClosed),
    ...OPERATIONAL_REFETCH,
    // TanStack refetches every loaded infinite-query page. Keep the live poll
    // cheap on page one; deeper browsing refreshes only when staff ask for it.
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 1 ? OPERATIONAL_REFETCH.refetchInterval : false,
    refetchOnWindowFocus: (query) => (query.state.data?.pages.length ?? 0) <= 1,
  });
  const items = day.data?.pages.flatMap((page) => page.items) ?? [];
  // Read back out of the list rather than held aside, so the panel follows the
  // poll — and closes by itself when the row it was opened on leaves the day.
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const { checkIn } = useOpdStatusActions(orgSlug);

  return (
    <>
      <PageHeader
        title="OPD"
        description={shownDate === today ? "Today" : formatBusinessDate(shownDate)}
        action={
          <div className="flex items-center gap-2">
            <StaleDataNotice dataUpdatedAt={day.dataUpdatedAt} />
            {(day.data?.pages.length ?? 0) > 1 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={day.isFetching}
                onClick={() => void day.refetch()}
              >
                Refresh
              </Button>
            ) : null}
            <DayStepper
              date={shownDate}
              today={today}
              onChange={(next) =>
                void navigate({
                  to: "/$orgSlug/opd",
                  params: { orgSlug },
                  search: { date: next === today ? undefined : next },
                })
              }
            />
            {canSettleWalkIn ? (
              <Link className={buttonVariants()} to="/$orgSlug/opd/new" params={{ orgSlug }}>
                <PlusIcon />
                New walk-in
              </Link>
            ) : null}
            {canCreateOpdAppointments ? (
              <Link
                className={buttonVariants({ variant: canSettleWalkIn ? "outline" : "default" })}
                to="/$orgSlug/opd/new"
                params={{ orgSlug }}
                search={{ mode: "scheduled" }}
              >
                Book appointment
              </Link>
            ) : null}
          </div>
        }
      />
      <PageBody>
        {/* One field over everything the counter might be told: a name, a card,
            a phone, or "I'm token 4". */}
        <div className="flex flex-wrap items-center gap-4">
          <OpdSearchInput onDebouncedChange={setDebouncedSearch} />
          <label className="flex h-8 items-center gap-2 font-medium">
            <Checkbox checked={includeClosed} onCheckedChange={setIncludeClosed} />
            Include cancelled and no shows
          </label>
        </div>

        {day.isPending ? null : day.isError ? (
          <ErrorNote title="Could not load the OPD day" detail={day.error.message} />
        ) : items.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            {debouncedSearch
              ? "Nobody in the OPD day matches this search."
              : shownDate === today
                ? "No OPD patients yet today."
                : `No OPD patients on ${formatBusinessDate(shownDate)}.`}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Time</TableHead>
                    <TableHead className="w-16">Token</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Practitioner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-28 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((appointment) => (
                    <TableRow
                      key={appointment.id}
                      // Pointing anywhere on the row opens the panel; the
                      // patient's name is the same target for the keyboard.
                      onClick={() => setSelectedId(appointment.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTime(appointment.dayOrderAt ?? appointment.createdAt, timeZone)}
                      </TableCell>
                      <TableCell>
                        {appointment.tokenNumber === null ? (
                          <span className="text-muted-foreground">·</span>
                        ) : (
                          // text-sm deviates from the type scale: the token is
                          // what desk staff and patients match at a glance.
                          <span className="font-mono text-sm font-semibold">
                            {appointment.tokenNumber}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setSelectedId(appointment.id)}
                          className="text-left font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                        </button>
                        <p className="text-muted-foreground">
                          {appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
                        </p>
                      </TableCell>
                      <TableCell>{appointment.practitionerName}</TableCell>
                      <TableCell>
                        <OpdAppointmentStatusBadge status={appointment.status} />
                      </TableCell>
                      {/* Read-only on purpose: settling is a decision that
                          belongs on the record, not on a list row. */}
                      <TableCell className="text-right">
                        {currency && Number(appointment.balanceDue) > 0 ? (
                          <Badge variant="destructive">
                            {formatMoney(appointment.balanceDue, currency)} due
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {appointment.status === "booked" ? (
                          <Button
                            size="xs"
                            disabled={checkIn.isPending}
                            onClick={(event) => {
                              // The row behind opens the panel; checking in is
                              // not that.
                              event.stopPropagation();
                              if (appointment.patientId) {
                                checkIn.mutate({ orgSlug, appointmentId: appointment.id });
                              } else {
                                setCheckingIn({
                                  id: appointment.id,
                                  callerName: appointment.callerName,
                                  callerPhone: appointment.callerPhone,
                                });
                              }
                            }}
                          >
                            Check in
                          </Button>
                        ) : appointment.status === "checked_in" ? null : (
                          <span className="text-muted-foreground">
                            {OPD_STATUS_LABELS[appointment.status]}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {day.hasNextPage ? (
              <Button
                variant="outline"
                className="self-start"
                disabled={day.isFetchingNextPage}
                onClick={() => day.fetchNextPage()}
              >
                {day.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        )}
      </PageBody>

      <OpdVisitSheet
        orgSlug={orgSlug}
        appointment={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
      <ClientOnly fallback={null}>
        {checkingIn ? (
          <CheckInOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={checkingIn.id}
            callerName={checkingIn.callerName}
            callerPhone={checkingIn.callerPhone}
            onClose={() => setCheckingIn(null)}
          />
        ) : null}
      </ClientOnly>
    </>
  );
}
