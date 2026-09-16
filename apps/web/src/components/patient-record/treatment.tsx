import type { AppRouter } from "@hms/api/routers/index";
import { Button } from "@hms/ui/components/button";
import type { RouterClient } from "@orpc/server";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ErrorNote } from "@/components/page";
import { PlanItemRow } from "@/components/treatment-plan-item";
import { ReasonDialog, type ReasonTarget } from "@/components/treatment-dialogs";
import { useCan } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

type Plan = Awaited<ReturnType<RouterClient<AppRouter>["treatment"]["listForPatient"]>>[number];

/** The patient's courses of care. Plans are started and worked from the visit that delivers them. */
export function PatientTreatment({
  orgSlug,
  patientId,
  currency,
}: {
  orgSlug: string;
  patientId: string;
  currency: string;
}) {
  const canEdit = useCan(orgSlug, { treatment: ["update"] });

  const plans = useQuery(
    orpc.treatment.listForPatient.queryOptions({ input: { orgSlug, patientId } }),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Courses of care and their delivered work. Start a plan from the patient's visit.
      </p>
      {plans.isError ? (
        <ErrorNote title="Could not load treatment plans" error={plans.error} />
      ) : null}
      {plans.data?.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground">
          No treatment plan has been created for this patient.
        </p>
      ) : null}
      {plans.data?.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          orgSlug={orgSlug}
          currency={currency}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  orgSlug,
  currency,
  canEdit,
}: {
  plan: Plan;
  orgSlug: string;
  currency: string;
  canEdit: boolean;
}) {
  const [reasonFor, setReasonFor] = useState<ReasonTarget | null>(null);
  const editable = canEdit && plan.status === "open";

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{plan.label}</h2>
          <p className="capitalize text-muted-foreground">
            {practitionerDisplayName(plan.practitionerName)} · {plan.status}
          </p>
        </div>
        {editable ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setReasonFor({ kind: "close", planId: plan.id })}
          >
            Close
          </Button>
        ) : null}
      </header>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Sittings</dt>
          <dd>{plan.sittings.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{plan.status === "open" ? "Next" : "Status"}</dt>
          <dd className="capitalize">
            {plan.status !== "open"
              ? plan.status
              : plan.nextSittingOn
                ? formatBusinessDate(plan.nextSittingOn)
                : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quoted</dt>
          <dd>{formatMoney(plan.quotedTotal, currency)}</dd>
        </div>
      </dl>
      {plan.status === "open" && plan.nextSittingNote ? (
        <p className="text-muted-foreground">{plan.nextSittingNote}</p>
      ) : null}
      {plan.closeReason ? (
        <p className="text-muted-foreground">Closed: {plan.closeReason}</p>
      ) : null}
      <div className="flex flex-col divide-y border-t">
        {plan.items.map((item) => (
          <PlanItemRow
            key={item.id}
            item={item}
            currency={currency}
            action={
              editable && item.status === "open" && !item.done ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setReasonFor({ kind: "drop", itemId: item.id })}
                >
                  Drop
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {reasonFor ? (
        <ReasonDialog orgSlug={orgSlug} target={reasonFor} onClose={() => setReasonFor(null)} />
      ) : null}
    </article>
  );
}
