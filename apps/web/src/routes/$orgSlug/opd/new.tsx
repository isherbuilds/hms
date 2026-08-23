import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { OpdIntakeForm, type IntakeMode } from "@/components/opd-intake-form";
import { type SelectedPatient } from "@/components/opd-patient-picker";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";

const intakeSearch = z.object({
  patientId: z.string().optional(),
  mode: z.enum(["walk_in", "scheduled"]).optional(),
});

export const Route = createFileRoute("/$orgSlug/opd/new")({
  head: () => ({ meta: [{ title: "New OPD appointment · HMS" }] }),
  validateSearch: intakeSearch,
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await Promise.all([
      queryClient.prefetchQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(
        orpc.catalog.list.queryOptions({ input: { orgSlug, activeOnly: true } }),
      ),
      queryClient.ensureQueryData(orpc.member.me.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: NewOpdAppointmentRoute,
});

function NewOpdAppointmentRoute() {
  const { orgSlug } = Route.useParams();
  const { mode = "walk_in", patientId } = Route.useSearch();
  const navigate = useNavigate();
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data.roles;
  const canCreate =
    authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] });
  const canSettleWalkIn = canCreate && authorize(roles, { billing: ["write"] });
  const initialMode: IntakeMode = mode === "walk_in" && !canSettleWalkIn ? "scheduled" : mode;

  const preselected = useQuery({
    ...orpc.patient.get.queryOptions({ input: { orgSlug, patientId: patientId ?? "" } }),
    enabled: Boolean(patientId),
  });
  const [chosen, setChosen] = useState<SelectedPatient | null>(null);
  const patient: SelectedPatient | null = patientId
    ? preselected.data
      ? { id: preselected.data.id, name: preselected.data.name, mrn: preselected.data.mrn }
      : null
    : chosen;
  const back = () => void navigate({ to: "/$orgSlug/opd", params: { orgSlug } });

  if (!canCreate) {
    return (
      <>
        <PageHeader title="New OPD appointment" />
        <ErrorNote
          title="You cannot create OPD appointments"
          detail="Creating an appointment needs OPD create and patient read access."
          inset
        />
      </>
    );
  }

  if (patientId && preselected.isPending) {
    return (
      <>
        <PageHeader title="New OPD appointment" />
        <PageBody className="mx-auto w-full max-w-6xl" />
      </>
    );
  }

  if (patientId && preselected.isError) {
    return (
      <>
        <PageHeader title="New OPD appointment" />
        <ErrorNote title="Could not load the patient" detail={preselected.error.message} inset />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New OPD appointment"
        description="Walk-ins and scheduled appointments share one intake"
        action={
          <Button size="sm" variant="ghost" onClick={back}>
            Cancel
          </Button>
        }
      />
      <PageBody className="mx-auto w-full max-w-6xl pb-24 xl:pb-4">
        <OpdIntakeForm
          key={initialMode}
          orgSlug={orgSlug}
          initialMode={initialMode}
          patient={patient}
          canSettleWalkIn={canSettleWalkIn}
          onChangePatient={patientId ? undefined : () => setChosen(null)}
          onSelectPatient={setChosen}
        />
      </PageBody>
    </>
  );
}
