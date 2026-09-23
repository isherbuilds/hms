import { authorize, type AppPermission } from "@hms/auth/access";
import { guardianLabel } from "@hms/api/lib/schemas";
import { buttonVariants } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";

import { Monogram } from "@/components/monogram";
import { PageHeader, PageTab, PageTabs } from "@/components/page";
import type { EditablePatient } from "@/components/patient-form";
import { useMembership } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";
import { PatientRecordContext } from "@/lib/patient-record";

const TABS = [
  { to: "/$orgSlug/patients/$patientId", label: "Record", permission: { patient: ["read"] } },
  { to: "/$orgSlug/patients/$patientId/visits", label: "Visits", permission: { opd: ["read"] } },
  {
    to: "/$orgSlug/patients/$patientId/billing",
    label: "Billing",
    permission: { billing: ["read"] },
  },
  {
    to: "/$orgSlug/patients/$patientId/treatment",
    label: "Treatment",
    permission: { treatment: ["read"] },
  },
] as const satisfies readonly { to: string; label: string; permission: AppPermission }[];

export const Route = createFileRoute("/$orgSlug/patients/$patientId")({
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await loadRouteQuery(
      queryClient.query(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } })),
    );
  },
  remountDeps: ({ params }) => ({ patientId: params.patientId }),
  component: PatientDetailRoute,
});

function PinnedFacts({
  record,
  ageLabel,
  underTreatment,
}: {
  record: EditablePatient;
  ageLabel: string;
  underTreatment: boolean;
}) {
  const guardian = guardianLabel(record);

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Monogram label={record.name} seed={record.id} kind="patient" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-xs font-medium">
            <span className="capitalize">{record.name}</span>
            {guardian ? (
              <span className="font-normal text-muted-foreground">
                {` ${guardian.relation} `}
                <span className="capitalize">{guardian.name}</span>
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{record.mrn}</span>
            {" · "}
            <span className="capitalize">{record.sex}</span>
            <span className="tabular-nums">{` · ${ageLabel} years`}</span>
            {record.bloodGroup ? ` · ${record.bloodGroup}` : ""}
          </p>
          {record.sponsor ? (
            <p className="truncate text-xs text-muted-foreground">
              Sponsor: {record.sponsor.payerName}
            </p>
          ) : null}
        </div>

        <p
          className={cn(
            "max-w-xs truncate rounded-md px-2 py-1 text-xs font-medium",
            record.allergies
              ? "bg-clinical-alert-surface text-clinical-alert"
              : "bg-clinical-clear-surface text-clinical-clear",
          )}
        >
          {record.allergies ?? "No known allergies"}
        </p>

        {underTreatment ? (
          <p className="rounded-md bg-clinical-note-surface px-2 py-1 text-xs font-medium text-clinical-note">
            Under treatment
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const { today } = useOrgDateTime();

  const record = useSuspenseQuery(
    orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }),
  ).data;

  const { roles } = useMembership(orgSlug);
  const ageLabel = patientAgeLabel(record.dateOfBirth, record.dobEstimated, today);

  return (
    <PatientRecordContext.Provider value={record}>
      <PageHeader
        title="Patient"
        action={
          authorize(roles, { opd: ["create"] }) ? (
            <Link
              className={buttonVariants()}
              to="/$orgSlug/opd/new"
              params={{ orgSlug }}
              search={{ patientId }}
            >
              <CalendarIcon />
              Book appointment
            </Link>
          ) : undefined
        }
      />
      <PinnedFacts
        record={record}
        ageLabel={ageLabel}
        underTreatment={record.openTreatmentPlans.length > 0}
      />
      <PageTabs label="Patient record sections">
        {TABS.map(({ to, label, permission }) =>
          authorize(roles, permission) ? (
            <PageTab
              key={to}
              to={to}
              params={{ orgSlug, patientId }}
              activeOptions={{ exact: true }}
            >
              {label}
            </PageTab>
          ) : null,
        )}
      </PageTabs>
      <Outlet />
    </PatientRecordContext.Provider>
  );
}
