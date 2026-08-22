import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import {
  BookOpdAppointmentDialog,
  CheckInOpdAppointmentDialog,
  RescheduleOpdAppointmentDialog,
} from "@/components/book-opd-appointment-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { NewOpdWalkInDialog } from "@/components/new-opd-walk-in-dialog";
import {
  CancelOpdAppointmentDialog,
  MarkLeftUnseenOpdAppointmentDialog,
  OpdAppointmentStatusBadge,
  useOpdStatusActions,
} from "@/components/opd-appointment";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatBusinessDate, formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";

/** Moves the queue one business day at a time without a date picker popup. */
function DayStepper({
  date,
  today,
  allowFuture = false,
  onChange,
}: {
  date: string;
  today: string;
  allowFuture?: boolean;
  onChange: (date: string) => void;
}) {
  const shift = (days: number) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };

  return (
    <div className="flex items-center gap-0.5">
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
        max={allowFuture ? undefined : today}
        onChange={(event) => onChange(event.target.value || today)}
        className="h-7 w-32"
      />
      <Button
        size="xs"
        variant="ghost"
        aria-label="Next day"
        disabled={!allowFuture && date >= today}
        onClick={() => onChange(shift(1))}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/**
 * The date is a search param, not a hard-coded "today". The queue is the
 * default *view* of appointments, not the only thing this page can ever show — so
 * history (and, later, an appointment checking in on another day) is a filter
 * change rather than a second page.
 */
const appointmentSearchSchema = z.object({
  view: z.enum(["queue", "appointments"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const queueQuery = (
  orgSlug: string,
  date: string | undefined,
  departmentId = "",
  practitionerId = "",
  includeClosed = false,
) =>
  orpc.opd.queue.infiniteOptions({
    input: (cursor: { arrivedAt: Date; id: string } | undefined) => ({
      orgSlug,
      date,
      departmentId: departmentId || undefined,
      practitionerId: practitionerId || undefined,
      includeClosed,
      cursor,
      limit: 100,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

const appointmentsQuery = (orgSlug: string, date: string | undefined) =>
  orpc.opd.appointments.infiniteOptions({
    input: (cursor: { scheduledFor: Date; id: string } | undefined) => ({
      orgSlug,
      date,
      cursor,
      limit: 100,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/opd/")({
  head: () => ({ meta: [{ title: "OPD · HMS" }] }),
  validateSearch: appointmentSearchSchema,
  loaderDeps: ({ search: { date, view } }) => ({ date, view }),
  loader: async ({ context: { queryClient }, deps: { date, view }, params: { orgSlug } }) => {
    // The filter dropdowns don't depend on the queue, so start them before
    // awaiting it and let all three requests overlap.
    const staffLists = Promise.all([
      queryClient.prefetchQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
    ]);
    if (view === "appointments") {
      await queryClient.prefetchInfiniteQuery(appointmentsQuery(orgSlug, date));
    } else {
      await queryClient.prefetchInfiniteQuery(queueQuery(orgSlug, date));
    }
    await staffLists;
  },
  component: OpdRoute,
});

function OpdRoute() {
  const { orgSlug } = Route.useParams();
  const { date, view: searchView } = Route.useSearch();
  const view = searchView ?? "queue";
  const navigate = useNavigate();
  const [newOpdAppointmentOpen, setNewOpdAppointmentOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState<{
    id: string;
    callerName: string | null;
    callerPhone: string | null;
  } | null>(null);
  const [rescheduling, setRescheduling] = useState<{
    id: string;
    scheduledFor: Date | string | null;
  } | null>(null);
  const [leavingOpdAppointmentId, setLeavingOpdAppointmentId] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [departmentId, setDepartmentId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const { timeZone, today } = useOrgDateTime();
  const membership = useQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data?.roles;
  // Registering the patient is part of the same dialog, so both grants are
  // required before offering it. Hidden until roles land, so the action never
  // appears and then disappears.
  const canCreateOpdAppointments = roles
    ? authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] })
    : false;
  const shownDate = date ?? today;
  const hasQueueFilters = Boolean(departmentId || practitionerId);
  const [cancellingOpdAppointmentId, setCancellingOpdAppointmentId] = useState<string | null>(null);

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const queue = useInfiniteQuery({
    ...queueQuery(orgSlug, date, departmentId, practitionerId, includeClosed),
    ...OPERATIONAL_REFETCH,
    // Only the visible view polls; the hidden one would double the request load.
    enabled: view === "queue",
    // TanStack refetches every loaded infinite-query page. Keep the live poll
    // cheap on page one; deeper browsing refreshes only when staff ask for it.
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 1 ? OPERATIONAL_REFETCH.refetchInterval : false,
    refetchOnWindowFocus: (query) => (query.state.data?.pages.length ?? 0) <= 1,
  });
  const appointments = useInfiniteQuery({
    ...appointmentsQuery(orgSlug, date),
    ...OPERATIONAL_REFETCH,
    enabled: view === "appointments",
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 1 ? OPERATIONAL_REFETCH.refetchInterval : false,
    refetchOnWindowFocus: (query) => (query.state.data?.pages.length ?? 0) <= 1,
  });
  const queueItems = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const appointmentItems = appointments.data?.pages.flatMap((page) => page.items) ?? [];
  const displayedUpdatedAt = view === "queue" ? queue.dataUpdatedAt : appointments.dataUpdatedAt;
  const displayedPageCount =
    view === "queue" ? (queue.data?.pages.length ?? 0) : (appointments.data?.pages.length ?? 0);
  const displayedIsFetching = view === "queue" ? queue.isFetching : appointments.isFetching;

  const { startConsultation, complete, checkIn, markNoShow } = useOpdStatusActions(orgSlug);
  const changingStatus = startConsultation.isPending || complete.isPending;

  return (
    <>
      <PageHeader
        title="OPD"
        description={shownDate === today ? "Today" : formatBusinessDate(shownDate)}
        action={
          <div className="flex items-center gap-2">
            <StaleDataNotice dataUpdatedAt={displayedUpdatedAt} />
            {displayedPageCount > 1 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={displayedIsFetching}
                onClick={() => void (view === "queue" ? queue.refetch() : appointments.refetch())}
              >
                Refresh
              </Button>
            ) : null}
            <DayStepper
              date={shownDate}
              today={today}
              allowFuture={view === "appointments"}
              onChange={(next) =>
                void navigate({
                  to: "/$orgSlug/opd",
                  params: { orgSlug },
                  search: {
                    view: view === "queue" ? undefined : view,
                    date: next === today ? undefined : next,
                  },
                })
              }
            />
            {canCreateOpdAppointments && view === "queue" ? (
              <Button onClick={() => setNewOpdAppointmentOpen(true)}>
                <PlusIcon />
                New walk-in
              </Button>
            ) : canCreateOpdAppointments ? (
              <Button onClick={() => setBookingOpen(true)}>
                <PlusIcon />
                Book appointment
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <nav aria-label="OPD views" className="flex border-b border-border">
          {(["queue", "appointments"] as const).map((target) => (
            <button
              key={target}
              type="button"
              aria-current={view === target ? "page" : undefined}
              onClick={() =>
                void navigate({
                  to: "/$orgSlug/opd",
                  params: { orgSlug },
                  search: { view: target === "queue" ? undefined : target, date },
                })
              }
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-xs font-medium capitalize text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
            >
              {target}
            </button>
          ))}
        </nav>

        {view === "queue" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex w-52 flex-col gap-1.5 text-xs font-medium">
                Department
                <NativeSelect
                  value={departmentId}
                  onChange={(event) => {
                    setDepartmentId(event.target.value);
                    if (
                      practitionerId &&
                      practitioners.data?.find((item) => item.id === practitionerId)
                        ?.departmentId !== event.target.value
                    ) {
                      setPractitionerId("");
                    }
                  }}
                >
                  <option value="">All departments</option>
                  {(departments.data ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex w-52 flex-col gap-1.5 text-xs font-medium">
                Practitioner
                <NativeSelect
                  value={practitionerId}
                  onChange={(event) => setPractitionerId(event.target.value)}
                >
                  <option value="">All practitioners</option>
                  {(practitioners.data ?? [])
                    .filter((item) => !departmentId || item.departmentId === departmentId)
                    .map((practitioner) => (
                      <option key={practitioner.id} value={practitioner.id}>
                        {practitioner.name}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              <label className="flex h-8 items-center gap-2 text-xs font-medium">
                <Checkbox checked={includeClosed} onCheckedChange={setIncludeClosed} />
                Include completed and cancelled
              </label>
            </div>

            {queue.isPending ? (
              <div role="status" aria-label="Loading OPD queue" className="h-40 bg-muted" />
            ) : queue.isError ? (
              <ErrorNote title="Could not load queue" detail={queue.error.message} />
            ) : queueItems.length === 0 ? (
              <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
                {hasQueueFilters
                  ? "No patients match these filters."
                  : shownDate === today
                    ? "No OPD patients yet today."
                    : `No OPD patients on ${formatBusinessDate(shownDate)}.`}
              </div>
            ) : (
              /* Same shell as the dashboard's panels: muted tray, card inside. */
              <div className="flex flex-col rounded-xl bg-muted p-1">
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Token</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Practitioner</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Arrived</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queueItems.map((appointment) => (
                        <TableRow key={appointment.id}>
                          <TableCell>
                            <Link
                              to="/$orgSlug/opd/$appointmentId"
                              params={{ orgSlug, appointmentId: appointment.id }}
                              // text-base deviates from the type scale: desk staff read tokens at a glance.
                              className="font-mono text-base font-semibold tabular-nums underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                            >
                              {appointment.tokenNumber}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link
                              to="/$orgSlug/opd/$appointmentId"
                              params={{ orgSlug, appointmentId: appointment.id }}
                              className="font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                            >
                              {appointment.patientName}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {appointment.patientMrn}
                            </p>
                          </TableCell>
                          <TableCell>{appointment.practitionerName}</TableCell>
                          <TableCell>{appointment.departmentName}</TableCell>
                          <TableCell>
                            <OpdAppointmentStatusBadge status={appointment.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatTime(appointment.arrivedAt ?? appointment.createdAt, timeZone)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {appointment.status === "waiting" ? (
                                <>
                                  <Button
                                    size="xs"
                                    disabled={changingStatus}
                                    onClick={() =>
                                      startConsultation.mutate({
                                        orgSlug,
                                        appointmentId: appointment.id,
                                      })
                                    }
                                  >
                                    Start consult
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={changingStatus}
                                    onClick={() => setLeavingOpdAppointmentId(appointment.id)}
                                  >
                                    Left unseen
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={changingStatus}
                                    onClick={() => setCancellingOpdAppointmentId(appointment.id)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : appointment.status === "in_consult" ? (
                                <Button
                                  size="xs"
                                  disabled={changingStatus}
                                  onClick={() =>
                                    complete.mutate({
                                      orgSlug,
                                      appointmentId: appointment.id,
                                    })
                                  }
                                >
                                  Complete
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {queue.hasNextPage ? (
                  <Button
                    variant="outline"
                    className="mt-3 self-start"
                    disabled={queue.isFetchingNextPage}
                    onClick={() => queue.fetchNextPage()}
                  >
                    {queue.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </div>
            )}
          </>
        ) : appointments.isPending ? (
          <div role="status" aria-label="Loading appointments" className="h-40 bg-muted" />
        ) : appointments.isError ? (
          <ErrorNote title="Could not load appointments" detail={appointments.error.message} />
        ) : appointmentItems.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No appointments on {formatBusinessDate(shownDate)}.
          </div>
        ) : (
          <div className="overflow-x-auto ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Time</TableHead>
                  <TableHead>Patient or caller</TableHead>
                  <TableHead>Practitioner</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointmentItems.map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">
                      {appointment.scheduledFor
                        ? formatTime(appointment.scheduledFor, timeZone)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/$orgSlug/opd/$appointmentId"
                        params={{ orgSlug, appointmentId: appointment.id }}
                        className="font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {appointment.patientName ?? appointment.callerName ?? "Unnamed caller"}
                      </Link>
                      <p className="text-muted-foreground">
                        {appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{appointment.practitionerName}</p>
                      <p className="text-muted-foreground">{appointment.departmentName}</p>
                    </TableCell>
                    <TableCell className="capitalize">{appointment.kind}</TableCell>
                    <TableCell>
                      <OpdAppointmentStatusBadge status={appointment.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {appointment.status === "booked" ? (
                          <>
                            <Button
                              size="xs"
                              disabled={checkIn.isPending}
                              onClick={() =>
                                appointment.patientId
                                  ? checkIn.mutate({
                                      orgSlug,
                                      appointmentId: appointment.id,
                                    })
                                  : setCheckingIn({
                                      id: appointment.id,
                                      callerName: appointment.callerName,
                                      callerPhone: appointment.callerPhone,
                                    })
                              }
                            >
                              Check in
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                setRescheduling({
                                  id: appointment.id,
                                  scheduledFor: appointment.scheduledFor,
                                })
                              }
                            >
                              Reschedule
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={markNoShow.isPending}
                              onClick={() =>
                                confirm({
                                  title: "Mark as no show?",
                                  description: `${
                                    appointment.patientName ??
                                    appointment.callerName ??
                                    "This caller"
                                  } did not arrive. A no show cannot be reopened — rebook if they turn up later.`,
                                  confirmLabel: "Mark no show",
                                  run: () =>
                                    markNoShow.mutate({ orgSlug, appointmentId: appointment.id }),
                                })
                              }
                            >
                              No show
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setCancellingOpdAppointmentId(appointment.id)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : appointment.tokenNumber ? (
                          <Link
                            to="/$orgSlug/opd/$appointmentId"
                            params={{ orgSlug, appointmentId: appointment.id }}
                            className="px-2 py-1 font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            Token {appointment.tokenNumber}
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {appointments.hasNextPage ? (
              <Button
                variant="outline"
                className="mt-3"
                disabled={appointments.isFetchingNextPage}
                onClick={() => appointments.fetchNextPage()}
              >
                {appointments.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        )}
      </PageBody>

      {cancellingOpdAppointmentId ? (
        <CancelOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={cancellingOpdAppointmentId}
          onClose={() => setCancellingOpdAppointmentId(null)}
        />
      ) : null}
      {leavingOpdAppointmentId ? (
        <MarkLeftUnseenOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={leavingOpdAppointmentId}
          onClose={() => setLeavingOpdAppointmentId(null)}
        />
      ) : null}
      {newOpdAppointmentOpen && (
        <NewOpdWalkInDialog orgSlug={orgSlug} onClose={() => setNewOpdAppointmentOpen(false)} />
      )}
      {bookingOpen ? (
        <BookOpdAppointmentDialog orgSlug={orgSlug} onClose={() => setBookingOpen(false)} />
      ) : null}
      {checkingIn ? (
        <CheckInOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={checkingIn.id}
          callerName={checkingIn.callerName}
          callerPhone={checkingIn.callerPhone}
          onClose={() => setCheckingIn(null)}
        />
      ) : null}
      {rescheduling ? (
        <RescheduleOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={rescheduling.id}
          scheduledFor={rescheduling.scheduledFor}
          onClose={() => setRescheduling(null)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}
