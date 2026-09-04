import { toSignedPaise } from "@hms/api/lib/invoice-math";
import { authorize, type AppPermission } from "@hms/auth/access";
import { buttonVariants } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";
import { z } from "zod";

import { Monogram } from "@/components/monogram";
import { PageBody, PageHeader, PageTab, PageTabs } from "@/components/page";
import { PatientBilling, type PatientAccount } from "@/components/patient-record/billing";
import {
  InlineClinicalBlock,
  InlineRow,
  usePatientFieldSave,
  type EditablePatientRecord,
} from "@/components/patient-record/inline-fields";
import { PatientVisits } from "@/components/patient-record/visits";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { PAYER_TYPE_LABELS } from "@/lib/payer";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

const TABS = [
  { id: "record", label: "Record", permission: { patient: ["read"] } },
  { id: "visits", label: "Visits", permission: { opd: ["read"] } },
  { id: "billing", label: "Billing", permission: { billing: ["read"] } },
] as const satisfies readonly { id: string; label: string; permission: AppPermission }[];

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/$orgSlug/patients/$patientId")({
  // Every open editor and expanded visit belongs to the record above it, so patient A
  // must not hand its state to patient B.
  remountDeps: ({ params }) => ({ patientId: params.patientId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    // The page is the record: without it there is nothing to show, so a failure belongs
    // to the route, not to a note inside a page that has no content.
    await loadRouteQuery(
      queryClient.query(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } })),
    );
  },
  // The open tab lives in the URL so a link is shareable and Back from a visit lands
  // where the user left.
  validateSearch: z.object({
    tab: z.enum(["record", "visits", "billing"]).optional().catch(undefined),
  }),
  component: PatientDetailRoute,
});

function PinnedFacts({
  record,
  ageLabel,
  canReadBilling,
  account,
  currency,
}: {
  record: EditablePatientRecord;
  ageLabel: string;
  canReadBilling: boolean;
  account: PatientAccount | undefined;
  currency: string;
}) {
  const outstanding = account?.outstanding;
  const owes = outstanding !== undefined && toSignedPaise(outstanding) !== 0;

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
          {record.sponsor ? (
            <p className="text-xs text-muted-foreground">
              Sponsor: {record.sponsor.payerName} ({PAYER_TYPE_LABELS[record.sponsor.payerType]})
              {record.sponsor.policyNumber ? (
                <>
                  {" · Policy "}
                  <span className="font-mono">{record.sponsor.policyNumber}</span>
                </>
              ) : null}
              {record.sponsor.employeeNumber ? (
                <>
                  {" · Emp "}
                  <span className="font-mono">{record.sponsor.employeeNumber}</span>
                </>
              ) : null}
            </p>
          ) : null}
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
  const { savedField, pending, save } = usePatientFieldSave(orgSlug, record);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InlineClinicalBlock
          title={record.allergies ? "Allergies" : "No known allergies"}
          field="allergies"
          tone={record.allergies ? "alert" : "clear"}
          value={record.allergies ?? ""}
          placeholder="Nothing recorded at registration."
          saved={savedField === "allergies"}
          pending={pending}
          onSave={save}
        />
        <InlineClinicalBlock
          title="Medical history"
          field="medicalHistory"
          tone="note"
          value={record.medicalHistory ?? ""}
          placeholder="Nothing recorded."
          saved={savedField === "medicalHistory"}
          pending={pending}
          onSave={save}
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
            label="Name"
            field="name"
            kind="text"
            value={record.name}
            saved={savedField === "name"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="Phone"
            field="phone"
            kind="text"
            value={record.phone}
            display={<span className="font-mono tabular-nums">{record.phone}</span>}
            saved={savedField === "phone"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="Sex"
            field="sex"
            kind="sex"
            value={record.sex}
            display={<span className="capitalize">{record.sex}</span>}
            saved={savedField === "sex"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="Blood group"
            field="bloodGroup"
            kind="blood"
            value={record.bloodGroup ?? ""}
            saved={savedField === "bloodGroup"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="Date of birth"
            field="dateOfBirth"
            kind="date"
            value={record.dateOfBirth}
            display={formatBusinessDate(record.dateOfBirth)}
            saved={savedField === "dateOfBirth"}
            pending={pending}
            onSave={save}
          />
          <div className="grid grid-cols-1 items-center gap-1 border-b border-border/60 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">Age</dt>
            <dd>{ageLabel} years</dd>
          </div>
          <InlineRow
            compact
            label="Email"
            field="email"
            kind="text"
            value={record.email ?? ""}
            saved={savedField === "email"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="National ID / UID"
            field="uid"
            kind="text"
            value={record.uid ?? ""}
            display={record.uid ? <span className="font-mono">{record.uid}</span> : undefined}
            saved={savedField === "uid"}
            pending={pending}
            onSave={save}
          />
          <InlineRow
            compact
            label="Address"
            field="address"
            kind="textarea"
            value={record.address}
            saved={savedField === "address"}
            pending={pending}
            onSave={save}
          />
        </dl>
      </section>
    </div>
  );
}

function PatientRecordSections({
  orgSlug,
  patientId,
  record,
  ageLabel,
  currency,
  visible,
  account,
  accountPending,
  accountError,
}: {
  orgSlug: string;
  patientId: string;
  record: EditablePatientRecord;
  ageLabel: string;
  currency: string;
  visible: (typeof TABS)[number][];
  account: PatientAccount | undefined;
  accountPending: boolean;
  accountError: Error | null;
}) {
  const { tab } = Route.useSearch();
  const active: TabId = visible.some((entry) => entry.id === tab) ? (tab as TabId) : "record";

  return (
    <>
      <PageTabs label="Patient record sections" className="mx-auto w-full max-w-4xl">
        {visible.map(({ id, label }) => (
          <PageTab
            key={id}
            to="/$orgSlug/patients/$patientId"
            params={{ orgSlug, patientId }}
            search={id === "record" ? {} : { tab: id }}
            data-status={active === id ? "active" : undefined}
          >
            {label}
          </PageTab>
        ))}
      </PageTabs>

      <PageBody>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {active === "record" ? (
            <RecordTab orgSlug={orgSlug} record={record} ageLabel={ageLabel} />
          ) : active === "visits" ? (
            <PatientVisits orgSlug={orgSlug} patientId={patientId} currency={currency} />
          ) : (
            <PatientBilling
              orgSlug={orgSlug}
              account={account}
              isPending={accountPending}
              error={accountError}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const { today } = useOrgDateTime();
  // The loader awaited this and turns a missing patient into a 404, so it is present
  // here — a `useQuery` beside it would only add branches that never run.
  const record = useSuspenseQuery(
    orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }),
  ).data;
  const { roles, currency } = useMembership(orgSlug);
  const canReadPatient = authorize(roles, { patient: ["read"] });
  const canReadVisits = authorize(roles, { opd: ["read"] });
  const canReadBilling = authorize(roles, { billing: ["read"] });
  const visible = TABS.filter(({ id }) =>
    id === "record" ? canReadPatient : id === "visits" ? canReadVisits : canReadBilling,
  );
  const account = useQuery({
    ...orpc.patient.account.queryOptions({ input: { orgSlug, patientId } }),
    enabled: canReadBilling,
  });
  const ageLabel = patientAgeLabel(record.dateOfBirth, record.dobEstimated, today);

  return (
    <>
      <PageHeader
        title="Patient"
        description={`${record.mrn} · ${record.name}`}
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
        account={account.data}
        record={record}
        ageLabel={ageLabel}
        canReadBilling={canReadBilling}
        currency={currency}
      />

      <PatientRecordSections
        orgSlug={orgSlug}
        patientId={patientId}
        record={record}
        ageLabel={ageLabel}
        currency={currency}
        visible={visible}
        account={account.data}
        accountPending={account.isPending}
        accountError={account.error}
      />
    </>
  );
}
