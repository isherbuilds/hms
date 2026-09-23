import { authorize } from "@hms/auth/access";
import { guardianLabel } from "@hms/api/lib/schemas";
import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageBody, Panel } from "@/components/page";
import type { EditablePatient } from "@/components/patient-form";
import { PatientSheet } from "@/components/patient-sheet";
import { useMembership } from "@/lib/membership";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { PAYER_TYPE_LABELS } from "@/lib/payer";
import { patientAgeLabel } from "@/lib/patient-age";
import { usePatientRecord } from "@/lib/patient-record";

export const Route = createFileRoute("/$orgSlug/patients/$patientId/")({
  head: () => ({ meta: [{ title: "Patient record · HMS" }] }),
  component: PatientRecordRoute,
});

function PatientRecordRoute() {
  const { orgSlug } = Route.useParams();
  const record = usePatientRecord();
  const { today } = useOrgDateTime();

  return (
    <PageBody width="max-w-5xl">
      <RecordTab
        orgSlug={orgSlug}
        record={record}
        ageLabel={patientAgeLabel(record.dateOfBirth, record.dobEstimated, today)}
      />
    </PageBody>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <section
          className={cn(
            "flex flex-col gap-1 rounded-lg border p-3",
            record.allergies
              ? "border-clinical-alert-border bg-clinical-alert-surface text-clinical-alert"
              : "border-clinical-clear-border bg-clinical-clear-surface text-clinical-clear",
          )}
        >
          <h2 className="text-muted-foreground">Allergies</h2>
          <p>{record.allergies ?? "No known allergies"}</p>
        </section>
        <section className="flex flex-col gap-1 rounded-lg border border-clinical-note-border bg-clinical-note-surface p-3 text-clinical-note">
          <h2 className="text-muted-foreground">Medical history</h2>
          <p>{record.medicalHistory ?? <Empty>Nothing recorded</Empty>}</p>
        </section>
      </div>

      <Panel
        label="Patient details"
        padded
        action={
          authorize(roles, { patient: ["update"] }) ? (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit patient
            </Button>
          ) : undefined
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Phone">
            <span className="font-mono tabular-nums">{record.phone}</span>
          </Row>
          <Row label="Email">{record.email ?? <Empty>Not recorded</Empty>}</Row>
          <Row label="Address">{record.address || <Empty>Not recorded</Empty>}</Row>
          <Row label="Emergency contact">
            {record.emergencyContactName ? (
              <span className="capitalize">
                {record.emergencyContactName}
                {record.emergencyContactRelation ? ` · ${record.emergencyContactRelation}` : ""}
              </span>
            ) : (
              <Empty>Not recorded</Empty>
            )}
            {record.emergencyContactPhone ? (
              <span className="block font-mono tabular-nums">{record.emergencyContactPhone}</span>
            ) : null}
          </Row>
          <Row label="MRN">
            <span className="font-mono text-muted-foreground">{record.mrn}</span>
          </Row>
          <Row label="Name">
            <span className="capitalize">{record.name}</span>
          </Row>
          <Row label="Sex">
            <span className="capitalize">{record.sex}</span>
          </Row>
          <Row label="Blood group">{record.bloodGroup ?? <Empty>Not recorded</Empty>}</Row>
          <Row label="Date of birth">
            {formatBusinessDate(record.dateOfBirth)}
            {record.dobEstimated ? <Empty> · estimated from age</Empty> : null}
          </Row>
          <Row label="Age">
            <span className="tabular-nums">{ageLabel}</span> years
          </Row>
          <Row label="National ID / UID">
            {record.uid ? (
              <span className="font-mono">{record.uid}</span>
            ) : (
              <Empty>Not recorded</Empty>
            )}
          </Row>
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
      </Panel>

      <PatientSheet orgSlug={orgSlug} patient={record} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
