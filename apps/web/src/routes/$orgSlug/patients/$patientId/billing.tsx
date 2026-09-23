import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageBody } from "@/components/page";
import { PatientBilling } from "@/components/patient-record/billing";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { usePatientRecord } from "@/lib/patient-record";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/patients/$patientId/billing")({
  head: () => ({ meta: [{ title: "Patient billing · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    await requireOrgPermission(queryClient, orgSlug, { billing: ["read"] }, "/$orgSlug/dashboard");
    await queryClient
      .query(orpc.patient.account.queryOptions({ input: { orgSlug, patientId } }))
      .catch(() => {});
  },
  component: PatientBillingRoute,
});

function PatientBillingRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const record = usePatientRecord();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const account = useQuery(orpc.patient.account.queryOptions({ input: { orgSlug, patientId } }));

  return (
    <PageBody width="max-w-5xl">
      <PatientBilling
        orgSlug={orgSlug}
        patientId={patientId}
        plans={record.openTreatmentPlans}
        currency={currency}
        account={account.data}
        error={account.error}
      />
    </PageBody>
  );
}
