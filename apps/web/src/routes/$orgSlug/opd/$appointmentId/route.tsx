import { authorize, type AppPermission } from "@hms/auth/access";
import { cn } from "@hms/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { type ReactNode } from "react";

import { OpdAppointmentStatusBadge, type OpdAppointmentStatus } from "@/components/opd-appointment";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

/**
 * An OPD Appointment has two views: what the clinician does and what
 * the cashier does. They stay separate screens — the billing surface is large
 * and its mistakes are expensive — but they share a URL root so a terminal can
 * move between them without going back through a list.
 */
export const OPD_TABS: readonly {
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

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId")({
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    // Both tabs already read this key, so the layout shares their cache entry
    // rather than adding a request. It is fetched here only to name the tab.
    const data = await loadRouteQuery(
      queryClient.ensureQueryData(orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } })),
    );
    // A booked appointment has no token or patient yet — name it by the caller.
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
  // Nothing but the shared cache entry and the title: the tab strip belongs to
  // each tab, under its own header band. See `OpdRecordTabs`.
  component: Outlet,
});

/**
 * The tab strip. Each tab renders it under its own `PageHeader` rather than the
 * layout rendering it above both: a page owns its title band, and the sections
 * belong directly under that band instead of floating above it.
 */
export function OpdRecordTabs({
  orgSlug,
  appointmentId,
}: {
  orgSlug: string;
  appointmentId: string;
}) {
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const visible = OPD_TABS.filter(({ permission }) => authorize(membership.data.roles, permission));

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
            // The clinical tab is the index route, so prefix matching would
            // keep it active while Billing is open.
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

/**
 * The fields both tabs read out of `opd.get` to say *which* record this is.
 * Named one by one rather than inferred from the router, so the shared chrome
 * below declares exactly what it draws.
 */
export type OpdRecordIdentity = {
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

/**
 * Which record this is, for the title band. Shared rather than written twice:
 * the two copies had already drifted, and a title that re-words itself when a
 * cashier switches tabs reads as a different record instead of another view of
 * the same one.
 */
export function OpdRecordDescription({
  orgSlug,
  record,
}: {
  orgSlug: string;
  record: OpdRecordIdentity;
}) {
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

/**
 * What the desk says out loud, in one line: the token, the state the
 * appointment is in, and when it last moved. No box around it — the type
 * carries the hierarchy. `action` is the only part a tab owns; the clinical tab
 * hangs the status actions there and the cashier has none.
 */
export function OpdRecordSummary({
  record,
  action,
}: {
  record: OpdRecordIdentity;
  action?: ReactNode;
}) {
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

/**
 * Who the appointment is for and who is seeing them — the same facts on both
 * tabs, held apart from the strip above by a hairline rather than by two more
 * boxes. The cashier's copy used to carry fewer of them, so the same record
 * said two different things depending on which tab was open.
 */
export function OpdRecordFacts({ record }: { record: OpdRecordIdentity }) {
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

/**
 * The one card surface the record uses, for the two blocks that are genuinely a
 * table of rows: charges and money. Same tinted tray and raised card as the OPD
 * day list (docs/design.md §1), so the boards read as one product. Everything
 * else on the record stays flat — a box around every fact is noise, not
 * structure.
 */
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

/**
 * The one empty state inside a `RecordCard`, centred in the card the way the
 * OPD day list centres its own. A record with nothing in it then reads as an
 * empty card rather than a collapsed one.
 */
export function RecordEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center px-4 text-center text-muted-foreground">
      {children}
    </p>
  );
}
