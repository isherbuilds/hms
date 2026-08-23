import { Button, buttonVariants } from "@hms/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { PencilIcon, PlusIcon } from "lucide-react";
import { type ReactNode } from "react";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { patientAgeYears } from "@/lib/patient-age";

export const Route = createFileRoute("/$orgSlug/patients/$patientId")({
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await loadRouteQuery(
      queryClient.fetchQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } })),
    );
  },
  // Editing is a panel over this record rather than a mode the page drops into,
  // so its open state lives in the URL: the link is shareable and Back closes it.
  validateSearch: z.object({ edit: z.boolean().optional().catch(undefined) }),
  component: PatientDetailRoute,
});

/** One line of the record. Empty values say so rather than leaving a gap. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border/60 py-2 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={children ? undefined : "text-muted-foreground"}>
        {children || "Not recorded"}
      </dd>
    </div>
  );
}

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const { edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today } = useOrgDateTime();
  const patient = useQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }));

  const record = patient.data;
  const age = record ? patientAgeYears(record.dateOfBirth, record.ageYears, today) : null;

  return (
    <>
      <PageHeader
        title={record ? `${record.mrn} · ${record.name}` : "Patient"}
        action={
          record ? (
            <>
              <Button variant="outline" onClick={() => navigate({ search: { edit: true } })}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
              <Link
                className={buttonVariants()}
                to="/$orgSlug/opd/new"
                params={{ orgSlug }}
                search={{ patientId }}
              >
                <PlusIcon data-icon="inline-start" />
                Add to OPD queue
              </Link>
            </>
          ) : undefined
        }
      />
      <PageBody className="max-w-2xl">
        {patient.isPending ? null : patient.isError ? (
          <ErrorNote title="Could not load patient" detail={patient.error.message} />
        ) : record ? (
          <dl className="flex flex-col">
            <Detail label="MRN">
              <span className="font-mono">{record.mrn}</span>
            </Detail>
            <Detail label="Name">{record.name}</Detail>
            <Detail label="Phone">
              <span className="font-mono tabular-nums">{record.phone}</span>
            </Detail>
            <Detail label="Sex">
              <span className="capitalize">{record.sex}</span>
            </Detail>
            <Detail label="Age">{age !== null ? `${age}` : null}</Detail>
            <Detail label="Date of birth">
              {record.dateOfBirth ? formatBusinessDate(record.dateOfBirth) : null}
            </Detail>
            <Detail label="Email">{record.email}</Detail>
            <Detail label="National ID / UID">
              {record.uid ? <span className="font-mono">{record.uid}</span> : null}
            </Detail>
            <Detail label="Blood group">{record.bloodGroup}</Detail>
            <Detail label="Address">{record.address}</Detail>
            <Detail label="Allergies">{record.allergies}</Detail>
            <Detail label="Medical history">{record.medicalHistory}</Detail>
          </dl>
        ) : null}
      </PageBody>

      {record ? (
        <PatientSheet
          orgSlug={orgSlug}
          patient={{
            id: patientId,
            name: record.name,
            phone: record.phone,
            sex: record.sex,
            dateOfBirth: record.dateOfBirth,
            ageYears: record.ageYears,
            address: record.address,
            email: record.email,
            bloodGroup: record.bloodGroup,
            allergies: record.allergies,
            medicalHistory: record.medicalHistory,
            uid: record.uid,
          }}
          open={edit === true}
          onOpenChange={(next) => navigate({ search: next ? { edit: true } : {} })}
        />
      ) : null}
    </>
  );
}
