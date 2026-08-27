import { authorize, type AppPermission } from "@hms/auth/access";
import { buttonVariants } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { Monogram } from "@/components/monogram";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PatientBilling } from "@/components/patient-record/billing";
import {
  InlineClinicalBlock,
  InlineRow,
  usePatientFieldSave,
  type EditablePatientRecord,
} from "@/components/patient-record/inline-fields";
import { PatientVisits } from "@/components/patient-record/visits";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

/**
 * The patient record. Three decisions shape this page, all of them tested as
 * prototypes before they were built:
 *
 *   - **The record edits in place.** There is no edit mode and no panel: a
 *     field is a button until it is clicked. Registration still uses
 *     `PatientSheet`, because a new patient has no page to edit on.
 *   - **The facts that must not be missed never move.** Identity, allergies and
 *     the outstanding balance live in a bar above the tabs, so switching to
 *     Visits cannot hide an allergy.
 *   - **A visit is not duplicated here.** The list carries what tells visits
 *     apart; a row opens to read its files and charges, and every action on a
 *     visit stays on the outpatient record.
 */
const TABS = [
  { id: "record", label: "Record", permission: { patient: ["read"] } },
  { id: "visits", label: "Visits", permission: { opd: ["read"] } },
  { id: "billing", label: "Billing", permission: { billing: ["read"] } },
] as const satisfies readonly { id: string; label: string; permission: AppPermission }[];

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/$orgSlug/patients/$patientId")({
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await Promise.all([
      loadRouteQuery(
        queryClient.fetchQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } })),
      ),
      queryClient.prefetchQuery(orpc.settings.get.queryOptions({ input: { orgSlug } })),
    ]);
  },
  // The open tab lives in the URL so a link is shareable and Back from a visit
  // lands where the user left, not on the first tab.
  validateSearch: z.object({
    tab: z.enum(["record", "visits", "billing"]).optional().catch(undefined),
  }),
  component: PatientDetailRoute,
});

/** Identity, what is dangerous, and what is owed — permanent chrome. */
function PinnedFacts({
  orgSlug,
  record,
  ageLabel,
  canReadBilling,
  currency,
}: {
  orgSlug: string;
  record: EditablePatientRecord;
  ageLabel: string;
  canReadBilling: boolean;
  currency: string;
}) {
  const account = useQuery({
    ...orpc.patient.account.queryOptions({ input: { orgSlug, patientId: record.id } }),
    enabled: canReadBilling,
  });
  const outstanding = account.data?.outstanding;
  const owes = outstanding !== undefined && Number(outstanding) !== 0;

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Monogram label={record.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-medium">{record.name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{record.mrn}</span>
            {" · "}
            <span className="capitalize">{record.sex}</span>
            {` · ${ageLabel} years`}
            {record.bloodGroup ? ` · ${record.bloodGroup}` : ""}
          </p>
        </div>

        <p
          className={cn(
            "max-w-xs truncate rounded-md px-1.5 py-0.5 text-xs font-medium",
            record.allergies
              ? "bg-clinical-alert-surface text-clinical-alert"
              : "bg-clinical-clear-surface text-clinical-clear",
          )}
        >
          {record.allergies ?? "No known allergies"}
        </p>

        {canReadBilling && outstanding !== undefined ? (
          <p className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Outstanding</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                owes ? "text-clinical-alert" : "text-muted-foreground",
              )}
            >
              {formatMoney(outstanding, currency)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RecordTab({
  orgSlug,
  record,
  ageLabel,
}: {
  orgSlug: string;
  record: EditablePatientRecord;
  ageLabel: string;
}) {
  const saver = usePatientFieldSave(orgSlug, record);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InlineClinicalBlock
          title={record.allergies ? "Allergies" : "No known allergies"}
          field="allergies"
          tone={record.allergies ? "alert" : "clear"}
          value={record.allergies ?? ""}
          placeholder="Nothing recorded at registration."
          saver={saver}
        />
        <InlineClinicalBlock
          title="Medical history"
          field="medicalHistory"
          tone="note"
          value={record.medicalHistory ?? ""}
          placeholder="Nothing recorded."
          saver={saver}
        />
      </div>

      <section className="flex flex-col">
        <p className="flex min-h-6 items-center text-xs text-muted-foreground">Details</p>
        <p className="pb-1 text-muted-foreground">
          Click a field to correct it. Enter saves, Escape reverts.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <div className="grid grid-cols-1 items-center gap-1 border-b border-border/60 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">MRN</dt>
            <dd className="text-muted-foreground">
              <span className="font-mono">{record.mrn}</span> · issued
            </dd>
          </div>
          <InlineRow
            compact
            saver={saver}
            label="Name"
            field="name"
            kind="text"
            value={record.name}
          />
          <InlineRow
            compact
            saver={saver}
            label="Phone"
            field="phone"
            kind="text"
            value={record.phone}
            display={<span className="font-mono tabular-nums">{record.phone}</span>}
          />
          <InlineRow
            compact
            saver={saver}
            label="Sex"
            field="sex"
            kind="sex"
            value={record.sex}
            display={<span className="capitalize">{record.sex}</span>}
          />
          <InlineRow
            compact
            saver={saver}
            label="Blood group"
            field="bloodGroup"
            kind="blood"
            value={record.bloodGroup ?? ""}
          />
          <InlineRow
            compact
            saver={saver}
            label="Date of birth"
            field="dateOfBirth"
            kind="date"
            value={record.dateOfBirth}
            display={formatBusinessDate(record.dateOfBirth)}
          />
          <div className="grid grid-cols-1 items-center gap-1 border-b border-border/60 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">Age</dt>
            <dd>{ageLabel} years</dd>
          </div>
          <InlineRow
            compact
            saver={saver}
            label="Email"
            field="email"
            kind="text"
            value={record.email ?? ""}
          />
          <InlineRow
            compact
            saver={saver}
            label="National ID / UID"
            field="uid"
            kind="text"
            value={record.uid ?? ""}
            display={record.uid ? <span className="font-mono">{record.uid}</span> : undefined}
          />
          <InlineRow
            compact
            saver={saver}
            label="Address"
            field="address"
            kind="textarea"
            value={record.address}
          />
        </dl>
      </section>
    </div>
  );
}

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const { tab } = Route.useSearch();
  const { today } = useOrgDateTime();
  const patient = useQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }));
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));

  const visible = TABS.filter(({ permission }) => authorize(membership.data.roles, permission));
  const active: TabId = visible.some((entry) => entry.id === tab) ? (tab as TabId) : "record";
  const record = patient.data;
  const ageLabel = record
    ? patientAgeLabel(record.dateOfBirth, record.dobEstimated, today)
    : undefined;
  const currency = settings.data?.currency;
  const canReadBilling = visible.some((entry) => entry.id === "billing");

  return (
    <>
      <PageHeader
        title="Patient"
        description={record ? `${record.mrn} · ${record.name}` : undefined}
        action={
          record ? (
            <Link
              className={buttonVariants()}
              to="/$orgSlug/opd/new"
              params={{ orgSlug }}
              search={{ patientId }}
            >
              Add appointment
            </Link>
          ) : undefined
        }
      />

      {patient.isError ? (
        <ErrorNote title="Could not load patient" detail={patient.error.message} inset />
      ) : settings.isError ? (
        <ErrorNote title="Could not load settings" detail={settings.error.message} inset />
      ) : record && ageLabel && currency ? (
        <>
          <PinnedFacts
            orgSlug={orgSlug}
            record={record}
            ageLabel={ageLabel}
            canReadBilling={canReadBilling}
            currency={currency}
          />

          <nav
            aria-label="Patient record sections"
            className="min-h-10 shrink-0 border-b border-border"
          >
            <div className="mx-auto flex min-h-10 w-full max-w-4xl gap-1 px-4">
              {visible.map(({ id, label }) => (
                <Link
                  key={id}
                  to="/$orgSlug/patients/$patientId"
                  params={{ orgSlug, patientId }}
                  search={id === "record" ? {} : { tab: id }}
                  data-status={active === id ? "active" : undefined}
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

          <PageBody>
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {active === "record" ? (
                <RecordTab orgSlug={orgSlug} record={record} ageLabel={ageLabel} />
              ) : active === "visits" ? (
                <PatientVisits orgSlug={orgSlug} patientId={patientId} currency={currency} />
              ) : (
                <PatientBilling orgSlug={orgSlug} patientId={patientId} />
              )}
            </div>
          </PageBody>
        </>
      ) : null}
    </>
  );
}
