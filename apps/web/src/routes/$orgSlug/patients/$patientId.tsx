import { authorize, type AppPermission } from "@hms/auth/access";
import { guardianLabel } from "@hms/api/lib/schemas";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarIcon, PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { Monogram } from "@/components/monogram";
import { PageBody, PageHeader, PageTab, PageTabs } from "@/components/page";
import type { EditablePatient } from "@/components/patient-form";
import { PatientBilling, type PatientAccount } from "@/components/patient-record/billing";
import { PatientVisits } from "@/components/patient-record/visits";
import { PatientSheet } from "@/components/patient-sheet";
import { useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { PAYER_TYPE_LABELS } from "@/lib/payer";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

const TABS = [
  { id: "record", label: "Record", permission: { patient: ["read"] } },
  { id: "visits", label: "Visits", permission: { opd: ["read"] } },
  { id: "billing", label: "Billing", permission: { billing: ["read"] } },
] as const satisfies readonly {
  id: string;
  label: string;
  permission: AppPermission;
}[];

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
  record: EditablePatient;
  ageLabel: string;
  canReadBilling: boolean;
  account: PatientAccount | undefined;
  currency: string;
}) {
  const guardian = guardianLabel(record);
  const outstanding = account?.outstanding;
  const owes = outstanding !== undefined && outstanding !== ZERO;

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Monogram label={record.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-medium">
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
            {` · ${ageLabel} years`}
            {record.bloodGroup ? ` · ${record.bloodGroup}` : ""}
          </p>
          {/* Who is covering this patient, nothing more: the policy and employee
              numbers belong beside the Edit button that changes them. */}
          {record.sponsor ? (
            <p className="truncate text-xs text-muted-foreground">
              Sponsor: {record.sponsor.payerName}
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

function ClinicalBlock({
  title,
  tone,
  children,
}: {
  title: string;
  // The colour is the claim — see docs/design.md §5 for why these tokens are the
  // only chromatic exception.
  tone: "alert" | "note" | "clear";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3",
        tone === "alert" && "border-clinical-alert-border bg-clinical-alert-surface",
        tone === "note" && "border-clinical-note-border bg-clinical-note-surface",
        tone === "clear" && "border-clinical-clear-border bg-clinical-clear-surface",
      )}
    >
      <p className="font-medium">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 border-b border-border/60 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function RecordTab({
  orgSlug,
  record,
  ageLabel,
}: {
  orgSlug: string;
  record: EditablePatient;
  ageLabel: string;
}) {
  const { roles } = useMembership(orgSlug);
  const [editing, setEditing] = useState(false);
  const guardian = guardianLabel(record);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ClinicalBlock
          title={record.allergies ? "Allergies" : "No known allergies"}
          tone={record.allergies ? "alert" : "clear"}
        >
          {record.allergies ?? <Empty>Nothing recorded at registration.</Empty>}
        </ClinicalBlock>
        <ClinicalBlock title="Medical history" tone="note">
          {record.medicalHistory ?? <Empty>Nothing recorded.</Empty>}
        </ClinicalBlock>
      </div>

      <section className="flex flex-col">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Details</p>
          {authorize(roles, { patient: ["update"] }) ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <Row label="MRN">
            <span className="font-mono text-muted-foreground">{record.mrn}</span>
          </Row>
          <Row label="Name">
            <span className="capitalize">{record.name}</span>
          </Row>
          <Row label="Phone">
            <span className="font-mono tabular-nums">{record.phone}</span>
          </Row>
          <Row label="Sex">
            <span className="capitalize">{record.sex}</span>
          </Row>
          <Row label="Blood group">{record.bloodGroup ?? <Empty>Not recorded</Empty>}</Row>
          <Row label="Date of birth">
            {formatBusinessDate(record.dateOfBirth)}
            {record.dobEstimated ? <Empty> · estimated from age</Empty> : null}
          </Row>
          <Row label="Age">{ageLabel} years</Row>
          <Row label="Email">{record.email ?? <Empty>Not recorded</Empty>}</Row>
          <Row label="National ID / UID">
            {record.uid ? (
              <span className="font-mono">{record.uid}</span>
            ) : (
              <Empty>Not recorded</Empty>
            )}
          </Row>
          <Row label="Address">{record.address || <Empty>Not recorded</Empty>}</Row>
          <Row label="Guardian">
            {guardian ? (
              <span>
                {guardian.relation} <span className="capitalize">{guardian.name}</span>
              </span>
            ) : (
              <Empty>Not recorded</Empty>
            )}
          </Row>
          {record.guardianPhone ? (
            <Row label="Relation mobile">
              <span className="font-mono tabular-nums">{record.guardianPhone}</span>
            </Row>
          ) : null}
          <Row label="Emergency contact">
            {record.emergencyContactName ? (
              <>
                <span className="capitalize">{record.emergencyContactName}</span>
                {record.emergencyContactRelation ? (
                  <span className="capitalize">{` · ${record.emergencyContactRelation}`}</span>
                ) : null}
              </>
            ) : (
              <Empty>Not recorded</Empty>
            )}
          </Row>
          {record.emergencyContactPhone ? (
            <Row label="Emergency phone">
              <span className="font-mono tabular-nums">{record.emergencyContactPhone}</span>
            </Row>
          ) : null}
          <Row label="Sponsor">
            {record.sponsor ? (
              <>
                {record.sponsor.payerName} ({PAYER_TYPE_LABELS[record.sponsor.payerType]})
              </>
            ) : (
              <Empty>Self-paying</Empty>
            )}
          </Row>
          {record.sponsor?.policyNumber ? (
            <Row label="Policy number">
              <span className="font-mono">{record.sponsor.policyNumber}</span>
            </Row>
          ) : null}
          {record.sponsor?.employeeNumber ? (
            <Row label="Employee number">
              <span className="font-mono">{record.sponsor.employeeNumber}</span>
            </Row>
          ) : null}
        </dl>
      </section>

      <PatientSheet orgSlug={orgSlug} patient={record} open={editing} onOpenChange={setEditing} />
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
  record: EditablePatient;
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
        description={
          <>
            {record.mrn} · <span className="capitalize">{record.name}</span>
          </>
        }
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
