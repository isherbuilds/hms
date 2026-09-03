import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { charges } from "@hms/db/schema/charges";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { and, eq, inArray, lt } from "drizzle-orm";

import { audit } from "../audit";

export async function voidPendingCharges(options: {
  tx: DbTransaction;
  orgId: string;
  appointmentIds: string[];
  reason: string;
  now: Date;
}) {
  if (options.appointmentIds.length === 0) return [];
  return options.tx
    .update(charges)
    .set({ status: "voided", voidReason: options.reason, updatedAt: options.now })
    .where(
      and(
        eq(charges.orgId, options.orgId),
        inArray(charges.opdAppointmentId, options.appointmentIds),
        eq(charges.status, "pending"),
      ),
    )
    .returning({ appointmentId: charges.opdAppointmentId });
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
    const voided = await voidPendingCharges({
      tx,
      orgId: options.orgId,
      appointmentIds: closed.map((appointment) => appointment.id),
      reason: "No-show",
      now: options.now,
    });
    const voidedByAppointment = new Map<string, number>();
    for (const charge of voided) {
      voidedByAppointment.set(
        charge.appointmentId,
        (voidedByAppointment.get(charge.appointmentId) ?? 0) + 1,
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
