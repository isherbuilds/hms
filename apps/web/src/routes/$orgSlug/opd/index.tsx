import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { OpdAppointmentStatusBadge, useOpdCheckIn } from "@/components/opd-appointment";
import { CheckInOpdAppointmentDialog } from "@/components/opd-appointment-dialogs";
import { followUpsQuery, OpdFollowUps } from "@/components/opd-follow-ups";
import {
  FilterGroup,
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
import { formatBusinessDate, formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

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
        size="icon-sm"
        variant="ghost"
        aria-label="Previous day"
        onClick={() => onChange(shift(-1))}
      >
        <ChevronLeftIcon />
      </Button>
      {date !== today && (
        <Button size="sm" variant="ghost" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
      <Input
        type="date"
        aria-label="Outpatient date"
        value={date}
        onChange={(event) => onChange(event.target.value || today)}
        className="h-7 w-32"
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next day"
        onClick={() => onChange(shift(1))}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

const opdDaySearchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  // Absent is the open queue. Follow-ups lists due treatment plans instead of the day.
  status: z.enum(["all", "follow-ups"]).optional().catch(undefined),
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
    // Typing keeps the day on screen; a blank queue between keystrokes reads as
    // "nobody is waiting".
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/opd/")({
  head: () => ({ meta: [{ title: "Outpatient · HMS" }] }),
  validateSearch: opdDaySearchSchema,
  loaderDeps: ({ search: { date, status } }) => ({ date, status }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const { roles } = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));

    // Whichever list the URL names arrives with the page, never after it.
    await (
      deps.status === "follow-ups" && authorize(roles, { treatment: ["read"] })
        ? queryClient.infiniteQuery(followUpsQuery(orgSlug, ""))
        : queryClient.infiniteQuery(dayQuery(orgSlug, deps.date, "", deps.status === "all"))
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
  const { date, status } = Route.useSearch();
  const { timeZone, today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const shownDate = date ?? today;

  const day = useInfiniteQuery({
    ...dayQuery(orgSlug, date, search, status === "all"),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const items = day.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel
      label="Appointments"
      minHeight="min-h-64"
      grow
      action={
        <div className="flex items-center gap-2">
          <StaleDataNotice dataUpdatedAt={day.dataUpdatedAt} />
          {(day.data?.pages.length ?? 0) > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={day.isFetching}
              onClick={() => void day.refetch()}
            >
              Refresh
            </Button>
          ) : null}
        </div>
      }
      footer={<LoadMore query={day} shown={items.length} />}
    >
      <ListState
        query={day}
        errorTitle="Could not load the outpatient day"
        isEmpty={items.length === 0}
        empty={
          search
            ? "No appointments match this search."
            : shownDate === today
              ? "No appointments today."
              : `No appointments on ${formatBusinessDate(shownDate)}.`
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
                  <TableRow key={appointment.id}>
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
                        className="block truncate text-left font-medium capitalize underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
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

// Owns the settled search term so the page header above never sees a keystroke.
function OpdDeskView({
  orgSlug,
  followUps,
  canReadTreatment,
}: {
  orgSlug: string;
  followUps: boolean;
  canReadTreatment: boolean;
}) {
  const [search, setSearch] = useState("");
  const filters = Route.useSearch();
  const navigate = useNavigate();

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search outpatient"
          placeholder={
            followUps ? "Search patient, MRN or phone" : "Search name, MRN, phone or token"
          }
          onQueryChange={setSearch}
        />
        <FilterGroup
          label="Status"
          value={followUps ? "follow-ups" : filters.status === "all" ? "all" : "open"}
          options={[
            { value: "open", label: "Open" },
            { value: "all", label: "All" },
            ...(canReadTreatment ? [{ value: "follow-ups", label: "Follow-ups" }] : []),
          ]}
          onValueChange={(next) =>
            void navigate({
              to: "/$orgSlug/opd",
              params: { orgSlug },
              search: {
                ...filters,
                status: next === "all" || next === "follow-ups" ? next : undefined,
              },
              replace: true,
            })
          }
        />
      </ListToolbar>
      {followUps ? (
        <OpdFollowUps orgSlug={orgSlug} search={search} />
      ) : (
        <OpdAppointments orgSlug={orgSlug} search={search} />
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

function OpdHeader({ orgSlug, showDay }: { orgSlug: string; showDay: boolean }) {
  const filters = Route.useSearch();
  const navigate = useNavigate();
  const { today } = useOrgDateTime();
  const roles = useMembership(orgSlug, (membership) => membership.roles);

  // Registering the patient is part of the same intake, so both grants are required.
  const canCreateOpdAppointments =
    authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] });

  const shownDate = filters.date ?? today;

  return (
    <>
      <PageHeader
        title="Outpatient"
        action={
          <>
            {/* A day belongs to the queue; the call sheet is not a day's list. */}
            {showDay ? (
              <DayStepper
                date={shownDate}
                today={today}
                onChange={(next) =>
                  void navigate({
                    to: "/$orgSlug/opd",
                    params: { orgSlug },
                    search: { ...filters, date: next === today ? undefined : next },
                  })
                }
              />
            ) : null}
            {canCreateOpdAppointments ? <NewAppointmentLink orgSlug={orgSlug} /> : null}
          </>
        }
      />
    </>
  );
}

function OpdRoute() {
  const { orgSlug } = Route.useParams();
  const status = Route.useSearch({ select: (search) => search.status });
  const canReadTreatment = useCan(orgSlug, { treatment: ["read"] });
  // A hand-typed `?status=follow-ups` without the grant falls back to the open queue.
  const followUps = status === "follow-ups" && canReadTreatment;

  return (
    <>
      <OpdHeader orgSlug={orgSlug} showDay={!followUps} />
      <OpdDeskView
        key={orgSlug}
        orgSlug={orgSlug}
        followUps={followUps}
        canReadTreatment={canReadTreatment}
      />
    </>
  );
}
