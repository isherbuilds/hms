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
import { useInfiniteQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { OpdAppointmentStatusBadge, useOpdCheckIn } from "@/components/opd-appointment";
import { CheckInOpdAppointmentDialog } from "@/components/opd-appointment-dialogs";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { formatBusinessDate, formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

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

function OpdSearchInput({ onDebouncedChange }: { onDebouncedChange: (value: string) => void }) {
  const handleChange = useDebouncedCallback(onDebouncedChange, 300);

  return (
    <div className="relative min-w-56 max-w-md flex-1">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        onChange={(event) => handleChange(event.currentTarget.value.trim())}
        placeholder="Search name, MRN, phone or token"
        aria-label="Search outpatient appointments"
        className="pl-8"
      />
    </div>
  );
}

const opdDaySearchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  includeClosed: z.boolean().optional().catch(undefined),
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
  head: () => ({ meta: [{ title: "Outpatient · HMS" }] }),
  validateSearch: opdDaySearchSchema,
  loaderDeps: ({ search: { date, includeClosed } }) => ({ date, includeClosed }),
  loader: async ({
    context: { queryClient },
    deps: { date, includeClosed },
    params: { orgSlug },
  }) => {
    await queryClient
      .infiniteQuery(dayQuery(orgSlug, date, "", includeClosed ?? false))
      .catch(() => {});
  },
  component: OpdRoute,
});

function OpdClosedFilter({ orgSlug }: { orgSlug: string }) {
  const { date, includeClosed } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <label className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 font-medium">
      <Checkbox
        checked={includeClosed ?? false}
        onCheckedChange={(checked) =>
          void navigate({
            to: "/$orgSlug/opd",
            params: { orgSlug },
            search: { date, includeClosed: checked ? true : undefined },
            replace: true,
          })
        }
      />
      Include cancelled and no shows
    </label>
  );
}

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
  const checkIn = useOpdCheckIn(orgSlug);

  return (
    <>
      {status === "booked" ? (
        <Button
          size="xs"
          disabled={checkIn.isPending}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
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
  const navigate = useNavigate();
  const { date, includeClosed } = Route.useSearch();
  const { timeZone, today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const shownDate = date ?? today;
  const day = useInfiniteQuery({
    ...dayQuery(orgSlug, date, search, includeClosed ?? false),
    ...OPERATIONAL_INFINITE_REFETCH,
  });
  const items = day.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <section className="flex min-h-64 flex-1 flex-col rounded-xl bg-muted p-1">
        <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
          <span className="min-w-0 truncate">Appointments</span>
          <div className="ml-auto flex items-center gap-2">
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
        </div>
        <div className="min-h-64 flex-1 overflow-x-auto rounded-lg border border-border bg-card">
          {day.isPending ? null : day.isError ? (
            <ErrorNote title="Could not load the outpatient day" error={day.error} inset />
          ) : items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center px-4 text-center text-muted-foreground">
              {search
                ? "No appointments match this search."
                : shownDate === today
                  ? "No appointments today."
                  : `No appointments on ${formatBusinessDate(shownDate)}.`}
            </div>
          ) : (
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
                  <TableRow
                    key={appointment.id}
                    tabIndex={0}
                    onClick={() =>
                      void navigate({
                        to: "/$orgSlug/opd/$appointmentId",
                        params: { orgSlug, appointmentId: appointment.id },
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void navigate({
                        to: "/$orgSlug/opd/$appointmentId",
                        params: { orgSlug, appointmentId: appointment.id },
                      });
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      {appointment.tokenNumber === null ? (
                        <span className="text-muted-foreground">·</span>
                      ) : (
                        <span className="font-mono text-sm font-semibold">
                          {appointment.tokenNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/$orgSlug/opd/$appointmentId"
                        params={{ orgSlug, appointmentId: appointment.id }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="text-left font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                      </Link>
                      <p className="text-muted-foreground">
                        {appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTime(appointment.dayOrderAt ?? appointment.createdAt, timeZone)}
                    </TableCell>
                    <TableCell>{appointment.practitionerName}</TableCell>
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
                      {currency && Number(appointment.balanceDue) > 0 ? (
                        <Badge variant="destructive">
                          {formatMoney(appointment.balanceDue, currency)} due
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {!day.isError && items.length > 0 && day.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={day.isFetchingNextPage}
          onClick={() => day.fetchNextPage()}
        >
          {day.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}

// Owns the settled search term so the page header above never sees a keystroke.
// The input takes only the stable setter, so it is skipped on re-render.
function OpdDayView({ orgSlug }: { orgSlug: string }) {
  const [search, setSearch] = useState("");

  return (
    <PageBody>
      <div className="flex flex-wrap items-center gap-2">
        <OpdSearchInput onDebouncedChange={setSearch} />
        <OpdClosedFilter orgSlug={orgSlug} />
      </div>
      <OpdAppointments orgSlug={orgSlug} search={search} />
    </PageBody>
  );
}

function NewAppointmentLink({ orgSlug }: { orgSlug: string }) {
  const includeClosed = Route.useSearch({ select: (search) => search.includeClosed });

  return (
    <Link
      className={buttonVariants()}
      to="/$orgSlug/opd/new"
      params={{ orgSlug }}
      search={{ includeClosed: includeClosed ? true : undefined }}
    >
      <PlusIcon data-icon="inline-start" />
      <span className="sm:hidden">New</span>
      <span className="hidden sm:inline">New appointment</span>
    </Link>
  );
}

function OpdHeader({ orgSlug }: { orgSlug: string }) {
  const date = Route.useSearch({ select: (search) => search.date });
  const navigate = useNavigate();
  const { today } = useOrgDateTime();
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  // Registering the patient is part of the same intake, so both grants are required.
  const canCreateOpdAppointments =
    authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] });
  const shownDate = date ?? today;

  return (
    <>
      <PageHeader
        title="Outpatient"
        action={
          <>
            <DayStepper
              date={shownDate}
              today={today}
              onChange={(next) =>
                void navigate({
                  to: "/$orgSlug/opd",
                  params: { orgSlug },
                  search: (previous) => ({
                    ...previous,
                    date: next === today ? undefined : next,
                  }),
                })
              }
            />
            {canCreateOpdAppointments ? <NewAppointmentLink orgSlug={orgSlug} /> : null}
          </>
        }
      />
    </>
  );
}

function OpdRoute() {
  const { orgSlug } = Route.useParams();

  return (
    <>
      <OpdHeader orgSlug={orgSlug} />
      <OpdDayView key={orgSlug} orgSlug={orgSlug} />
    </>
  );
}
