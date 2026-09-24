import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { NativeSelect } from "@hms/ui/components/native-select";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
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
    orpc.treatment.linkVisit.mutationOptions(done("Visit added to treatment plan")),
  );

  const post = useMutation(
    orpc.treatment.postToVisit.mutationOptions(done("Added to this visit's bill")),
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

  // Completion is refused while work is unbilled, so it is offered only once it can succeed.
  const finished = openPlan?.items.every((item) => item.status === "dropped" || item.done);
  // Preselected, so the usual single open plan is one click.
  const chosenPlanId = selectedPlanId || openPlans[0]?.id;

  const sitting =
    plan &&
    // A visit not yet checked in is not a sitting; it would be the next one.
    (plan.sittings.findIndex((entry) => entry.id === appointmentId) + 1 ||
      plan.sittings.length + 1);

  return (
    <section className="flex flex-col gap-3 print:hidden">
      <header className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h2 className="text-muted-foreground">Treatment plan</h2>
        {!planId && canLink ? (
          <Button variant="outline" onClick={() => setAction("new")}>
            New plan
          </Button>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" onClick={() => setAction("add")}>
              Add item
            </Button>
            {/* Kept after full billing: a course can run past its estimate. */}
            <Button variant="outline" onClick={() => setAction("next")}>
              Next sitting
            </Button>
            {finished ? (
              <Button
                disabled={complete.isPending}
                onClick={() => complete.mutate({ orgSlug, planId: openPlan.id })}
              >
                Complete plan
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      {!planId ? (
        canLink && chosenPlanId ? (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              className="max-w-sm"
              aria-label="Open treatment plan"
              value={chosenPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
            >
              {openPlans.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              disabled={link.isPending}
              onClick={() => link.mutate({ orgSlug, appointmentId, planId: chosenPlanId })}
            >
              Add visit to plan
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">No treatment plan for this visit.</p>
        )
      ) : plan ? (
        <>
          {/* The items below name the plan and carry their own amounts; a plan total
              adds something only when there is more than one item. */}
          <p className="tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">Sitting {sitting}</span>
            {plan.items.length > 1
              ? ` · ${formatMoney(plan.postedAmount, currency)} of ${formatMoney(plan.quotedTotal, currency)} billed`
              : null}
            {" · "}
            {plan.status !== "open" ? (
              <span className="capitalize">{plan.status}</span>
            ) : (
              <>
                Next sitting{" "}
                {plan.nextSittingOn ? formatBusinessDate(plan.nextSittingOn) : "not set"}
                {plan.nextSittingNote ? ` · ${plan.nextSittingNote}` : null}
              </>
            )}
          </p>
          <div className="flex flex-col gap-2">
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

                confirm({
                  title: "Already on this bill?",
                  description: `This visit's bill already has ${item.description}. If that was the same work, bill it here and then remove the other charge in Billing.`,
                  confirmLabel: "Bill anyway",
                  run: submit,
                });
              };

              const open = plan.status === "open" && item.status === "open" && !item.done;

              // One sitting per visit: the server refuses a second posting here.
              const billedHere = record.charges.some(
                (charge) =>
                  charge.sourceType === "treatment_plan" &&
                  charge.sourceId === item.id &&
                  charge.status !== "voided",
              );

              return (
                <PlanItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  action={
                    open && editable ? (
                      <ClientOnly fallback={<span className="inline-block size-8" />}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon" />}
                            aria-label={`More actions for ${item.description}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-36">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDropping(item.id)}
                              >
                                Drop item
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ClientOnly>
                    ) : null
                  }
                >
                  {open && billedHere ? (
                    <p className="font-medium text-clinical-clear">Billed for this visit</p>
                  ) : open && canPost && item.nextSittingPrice !== null ? (
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={post.isPending} onClick={() => postItem(false)}>
                        Bill this sitting · {formatMoney(item.nextSittingPrice, currency)}
                      </Button>
                      {/* Finishing early: the whole balance in one go. */}
                      {item.nextSittingPrice !== unposted ? (
                        <Button
                          variant="outline"
                          disabled={post.isPending}
                          onClick={() => postItem(true)}
                        >
                          Bill all remaining · {formatMoney(unposted, currency)}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </PlanItemRow>
              );
            })}
          </div>
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
