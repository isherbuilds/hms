import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import { NativeSelect } from "@hms/ui/components/native-select";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { ErrorNote } from "@/components/page";
import { PlanItemRow } from "@/components/treatment-plan-item";
import {
  AddItemDialog,
  NewPlanDialog,
  NextSittingDialog,
  ReasonDialog,
  type TreatmentAction,
} from "@/components/treatment-dialogs";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { useOpdRecord } from "@/lib/opd-record";
import { orpc } from "@/lib/orpc";
import { closeOnConflict } from "@/lib/orpc-error";

export function OpdTreatmentPanel({
  orgSlug,
  appointmentId,
}: {
  orgSlug: string;
  appointmentId: string;
}) {
  const { record } = useOpdRecord();
  const { appointment } = record;
  const planId = appointment.treatmentPlanId;
  // Currency comes from membership, so a cashier without `settings:read` still sees prices.
  const { roles, currency } = useMembership(orgSlug);
  const canEdit = authorize(roles, { treatment: ["create", "update"] });
  const checkedIn = appointment.status === "checked_in";
  const canLink = canEdit && (appointment.status === "booked" || checkedIn);
  const canPost = checkedIn && authorize(roles, { billing: ["write"] });

  const patientId = record.patient?.id;

  const [action, setAction] = useState<TreatmentAction | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [dropping, setDropping] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const plans = useQuery(
    orpc.treatment.listForPatient.queryOptions({
      input: patientId && (planId || canLink) ? { orgSlug, patientId } : skipToken,
    }),
  );

  // A CONFLICT resets the plan picker too: its options moved.
  const done = (success: string) => ({
    onSuccess: () => {
      setSelectedPlanId("");
      toast.success(success);
    },
    onError: closeOnConflict(() => setSelectedPlanId("")),
  });

  const link = useMutation(
    orpc.treatment.linkVisit.mutationOptions(done("Visit linked to treatment plan")),
  );

  const post = useMutation(
    orpc.treatment.postToVisit.mutationOptions(done("Sitting posted to this visit")),
  );

  const complete = useMutation(
    orpc.treatment.complete.mutationOptions(done("Treatment plan completed")),
  );

  // A booked caller has no patient yet; a plan needs one.
  if (!patientId || (!planId && !canLink)) return null;

  if (!plans.data) {
    return plans.error ? (
      <ErrorNote title="Could not load treatment plans" error={plans.error} />
    ) : null;
  }

  const plan = plans.data.find((entry) => entry.id === planId);
  const openPlans = plans.data.filter((entry) => entry.status === "open");
  const openPlan = plan?.status === "open" ? plan : undefined;
  const editable = canEdit && openPlan !== undefined;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 print:hidden">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-h-6 text-xs text-muted-foreground">Treatment</h2>
        {!planId && canLink ? (
          <Button size="xs" onClick={() => setAction("new")}>
            New plan
          </Button>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => setAction("add")}>
              Add item
            </Button>
            <Button size="xs" variant="outline" onClick={() => setAction("next")}>
              Next sitting
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={complete.isPending}
              onClick={() => complete.mutate({ orgSlug, planId: openPlan.id })}
            >
              Complete
            </Button>
          </div>
        ) : null}
      </header>
      {!planId ? (
        canLink && openPlans.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              className="max-w-sm"
              aria-label="Open treatment plan"
              value={selectedPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
            >
              <option value="">Choose an open plan</option>
              {openPlans.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="xs"
              variant="outline"
              disabled={!selectedPlanId || link.isPending}
              onClick={() => link.mutate({ orgSlug, appointmentId, planId: selectedPlanId })}
            >
              Link to plan
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">This visit is not linked to a treatment plan.</p>
        )
      ) : plan ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{plan.label}</p>
            <p className="tabular-nums text-muted-foreground">
              {/* A visit not yet checked in is not a sitting; it would be the next one. */}
              Sitting{" "}
              {plan.sittings.findIndex((entry) => entry.id === appointmentId) + 1 ||
                plan.sittings.length + 1}{" "}
              ·{" "}
              {plan.status !== "open"
                ? plan.status
                : plan.nextSittingOn
                  ? `next ${formatBusinessDate(plan.nextSittingOn)}`
                  : "next not set"}{" "}
              · posted {formatMoney(plan.postedAmount, currency)} of{" "}
              {formatMoney(plan.quotedTotal, currency)}
            </p>
          </div>
          <div className="flex flex-col divide-y">
            {plan.items.map((item) => {
              const unposted = item.quotedPrice - item.postedAmount;

              const postItem = (rest: boolean) => {
                const submit = () =>
                  post.mutate({
                    orgSlug,
                    appointmentId,
                    itemId: item.id,
                    rest,
                  });

                // An ordinary charge for the same service may be this work;
                // the desk decides, the server never guesses (D038).
                const billed = record.charges.some(
                  (charge) =>
                    charge.catalogItemId === item.catalogItemId &&
                    charge.sourceType === "catalog" &&
                    charge.status !== "voided",
                );

                if (!billed) return submit();

                const label = rest ? "Bill rest" : "Post to this visit";
                confirm({
                  title: label,
                  description: `This visit already bills ${item.description} as a service. If that was this work, void or credit it in Billing after posting.`,
                  confirmLabel: label,
                  run: submit,
                });
              };

              return (
                <PlanItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  action={
                    plan.status === "open" && item.status === "open" && !item.done ? (
                      <>
                        {canPost ? (
                          <>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={post.isPending}
                              onClick={() => postItem(false)}
                            >
                              Post to this visit
                            </Button>
                            {item.nextSittingPrice !== unposted ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={post.isPending}
                                onClick={() => postItem(true)}
                              >
                                Bill rest
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        {editable ? (
                          <Button size="xs" variant="ghost" onClick={() => setDropping(item.id)}>
                            Drop
                          </Button>
                        ) : null}
                      </>
                    ) : null
                  }
                />
              );
            })}
          </div>
          {plan.status === "open" && plan.nextSittingNote ? (
            <p className="text-muted-foreground">{plan.nextSittingNote}</p>
          ) : null}
        </>
      ) : null}
      {canLink && action === "new" && !planId ? (
        <NewPlanDialog
          orgSlug={orgSlug}
          patientId={patientId}
          appointmentId={appointmentId}
          practitionerId={record.practitioner.id}
          onClose={() => setAction(null)}
        />
      ) : null}
      {editable && action === "add" ? (
        <AddItemDialog orgSlug={orgSlug} planId={openPlan.id} onClose={() => setAction(null)} />
      ) : null}
      {editable && action === "next" ? (
        <NextSittingDialog orgSlug={orgSlug} plan={openPlan} onClose={() => setAction(null)} />
      ) : null}
      {confirmDialog}
      {editable && dropping ? (
        <ReasonDialog
          orgSlug={orgSlug}
          target={{ kind: "drop", itemId: dropping }}
          onClose={() => setDropping(null)}
        />
      ) : null}
    </section>
  );
}
