import { createFileRoute } from "@tanstack/react-router";
import { PageBody } from "@/components/page";
import { PatientTreatment } from "@/components/patient-record/treatment";
import { useMembership } from "@/lib/membership";
import { requireOrgPermission } from "@/lib/route-permission";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/$orgSlug/patients/$patientId/treatment")({
  head: () => ({ meta: [{ title: "Patient treatment · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { treatment: ["read"] },
      "/$orgSlug/dashboard",
    );
    await queryClient
      .query(orpc.treatment.listForPatient.queryOptions({ input: { orgSlug, patientId } }))
      .catch(() => {});
  },
  component: PatientTreatmentRoute,
});

function PatientTreatmentRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  return (
    <PageBody width="max-w-5xl">
      <PatientTreatment orgSlug={orgSlug} patientId={patientId} currency={currency} />
    </PageBody>
  );
}
