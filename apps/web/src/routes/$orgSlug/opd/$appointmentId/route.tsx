import { authorize, type AppPermission } from "@hms/auth/access";
import { guardianLabel } from "@hms/api/lib/schemas";
import { Button } from "@hms/ui/components/button";
import { Separator } from "@hms/ui/components/separator";
import { cn } from "@hms/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";
import { ArrowUpRightIcon, PrinterIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { ErrorNote, PageBody, PageHeader, PageTab, PageTabs } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { useCan, useMembership } from "@/lib/membership";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { OpdRecordContext, useOpdRecord } from "@/lib/opd-record";
import { orpc } from "@/lib/orpc";
import { isAuthorizationError, loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";
import { practitionerDisplayName } from "@/lib/practitioner-name";

// Two separate screens — the billing surface is large and its mistakes expensive —
// sharing a URL root so a terminal moves between them without a list in between.
const OPD_TABS: readonly {
  to: "/$orgSlug/opd/$appointmentId" | "/$orgSlug/opd/$appointmentId/billing";
  label: string;
  permission: AppPermission;
}[] = [
  {
    to: "/$orgSlug/opd/$appointmentId",
    label: "Clinical",
    permission: { opd: ["read"] },
  },
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

    // The one place the patient's plans are warmed: the clinical panel and the billing
    // tab's advance form both read this key out of the cache.
    if (data.patient) {
      await queryClient
        .query(
          orpc.treatment.listForPatient.queryOptions({
            input: { orgSlug, patientId: data.patient.id },
          }),
        )
        .catch(() => {});
    }

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

  // Cashiers and accountants read the record; the status controls need `opd:update`.
  const canUpdate = useCan(orgSlug, { opd: ["update"] });

  // Authorization failures are terminal: keeping the cached record here would leave
  // patient and charge data visible after access was revoked.
  if (detail.error && isAuthorizationError(detail.error)) {
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
        <PageBody width="max-w-5xl" />
      </>
    );
  }

  const record = detail.data;

  return (
    <OpdRecordContext.Provider value={{ record, refreshError: detail.error }}>
      {/* `contents` so the bands stay direct children of the page column. The
          clinical tab prints a token slip and nothing else, so its chrome
          leaves the page; the cashier's tab prints the way it looks. */}
      <div className={cn("contents", isClinical && "print:hidden")}>
        <PageHeader
          title="Outpatient appointment"
          description={
            record.appointment.tokenNumber != null ? (
              <>
                Token <span className="font-mono">{record.appointment.tokenNumber}</span>
              </>
            ) : (
              "Booked"
            )
          }
          action={
            <>
              <StaleDataNotice dataUpdatedAt={detail.dataUpdatedAt} />
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

      <PageBody width="max-w-5xl">
        <div className={cn("contents", isClinical && "print:hidden")}>
          <OpdRecordSummary
            record={record}
            action={
              isClinical && canUpdate ? (
                <ClinicalStatusActions orgSlug={orgSlug} appointmentId={appointmentId} />
              ) : undefined
            }
          />
          <Separator />
          <OpdRecordFacts orgSlug={orgSlug} record={record} />
          <Separator />
        </div>
        <Outlet />
      </PageBody>
    </OpdRecordContext.Provider>
  );
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
  const { checkIn, markNoShow } = useOpdStatusActions();
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
    <PageTabs label="Outpatient appointment sections">
      {visible.map(({ to, label }) => (
        <PageTab
          key={to}
          to={to}
          params={{ orgSlug, appointmentId }}
          // The clinical tab is the index route, so prefix matching would keep it active
          // while Billing is open.
          activeOptions={{ exact: to === "/$orgSlug/opd/$appointmentId" }}
        >
          {label}
        </PageTab>
      ))}
    </PageTabs>
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
    guardianRelation: string | null;
    guardianName: string | null;
  } | null;
  practitioner: { name: string };
  department: { name: string };
};

function OpdRecordSummary({ record, action }: { record: OpdRecordIdentity; action?: ReactNode }) {
  const { timeZone } = useOrgDateTime();
  const { appointment } = record;

  const event = appointment.arrivedAt
    ? {
        label: "Arrived",
        value: formatDateTime(appointment.arrivedAt, timeZone),
      }
    : appointment.scheduledFor
      ? {
          label: "Scheduled",
          value: formatDateTime(appointment.scheduledFor, timeZone),
        }
      : {
          label: "Created",
          value: formatDateTime(appointment.createdAt, timeZone),
        };

  return (
    <section className="flex flex-wrap items-start justify-between gap-4">
      {/* The token is the header's identity (design.md, page-header grammar). */}
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <OpdAppointmentStatusBadge status={appointment.status} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">{event.label}</dt>
          <dd className="font-medium tabular-nums">{event.value}</dd>
        </div>
      </dl>
      {action}
    </section>
  );
}

function OpdRecordFacts({ orgSlug, record }: { orgSlug: string; record: OpdRecordIdentity }) {
  const { today } = useOrgDateTime();
  const { appointment, patient, practitioner, department } = record;
  const guardian = patient && guardianLabel(patient);

  const age = patient
    ? `${patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)} years`
    : null;

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {patient ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-muted-foreground">Patient</h2>
          <p className="font-medium">
            {/* The one way from the visit to the patient's full record. */}
            <Link
              to="/$orgSlug/patients/$patientId"
              params={{ orgSlug, patientId: patient.id }}
              className="inline-flex items-center gap-1 underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
            >
              <span className="capitalize">{patient.name}</span>
              <ArrowUpRightIcon aria-hidden className="size-3 text-muted-foreground" />
            </Link>
            {guardian ? (
              <span className="font-normal text-muted-foreground">
                {` ${guardian.relation} `}
                <span className="capitalize">{guardian.name}</span>
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground">
            <span className="font-mono">{patient.mrn}</span>
            {" · "}
            <span className="font-mono">{patient.phone}</span>
          </p>
          <p className="capitalize text-muted-foreground">
            <span className="tabular-nums">{age}</span> · {patient.sex}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h2 className="text-muted-foreground">Caller</h2>
          <p className={appointment.callerName ? "font-medium capitalize" : "font-medium"}>
            {appointment.callerName ?? "Unnamed caller"}
          </p>
          <p className="font-mono text-muted-foreground">{appointment.callerPhone ?? "No phone"}</p>
          <p className="text-muted-foreground">The patient record is linked at check-in.</p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="text-muted-foreground">Care team</h2>
        <p className="font-medium capitalize">{practitionerDisplayName(practitioner.name)}</p>
        <p className="text-muted-foreground">{department.name}</p>
      </div>
    </section>
  );
}
