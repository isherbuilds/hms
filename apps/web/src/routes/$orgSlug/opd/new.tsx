import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { OpdIntakeForm } from "@/components/opd-intake-form";
import { PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

const intakeSearch = z.object({
  patientId: z.string().optional(),
  treatmentPlanId: z.string().optional(),
});

// Wider than the grant its name suggests: both selects are fed from the staff
// lists, so `opd:create` alone would get a form it could never submit.
// `billing:write` stays out — the form degrades to scheduling without it.
const INTAKE_PERMISSION = {
  opd: ["create"],
  patient: ["read"],
  staff: ["read"],
} as const;

export const Route = createFileRoute("/$orgSlug/opd/new")({
  head: () => ({ meta: [{ title: "Appointment · HMS" }] }),
  validateSearch: intakeSearch,
  loaderDeps: ({ search: { patientId, treatmentPlanId } }) => ({ patientId, treatmentPlanId }),
  loader: async ({
    context: { queryClient },
    params: { orgSlug },
    deps: { patientId, treatmentPlanId },
  }) => {
    await requireOrgPermission(queryClient, orgSlug, INTAKE_PERMISSION, "/$orgSlug/opd");

    const [patient] = await Promise.all([
      // `?patientId` fixes the patient and the picker is not offered, so a failed read
      // must stop the page instead of falling back to a free choice.
      patientId
        ? loadRouteQuery(
            queryClient.query(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } })),
          )
        : undefined,
      queryClient.query(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.query(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
    ]);

    return {
      seedPatient: patient ? { id: patient.id, name: patient.name, mrn: patient.mrn } : undefined,
      seedTreatmentPlanId: patient?.openTreatmentPlans.some((plan) => plan.id === treatmentPlanId)
        ? treatmentPlanId
        : undefined,
    };
  },
  component: NewOpdAppointmentRoute,
});

function NewOpdAppointmentRoute() {
  const { orgSlug } = Route.useParams();
  const { seedPatient, seedTreatmentPlanId } = Route.useLoaderData();

  const departments = useSuspenseQuery(
    orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }),
  ).data;

  const practitioners = useSuspenseQuery(
    orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }),
  ).data;

  return (
    <>
      <PageHeader title="Appointment" />
      <PageBody className="mx-auto w-full max-w-6xl pb-24 lg:pb-4">
        <OpdIntakeForm
          // The seed only feeds the form's defaults, so a new `?patientId` remounts it.
          key={`${seedPatient?.id ?? ""}:${seedTreatmentPlanId ?? ""}`}
          orgSlug={orgSlug}
          seedPatient={seedPatient}
          seedTreatmentPlanId={seedTreatmentPlanId}
          departments={departments}
          practitioners={practitioners}
        />
      </PageBody>
    </>
  );
}
