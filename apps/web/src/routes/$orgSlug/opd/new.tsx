import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { isIntakeFormDirty, OpdIntakeForm } from "@/components/opd-intake-form";
import { PageBody, PageHeader } from "@/components/page";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

const intakeSearch = z.object({
  patientId: z.string().optional(),
  includeClosed: z.boolean().optional().catch(undefined),
});

const DISCARD = {
  title: "Discard unsaved appointment?",
  description: "This appointment has changes that have not been saved.",
  confirmLabel: "Discard changes",
};

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
  loaderDeps: ({ search: { patientId } }) => ({ patientId }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps: { patientId } }) => {
    await requireOrgPermission(queryClient, orgSlug, INTAKE_PERMISSION, "/$orgSlug/opd");

    // Prefetch only: every value is read from the cache by the component that draws it.
    await Promise.all([
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
  },
  component: NewOpdAppointmentRoute,
});

function NewOpdAppointmentRoute() {
  const { orgSlug } = Route.useParams();
  const patientId = Route.useSearch({ select: (search) => search.patientId });
  const { today } = useOrgDateTime();
  const blocker = useBlocker({
    shouldBlockFn: isIntakeFormDirty,
    enableBeforeUnload: isIntakeFormDirty,
    withResolver: true,
  });

  return (
    <>
      <PageHeader title="Appointment" description={formatBusinessDate(today)} />
      <PageBody className="mx-auto w-full max-w-6xl pb-24 xl:pb-4">
        <OpdIntakeForm orgSlug={orgSlug} seedPatientId={patientId} />
      </PageBody>
      {blocker.status === "blocked" ? (
        <ConfirmDialog {...DISCARD} open onConfirm={blocker.proceed} onCancel={blocker.reset} />
      ) : null}
    </>
  );
}
