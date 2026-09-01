import { authorize, type AppPermission } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { Separator } from "@hms/ui/components/separator";
import { cn } from "@hms/ui/lib/utils";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ClientOnly, Link, Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import {
  CancelOpdAppointmentDialog,
  OpdAppointmentStatusBadge,
  useOpdStatusActions,
  type OpdAppointmentStatus,
} from "@/components/opd-appointment";
import {
  CheckInOpdAppointmentDialog,
  RescheduleOpdAppointmentDialog,
} from "@/components/opd-appointment-dialogs";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { useMembership } from "@/lib/membership";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { OpdRecordContext, useOpdRecord } from "@/lib/opd-record";
import { orpc } from "@/lib/orpc";
import { hasErrorCode, loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

// Two separate screens — the billing surface is large and its mistakes expensive —
// sharing a URL root so a terminal moves between them without a list in between.
const OPD_TABS: readonly {
  to: "/$orgSlug/opd/$appointmentId" | "/$orgSlug/opd/$appointmentId/billing";
  label: string;
  permission: AppPermission;
}[] = [
  { to: "/$orgSlug/opd/$appointmentId", label: "Clinical", permission: { opd: ["read"] } },
  {
    to: "/$orgSlug/opd/$appointmentId/billing",
    label: "Billing",
    permission: { billing: ["read"] },
  },
];

const CLINICAL_ROUTE_ID = "/$orgSlug/opd/$appointmentId/";

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId")({
  // The chrome and the clinical tab's dialogs hang off this layout, so moving to the
  // next appointment must not carry their state over.
  remountDeps: ({ params }) => ({ appointmentId: params.appointmentId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    // The one place the record is fetched; both tabs read it out of the layout context.
    const data = await loadRouteQuery(
      queryClient.query({
        ...orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }),
        staleTime: "static",
      }),
    );
    // A booked appointment has no patient yet — name it by the caller.
    return {
      tokenNumber: data.appointment.tokenNumber,
      name: data.patient ? data.patient.name : data.appointment.callerName,
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? loaderData.tokenNumber != null
            ? `Token ${loaderData.tokenNumber} · ${loaderData.name ?? "Outpatient appointment"} · HMS`
            : `Booked · ${loaderData.name ?? "Outpatient appointment"} · HMS`
          : "Outpatient appointment · HMS",
      },
    ],
  }),
  component: OpdRecordLayout,
});

// In the layout so switching tabs re-renders the body alone: the strip and its
// `member.me` observer stay mounted.
function OpdRecordLayout() {
  const { orgSlug, appointmentId } = Route.useParams();
  const detail = useQuery({
    ...orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  });
  const isClinical = useChildMatches({
    select: (matches) => matches[0]?.routeId === CLINICAL_ROUTE_ID,
  });

  // Authorization failures are terminal: keeping the cached record here would leave
  // patient and charge data visible after access was revoked.
  if (
    detail.error &&
    (hasErrorCode(detail.error, "UNAUTHORIZED") || hasErrorCode(detail.error, "FORBIDDEN"))
  ) {
    throw detail.error;
  }

  if (!detail.data && detail.error) {
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <ErrorNote title="Could not load outpatient appointment" error={detail.error} inset />
      </>
    );
  }
  if (!detail.data) {
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <PageBody className="mx-auto w-full max-w-5xl" />
      </>
    );
  }

  const record = detail.data;
  // A screen is only as fresh as its oldest read, and the cashier polls the invoice
  // list beside the record.
  const freshnessKeys = isClinical
    ? [orpc.opd.get.key({ input: { orgSlug, appointmentId } })]
    : [
        orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
        orpc.billing.listInvoices.key({ input: { orgSlug, appointmentId } }),
      ];

  return (
    <OpdRecordContext.Provider value={{ record, refreshError: detail.error }}>
      {/* `contents` so the bands stay direct children of the page column. The
          clinical tab prints a token slip and nothing else, so its chrome
          leaves the page; the cashier's tab prints the way it looks. */}
      <div className={cn("contents", isClinical && "print:hidden")}>
        <PageHeader
          title="Outpatient appointment"
          description={<OpdRecordDescription orgSlug={orgSlug} record={record} />}
          action={
            <>
              <RecordFreshness queryKeys={freshnessKeys} />
              {isClinical ? (
                <Button
                  disabled={record.appointment.tokenNumber == null || !record.patient}
                  onClick={() => window.print()}
                >
                  <PrinterIcon data-icon="inline-start" />
                  Print slip
                </Button>
              ) : null}
            </>
          }
        />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
      </div>

      <PageBody className="mx-auto w-full max-w-5xl">
        <div className={cn("contents", isClinical && "print:hidden")}>
          <OpdRecordSummary
            record={record}
            action={
              isClinical ? (
                <ClinicalStatusActions orgSlug={orgSlug} appointmentId={appointmentId} />
              ) : undefined
            }
          />
          <Separator />
          <OpdRecordFacts record={record} />
          <Separator />
        </div>
        <Outlet />
      </PageBody>
    </OpdRecordContext.Provider>
  );
}

// Read straight out of the cache. Taking `dataUpdatedAt` as a prop put the 10s poll
// in the same reactive scope as the body, re-rendering every charge on every poll.
function RecordFreshness({ queryKeys }: { queryKeys: QueryKey[] }) {
  const queryClient = useQueryClient();
  const dataUpdatedAt = useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    () =>
      queryKeys.reduce(
        (oldest, key) => Math.min(oldest, queryClient.getQueryState(key)?.dataUpdatedAt ?? 0),
        Number.POSITIVE_INFINITY,
      ),
    () => 0,
  );

  return <StaleDataNotice dataUpdatedAt={dataUpdatedAt} />;
}

// Declared here and mounted only while the clinical tab is open; the cashier has none.
function ClinicalStatusActions({
  orgSlug,
  appointmentId,
}: {
  orgSlug: string;
  appointmentId: string;
}) {
  const { record } = useOpdRecord();
  const { appointment } = record;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const { checkIn, markNoShow } = useOpdStatusActions(orgSlug);
  const changingStatus = checkIn.isPending || markNoShow.isPending;

  return (
    <>
      {appointment.status === "booked" ? (
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            disabled={changingStatus}
            onClick={() =>
              appointment.patientId
                ? checkIn.mutate({ orgSlug, appointmentId })
                : setCheckInOpen(true)
            }
          >
            Check in
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setRescheduleOpen(true)}>
            Reschedule
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={changingStatus}
            onClick={() =>
              confirm({
                title: "Mark as no show?",
                description:
                  "The caller did not arrive. A no show cannot be reopened — rebook if they turn up later.",
                confirmLabel: "Mark no show",
                run: () => markNoShow.mutate({ orgSlug, appointmentId }),
              })
            }
          >
            No show
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={changingStatus}
            onClick={() => setCancelOpen(true)}
          >
            Cancel
          </Button>
        </div>
      ) : appointment.status === "checked_in" ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={changingStatus}
          onClick={() => setCancelOpen(true)}
        >
          Cancel
        </Button>
      ) : null}

      <ClientOnly fallback={null}>
        {cancelOpen ? (
          <CancelOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            onClose={() => setCancelOpen(false)}
          />
        ) : null}
        {rescheduleOpen ? (
          <RescheduleOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            scheduledFor={appointment.scheduledFor}
            onClose={() => setRescheduleOpen(false)}
          />
        ) : null}
        {checkInOpen ? (
          <CheckInOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            callerName={appointment.callerName}
            callerPhone={appointment.callerPhone}
            onClose={() => setCheckInOpen(false)}
          />
        ) : null}
        {confirmDialog}
      </ClientOnly>
    </>
  );
}

function OpdRecordTabs({ orgSlug, appointmentId }: { orgSlug: string; appointmentId: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = OPD_TABS.filter(({ permission }) => authorize(roles, permission));

  return (
    <nav
      aria-label="Outpatient appointment sections"
      className="min-h-10 border-b border-border print:hidden"
    >
      <div className="mx-auto flex min-h-10 w-full max-w-5xl gap-1 px-4">
        {visible.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            params={{ orgSlug, appointmentId }}
            // The clinical tab is the index route, so prefix matching would keep it active
            // while Billing is open.
            activeOptions={{ exact: to === "/$orgSlug/opd/$appointmentId" }}
            className={cn(
              "-mb-px flex shrink-0 items-center border-b-2 border-transparent px-3 text-xs text-muted-foreground transition-colors",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "data-[status=active]:border-foreground data-[status=active]:font-medium data-[status=active]:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

type OpdRecordIdentity = {
  appointment: {
    tokenNumber: number | null;
    status: OpdAppointmentStatus;
    callerName: string | null;
    callerPhone: string | null;
    scheduledFor: Date | string | null;
    arrivedAt: Date | string | null;
    createdAt: Date | string;
  };
  patient: {
    id: string;
    mrn: string;
    name: string;
    phone: string;
    sex: string;
    dateOfBirth: string;
    dobEstimated: boolean;
  } | null;
  practitioner: { name: string };
  department: { name: string };
};

function OpdRecordDescription({ orgSlug, record }: { orgSlug: string; record: OpdRecordIdentity }) {
  const { appointment, patient } = record;

  return (
    <>
      {appointment.tokenNumber != null ? `Token ${appointment.tokenNumber} · ` : "Booked · "}
      {patient ? (
        <Link
          to="/$orgSlug/patients/$patientId"
          params={{ orgSlug, patientId: patient.id }}
          className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
        >
          {`${patient.mrn} · ${patient.name}`}
        </Link>
      ) : (
        `${appointment.callerName ?? "Unnamed caller"} · ${appointment.callerPhone ?? "No phone"}`
      )}
    </>
  );
}

function OpdRecordSummary({ record, action }: { record: OpdRecordIdentity; action?: ReactNode }) {
  const { timeZone } = useOrgDateTime();
  const { appointment } = record;
  const event = appointment.arrivedAt
    ? { label: "Arrived", value: formatDateTime(appointment.arrivedAt, timeZone) }
    : appointment.scheduledFor
      ? { label: "Scheduled", value: formatDateTime(appointment.scheduledFor, timeZone) }
      : { label: "Created", value: formatDateTime(appointment.createdAt, timeZone) };

  return (
    <section className="flex flex-wrap items-start justify-between gap-4">
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Token</dt>
          <dd className="font-mono text-sm font-medium tabular-nums">
            {appointment.tokenNumber ?? "Pending"}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <OpdAppointmentStatusBadge status={appointment.status} />
          </dd>
        </div>
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
          <dt className="text-muted-foreground">{event.label}</dt>
          <dd className="font-medium tabular-nums">{event.value}</dd>
        </div>
      </dl>
      {action}
    </section>
  );
}

function OpdRecordFacts({ record }: { record: OpdRecordIdentity }) {
  const { today } = useOrgDateTime();
  const { appointment, patient, practitioner, department } = record;
  const age = patient
    ? `${patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)} years`
    : null;

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {patient ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-muted-foreground">Patient</h2>
          <p className="font-medium">{patient.name}</p>
          <p className="text-muted-foreground">
            {patient.mrn} · {patient.phone}
          </p>
          <p className="capitalize text-muted-foreground">
            {age} · {patient.sex}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h2 className="text-muted-foreground">Caller</h2>
          <p className="font-medium">{appointment.callerName ?? "Unnamed caller"}</p>
          <p className="text-muted-foreground">{appointment.callerPhone ?? "No phone"}</p>
          <p className="text-muted-foreground">The patient record is linked at check-in.</p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="text-muted-foreground">Care team</h2>
        <p className="font-medium">{practitioner.name}</p>
        <p className="text-muted-foreground">{department.name}</p>
      </div>
    </section>
  );
}

export function RecordCard({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl bg-muted p-1">
      <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
        <h2 className="min-w-0 truncate">{label}</h2>
        {action}
      </div>
      {/* One row's worth of reserved height, not a day's: the shape stays put
          while a poll is in flight, and a record that carries two rows is not
          padded out into a hole. */}
      <div className="flex min-h-16 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function RecordEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center px-4 text-center text-muted-foreground">
      {children}
    </p>
  );
}
