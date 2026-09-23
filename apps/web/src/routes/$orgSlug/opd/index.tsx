import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { OpdAppointmentStatusBadge, useOpdCheckIn } from "@/components/opd-appointment";
import { CheckInOpdAppointmentDialog } from "@/components/opd-appointment-dialogs";
import { followUpsQuery, OpdFollowUps } from "@/components/opd-follow-ups";
import {
  DateRangePopover,
  DateSubmenu,
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { dateRangeLabel } from "@/lib/date-presets";
import { formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

const STATUS_LABELS = { all: "All", "follow-ups": "Follow-ups" } as const;

const opdDaySearchSchema = z.object({
  // Absent is the current day, which the server resolves; the URL stays clean for it.
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  q: z.string().trim().min(1).max(100).optional().catch(undefined),
  // Absent is the open queue. Follow-ups lists due treatment plans instead of the day.
  status: z.enum(["all", "follow-ups"]).optional().catch(undefined),
});

const dayQuery = (
  orgSlug: string,
  range: { from?: string; to?: string },
  q: string,
  includeClosed: boolean,
) =>
  orpc.opd.day.infiniteOptions({
    input: (cursor: { dayOrderAt: Date; id: string } | undefined) => ({
      orgSlug,
      from: range.from,
      to: range.to,
      // Absent, not empty: a blank field reads the whole day.
      q: q || undefined,
      includeClosed,
      cursor,
      limit: 100,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Typing keeps the day on screen; a blank queue between keystrokes reads as
    // "nobody is waiting".
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/opd/")({
  head: () => ({ meta: [{ title: "Outpatient · HMS" }] }),
  validateSearch: opdDaySearchSchema,
  loaderDeps: ({ search: { from, to, q, status } }) => ({ from, to, q, status }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const { roles } = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));

    // A hand-typed `?status=follow-ups` without the grant is dropped from the URL, so
    // every reader below sees one status.
    if (deps.status === "follow-ups" && !authorize(roles, { treatment: ["read"] })) {
      throw redirect({
        to: "/$orgSlug/opd",
        params: { orgSlug },
        search: { ...deps, status: undefined },
        replace: true,
      });
    }

    // Whichever list the URL names arrives with the page, never after it.
    await (
      deps.status === "follow-ups"
        ? queryClient.infiniteQuery(followUpsQuery(orgSlug, deps.q ?? ""))
        : queryClient.infiniteQuery(dayQuery(orgSlug, deps, deps.q ?? "", deps.status === "all"))
    ).catch(() => {});
  },
  component: OpdRoute,
});

function OpdStatusCell({
  orgSlug,
  appointmentId,
  patientId,
  callerName,
  callerPhone,
  status,
}: {
  orgSlug: string;
  appointmentId: string;
  patientId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  status: "booked" | "checked_in" | "cancelled" | "no_show";
}) {
  const [checkingIn, setCheckingIn] = useState(false);
  const checkIn = useOpdCheckIn();
  // Cashiers and accountants read the queue; checking in needs `opd:update`.
  const canUpdate = useCan(orgSlug, { opd: ["update"] });

  return (
    <>
      {status === "booked" && canUpdate ? (
        <Button
          size="xs"
          className="relative"
          disabled={checkIn.isPending}
          onClick={() => {
            if (patientId) {
              checkIn.mutate({ orgSlug, appointmentId });
            } else {
              setCheckingIn(true);
            }
          }}
        >
          Check in
        </Button>
      ) : (
        <OpdAppointmentStatusBadge status={status} />
      )}

      <ClientOnly fallback={null}>
        {checkingIn ? (
          <CheckInOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            callerName={callerName}
            callerPhone={callerPhone}
            onClose={() => setCheckingIn(false)}
          />
        ) : null}
      </ClientOnly>
    </>
  );
}

function OpdAppointments({ orgSlug, search }: { orgSlug: string; search: string }) {
  const { from, to, status } = Route.useSearch();
  const { timeZone, today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const day = useInfiniteQuery({
    ...dayQuery(orgSlug, { from, to }, search, status === "all"),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const items = day.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel
      minHeight="min-h-64"
      grow
      // Polling stops once a second page loads, so the notice and Refresh sit with Load more.
      footer={
        <div className="flex items-center gap-2 pr-3">
          <div className="min-w-0 flex-1">
            <LoadMore query={day} shown={items.length} />
          </div>
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
        </div>
      }
    >
      <ListState
        query={day}
        errorTitle="Could not load the outpatient day"
        isEmpty={items.length === 0}
        empty={
          search
            ? "No appointments match this search."
            : `No appointments ${dateRangeLabel(today, from, to, "Today").toLowerCase()}.`
        }
      >
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="w-20">Time</TableHead>
                  <TableHead>Practitioner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((appointment) => (
                  <TableRow key={appointment.id} className="relative">
                    <TableCell>
                      {appointment.tokenNumber === null ? (
                        <span className="text-muted-foreground">·</span>
                      ) : (
                        <span className="font-mono text-sm font-semibold">
                          {appointment.tokenNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <Link
                        to="/$orgSlug/opd/$appointmentId"
                        params={{ orgSlug, appointmentId: appointment.id }}
                        title={
                          appointment.patientName ?? appointment.callerName ?? "Unnamed caller"
                        }
                        className="block truncate text-left font-medium capitalize underline-offset-4 after:absolute after:inset-0 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                      </Link>
                      <p
                        className="truncate text-muted-foreground"
                        title={appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
                      >
                        {appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTime(appointment.dayOrderAt ?? appointment.createdAt, timeZone)}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <div
                        className="truncate capitalize"
                        title={practitionerDisplayName(appointment.practitionerName)}
                      >
                        {practitionerDisplayName(appointment.practitionerName)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <OpdStatusCell
                        orgSlug={orgSlug}
                        appointmentId={appointment.id}
                        patientId={appointment.patientId}
                        callerName={appointment.callerName}
                        callerPhone={appointment.callerPhone}
                        status={appointment.status}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {appointment.balanceDue > ZERO ? (
                        <Badge variant="destructive">
                          {formatMoney(appointment.balanceDue, currency)} due
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="md:hidden">
            {items.map((appointment) => (
              <li key={appointment.id} className="border-b text-xs">
                <div className="flex min-w-0 items-start">
                  <Link
                    to="/$orgSlug/opd/$appointmentId"
                    params={{ orgSlug, appointmentId: appointment.id }}
                    title={appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                    className="block min-h-10 min-w-0 flex-1 px-3 py-2 underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {appointment.tokenNumber === null ? (
                        <span className="shrink-0 font-mono text-muted-foreground">·</span>
                      ) : (
                        <span className="shrink-0 font-mono font-semibold">
                          {appointment.tokenNumber}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium capitalize">
                        {appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-muted-foreground">
                      {formatTime(appointment.dayOrderAt ?? appointment.createdAt, timeZone)}
                      {" · "}
                      <span className="capitalize">
                        {practitionerDisplayName(appointment.practitionerName)}
                      </span>
                    </span>
                    {appointment.balanceDue > ZERO ? (
                      <span className="mt-1 block font-medium text-destructive">
                        {formatMoney(appointment.balanceDue, currency)} due
                      </span>
                    ) : null}
                  </Link>
                  <div className="shrink-0 py-2 pr-3">
                    <OpdStatusCell
                      orgSlug={orgSlug}
                      appointmentId={appointment.id}
                      patientId={appointment.patientId}
                      callerName={appointment.callerName}
                      callerPhone={appointment.callerPhone}
                      status={appointment.status}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      </ListState>
    </Panel>
  );
}

// The applied search lives in the URL, so a reload and the Back button keep the queue.
function OpdDeskView({
  orgSlug,
  followUps,
  canReadTreatment,
}: {
  orgSlug: string;
  followUps: boolean;
  canReadTreatment: boolean;
}) {
  const filters = Route.useSearch();
  const navigate = useNavigate();
  const { today } = useOrgDateTime();
  const field = useRef<HTMLDivElement>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const search = filters.q ?? "";
  const statuses = canReadTreatment ? (["all", "follow-ups"] as const) : (["all"] as const);

  const setFilters = (patch: {
    q?: string;
    status?: "all" | "follow-ups";
    from?: string;
    to?: string;
  }) =>
    navigate({
      to: "/$orgSlug/opd",
      params: { orgSlug },
      search: (previous) => ({ ...previous, ...patch }),
      replace: true,
    });

  // Today is the queue's resting state and the server's own default, so it leaves the URL.
  const setRange = (range: { from?: string; to?: string }) =>
    setFilters(
      range.from === today && range.to === today ? { from: undefined, to: undefined } : range,
    );

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, status: undefined, from: undefined, to: undefined });
  };

  const chips: ActiveFilter[] = [
    ...(filters.status === undefined
      ? []
      : [
          {
            id: "status",
            name: "Status",
            label: STATUS_LABELS[filters.status],
            remove: () => setFilters({ status: undefined }),
          },
        ]),
    // The call sheet is not a day's list, so it never carries a date chip.
    ...(followUps || (filters.from === undefined && filters.to === undefined)
      ? []
      : [
          {
            id: "date",
            name: "Date",
            label: dateRangeLabel(today, filters.from, filters.to, "Today"),
            remove: () => setFilters({ from: undefined, to: undefined }),
          },
        ]),
  ];

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search outpatient"
          placeholder={
            followUps ? "Search patient, MRN or phone" : "Search name, MRN, phone or token"
          }
          value={filters.q}
          fieldRef={field}
          onQueryChange={(next) => void setFilters({ q: next || undefined })}
          trailing={
            <FilterMenu anchor={field} active={chips.length > 0}>
              {followUps ? null : (
                <DateSubmenu
                  today={today}
                  from={filters.from ?? today}
                  to={filters.to ?? today}
                  onChange={(range) => void setRange(range)}
                  onCustom={() => setRangeOpen(true)}
                />
              )}
              <FilterSubmenu icon={CircleDotIcon} label="Status">
                {statuses.map((candidate) => (
                  <DropdownMenuCheckboxItem
                    key={candidate}
                    checked={filters.status === candidate}
                    onCheckedChange={(checked) =>
                      void setFilters({ status: checked ? candidate : undefined })
                    }
                  >
                    {STATUS_LABELS[candidate]}
                  </DropdownMenuCheckboxItem>
                ))}
              </FilterSubmenu>
            </FilterMenu>
          }
        />
        <FilterChips filters={chips} field={field} onClear={clear} />
        <DateRangePopover
          open={rangeOpen}
          onOpenChange={setRangeOpen}
          anchor={field}
          from={filters.from}
          to={filters.to}
          today={today}
          onApply={(range) => void setRange(range)}
        />
      </ListToolbar>
      {followUps ? (
        <OpdFollowUps orgSlug={orgSlug} search={search} />
      ) : (
        // A new day or filter remounts the list, so another queue's rows and their check-in
        // controls never stand in while it loads; only typing keeps previous rows (D037).
        <OpdAppointments
          key={`${filters.from ?? ""}:${filters.to ?? ""}:${filters.status ?? ""}`}
          orgSlug={orgSlug}
          search={search}
        />
      )}
    </PageBody>
  );
}

function NewAppointmentLink({ orgSlug }: { orgSlug: string }) {
  return (
    <Link className={buttonVariants()} to="/$orgSlug/opd/new" params={{ orgSlug }}>
      <PlusIcon data-icon="inline-start" />
      <span className="sm:hidden">New</span>
      <span className="hidden sm:inline">New appointment</span>
    </Link>
  );
}

// The day is a filter now, so the header carries only the action.
function OpdHeader({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);

  // Registering the patient is part of the same intake, so both grants are required.
  const canCreateOpdAppointments =
    authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] });

  return (
    <PageHeader
      title="Outpatient"
      action={canCreateOpdAppointments ? <NewAppointmentLink orgSlug={orgSlug} /> : null}
    />
  );
}

function OpdRoute() {
  const { orgSlug } = Route.useParams();
  const status = Route.useSearch({ select: (search) => search.status });
  const canReadTreatment = useCan(orgSlug, { treatment: ["read"] });
  const followUps = status === "follow-ups";

  return (
    <>
      <OpdHeader orgSlug={orgSlug} />
      <OpdDeskView
        key={orgSlug}
        orgSlug={orgSlug}
        followUps={followUps}
        canReadTreatment={canReadTreatment}
      />
    </>
  );
}
