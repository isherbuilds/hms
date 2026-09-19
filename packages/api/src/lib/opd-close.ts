import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { charges } from "@hms/db/schema/charges";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { treatmentPlanItems } from "@hms/db/schema/treatment-plan-items";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { and, asc, eq, inArray, lt, type SQL } from "drizzle-orm";

import { audit } from "../audit";
import { impossible } from "./conflict";

/**
 * Voids the pending charges `where` selects. A plan counts pending charges as delivered,
 * so the plans those charges deliver lock first, the order `complete` and `postToVisit`
 * take them in, and a completed plan that loses delivery reopens. The caller must already
 * lock the charges' appointments, which queues a concurrent `postToVisit` claim.
 */
export async function voidPendingCharges(options: {
  tx: DbTransaction;
  orgId: string;
  where: SQL;
  reason: string;
  now: Date;
}) {
  const { tx, orgId } = options;
  const pending = and(eq(charges.orgId, orgId), eq(charges.status, "pending"), options.where);

  const plans = await tx
    .select({
      id: treatmentPlans.id,
      status: treatmentPlans.status,
      itemStatus: treatmentPlanItems.status,
    })
    .from(charges)
    .innerJoin(
      treatmentPlanItems,
      and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.id, charges.sourceId)),
    )
    .innerJoin(
      treatmentPlans,
      and(
        eq(treatmentPlans.orgId, orgId),
        eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId),
      ),
    )
    .where(and(pending, eq(charges.sourceType, "treatment_plan")))
    .orderBy(asc(treatmentPlans.id))
    .for("update", { of: treatmentPlans });

  const voided = await tx
    .update(charges)
    .set({ status: "voided", voidReason: options.reason, updatedAt: options.now })
    .where(pending)
    .returning();

  // A dropped item never counted toward completion, so voiding its delivery changes nothing.
  const completed = plans
    .filter((plan) => plan.status === "completed" && plan.itemStatus !== "dropped")
    .map((plan) => plan.id);

  if (completed.length > 0) {
    await tx
      .update(treatmentPlans)
      .set({ status: "open", completedAt: null, updatedAt: options.now })
      .where(and(eq(treatmentPlans.orgId, orgId), inArray(treatmentPlans.id, completed)));
  }

  return voided;
}

export async function closeExpiredBookings(options: {
  orgId: string;
  actorId: string;
  currentDay: string;
  now: Date;
}): Promise<void> {
  const swept = await db.transaction(async (tx) => {
    const closed = await tx
      .update(opdAppointments)
      .set({ status: "no_show", noShowAt: options.now, updatedAt: options.now })
      .where(
        and(
          eq(opdAppointments.orgId, options.orgId),
          lt(opdAppointments.businessDate, options.currentDay),
          eq(opdAppointments.status, "booked"),
        ),
      )
      .returning({ id: opdAppointments.id });

    const voided =
      closed.length === 0
        ? []
        : await voidPendingCharges({
            tx,
            orgId: options.orgId,
            where: inArray(
              charges.opdAppointmentId,
              closed.map((appointment) => appointment.id),
            ),
            reason: "No-show",
            now: options.now,
          });

    const voidedByAppointment = new Map<string, number>();

    // Every voided charge here came through the appointment predicate above.
    for (const charge of voided) {
      if (charge.opdAppointmentId === null) throw impossible("swept charge has no appointment");

      voidedByAppointment.set(
        charge.opdAppointmentId,
        (voidedByAppointment.get(charge.opdAppointmentId) ?? 0) + 1,
      );
    }

    return closed.map((appointment) => ({
      id: appointment.id,
      voidedCharges: voidedByAppointment.get(appointment.id) ?? 0,
    }));
  });

  for (const appointment of swept) {
    audit({
      action: "opd.no_show",
      actorId: options.actorId,
      orgId: options.orgId,
      target: `opd:${appointment.id}`,
      meta: { voidedCharges: appointment.voidedCharges, source: "past_day_sweep" },
    });
  }
}
