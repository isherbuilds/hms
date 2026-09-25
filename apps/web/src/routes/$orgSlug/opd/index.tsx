import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { opdQueueColumns, useOpdCheckIn } from "@/components/opd-appointment";
import { CheckInOpdAppointmentDialog } from "@/components/opd-appointment-dialogs";
import { followUpsQuery, OpdFollowUps } from "@/components/opd-follow-ups";
import {
  DateRangePopover,
  DateSubmenu,
  FilterChips,
  FilterMenu,
  OptionFilter,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import {
  DataList,
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

function OpdCheckInAction({
  orgSlug,
  appointmentId,
  patientId,
  callerName,
  callerPhone,
}: {
  orgSlug: string;
  appointmentId: string;
  patientId: string | null;
  callerName: string | null;
  callerPhone: string | null;
}) {
  const [checkingIn, setCheckingIn] = useState(false);
  const checkIn = useOpdCheckIn();

  return (
    <>
      <Button
        size="xs"
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
  // Cashiers and accountants read the queue; checking in needs `opd:update`.
  const canUpdate = useCan(orgSlug, { opd: ["update"] });

  const day = useInfiniteQuery({
    ...dayQuery(orgSlug, { from, to }, search, status === "all"),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const items = day.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel
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
            ? "No matching appointments"
            : `No appointments ${dateRangeLabel(today, from, to, "Today").toLowerCase()}`
        }
      >
        <DataList
          columns={[
            ...opdQueueColumns({
              head: "Time",
              cell: (appointment) => (
                <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatTime(appointment.dayOrderAt ?? appointment.createdAt, timeZone)}
                </span>
              ),
              className: "w-20",
            }),
            {
              head: "Balance",
              cell: (appointment) =>
                appointment.balanceDue > ZERO ? (
                  <Badge variant="destructive" className="tabular-nums">
                    {formatMoney(appointment.balanceDue, currency)} due
                  </Badge>
                ) : null,
              className: "text-right",
              mobile: "title",
            },
          ]}
          rows={items}
          rowKey={(appointment) => appointment.id}
          link={(appointment) => ({
            to: "/$orgSlug/opd/$appointmentId",
            params: { orgSlug, appointmentId: appointment.id },
          })}
          action={
            canUpdate && items.some((appointment) => appointment.status === "booked")
              ? (appointment) =>
                  appointment.status === "booked" ? (
                    <OpdCheckInAction
                      orgSlug={orgSlug}
                      appointmentId={appointment.id}
                      patientId={appointment.patientId}
                      callerName={appointment.callerName}
                      callerPhone={appointment.callerPhone}
                    />
                  ) : null
              : undefined
          }
        />
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
          placeholder={followUps ? "Patient, MRN, or phone" : "Name, MRN, phone, or token"}
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
              <OptionFilter
                icon={CircleDotIcon}
                label="Status"
                options={statuses}
                labels={STATUS_LABELS}
                value={filters.status}
                onChange={(value) => void setFilters({ status: value })}
              />
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
