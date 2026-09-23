import { createFileRoute } from "@tanstack/react-router";
import { PageBody } from "@/components/page";
import { PatientVisits } from "@/components/patient-record/visits";
import { useMembership } from "@/lib/membership";
import { requireOrgPermission } from "@/lib/route-permission";
import { patientVisitsQuery } from "@/lib/patient-queries";

export const Route = createFileRoute("/$orgSlug/patients/$patientId/visits")({
  head: () => ({ meta: [{ title: "Patient visits · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await requireOrgPermission(queryClient, orgSlug, { opd: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.infiniteQuery(patientVisitsQuery(orgSlug, patientId)).catch(() => {});
  },
  component: PatientVisitsRoute,
});

function PatientVisitsRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  return (
    <PageBody width="max-w-5xl">
      <PatientVisits orgSlug={orgSlug} patientId={patientId} currency={currency} />
    </PageBody>
  );
}
