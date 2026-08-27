import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { useConfirm } from "@/components/confirm-dialog";
import { OpdIntakeForm } from "@/components/opd-intake-form";
import { type SelectedPatient } from "@/components/opd-patient-picker";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

const intakeSearch = z.object({
  patientId: z.string().optional(),
  includeClosed: z.boolean().optional().catch(undefined),
});

const DISCARD = {
  title: "Discard unsaved appointment?",
  description: "This appointment has changes that have not been saved.",
  confirmLabel: "Discard changes",
};

export const Route = createFileRoute("/$orgSlug/opd/new")({
  head: () => ({ meta: [{ title: "Appointment · HMS" }] }),
  validateSearch: intakeSearch,
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await Promise.all([
      queryClient.prefetchQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
      queryClient.ensureQueryData(orpc.member.me.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: NewOpdAppointmentRoute,
});

function NewOpdAppointmentRoute() {
  const { orgSlug } = Route.useParams();
  const { patientId, includeClosed } = Route.useSearch();
  const navigate = useNavigate();
  const [confirm, confirmation] = useConfirm();
  const content = useRef<HTMLDivElement>(null);
  const isDirty = () => content.current?.querySelector("form")?.dataset.dirty === "true";
  const blocker = useBlocker({
    shouldBlockFn: isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });
  const { timeZone, today } = useOrgDateTime();
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data.roles;
  const canCreate =
    authorize(roles, { opd: ["create"] }) && authorize(roles, { patient: ["read"] });
  const canSettleWalkIn = canCreate && authorize(roles, { billing: ["write"] });

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
  const back = () =>
    void navigate({
      to: "/$orgSlug/opd",
      params: { orgSlug },
      search: { includeClosed },
    });

  useEffect(() => {
    if (blocker.status !== "blocked") return;
    confirm({ ...DISCARD, run: blocker.proceed, cancel: blocker.reset });
  }, [blocker, confirm]);

  if (!canCreate) {
    return (
      <>
        <PageHeader title="Appointment" description={formatBusinessDate(today)} />
        <ErrorNote
          title="You cannot create outpatient appointments"
          detail="Creating an appointment needs outpatient and patient access."
          inset
        />
      </>
    );
  }

  if (patientId && preselected.isPending) {
    return (
      <>
        <PageHeader title="Appointment" description={formatBusinessDate(today)} />
        <PageBody className="mx-auto w-full max-w-6xl" />
      </>
    );
  }

  if (patientId && preselected.isError) {
    return (
      <>
        <PageHeader title="Appointment" description={formatBusinessDate(today)} />
        <ErrorNote title="Could not load the patient" detail={preselected.error.message} inset />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Appointment"
        description={formatBusinessDate(today)}
        action={
          <Button variant="secondary" onClick={back}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        }
      />
      <div ref={content}>
        <PageBody className="mx-auto w-full max-w-6xl pb-24 xl:pb-4">
          <OpdIntakeForm
            orgSlug={orgSlug}
            patient={patient}
            initialPatientId={patientId}
            timeZone={timeZone}
            currency={membership.data.currency}
            canSettleWalkIn={canSettleWalkIn}
            onChangePatient={patientId ? undefined : () => setChosen(null)}
            onSelectPatient={setChosen}
          />
        </PageBody>
      </div>
      {confirmation}
    </>
  );
}
