import type { DbTransaction } from "@hms/db/counter";
import { admissionBedStays, bedReservations, beds } from "@hms/db/schema/ipd";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { audit } from "../audit";
import { conflict } from "./conflict";
import type { Scope } from "./procedures/factory";

// A desk entry a few minutes late is ordinary; anything older is a correction.
export const BACKDATE_TOLERANCE_MS = 10 * 60 * 1_000;

export async function requireInScope<T>(promise: Promise<T[]>, message: string): Promise<T> {
  const [row] = await promise;

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message });
  }

  return row;
}

export type LockedBed = {
  id: string;
  categoryId: string;
  active: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
};

// Locks beds in id order so two transfers touching the same pair cannot deadlock.
export async function lockBeds(
  tx: DbTransaction,
  orgId: string,
  bedIds: string[],
): Promise<Map<string, LockedBed>> {
  const ordered = [...new Set(bedIds)].sort();

  const rows = await tx
    .select({
      id: beds.id,
      categoryId: beds.categoryId,
      active: beds.active,
      blockedAt: beds.blockedAt,
      blockedReason: beds.blockedReason,
    })
    .from(beds)
    .where(and(eq(beds.orgId, orgId), inArray(beds.id, ordered)))
    .orderBy(asc(beds.id))
    .for("update");

  return new Map(rows.map((row) => [row.id, row]));
}

export async function assertUnoccupied(tx: DbTransaction, orgId: string, bedId: string) {
  const [stay] = await tx
    .select({ id: admissionBedStays.id })
    .from(admissionBedStays)
    .where(
      and(
        eq(admissionBedStays.orgId, orgId),
        eq(admissionBedStays.bedId, bedId),
        isNull(admissionBedStays.endedAt),
      ),
    )
    .limit(1);

  if (stay) {
    throw new ORPCError("CONFLICT", { message: "That bed is occupied." });
  }
}

export type Window = { plannedArrivalAt: Date; plannedDepartureAt: Date };

// A confirmed hold promises its bed until it lapses; `window` narrows to holds that
// overlap it, half-open, so back-to-back stays never clash.
export function liveHolds(
  orgId: string,
  bedId: string,
  now: Date,
  window?: Window,
  exceptId?: string,
) {
  return and(
    eq(bedReservations.orgId, orgId),
    eq(bedReservations.bedId, bedId),
    eq(bedReservations.status, "confirmed"),
    gt(bedReservations.holdUntil, now),
    window ? lt(bedReservations.plannedArrivalAt, window.plannedDepartureAt) : undefined,
    window ? gt(bedReservations.plannedDepartureAt, window.plannedArrivalAt) : undefined,
    exceptId ? ne(bedReservations.id, exceptId) : undefined,
  );
}

// Callers hold the bed lock, which every writer of a hold on that bed takes first.
export async function assertNoOverlappingHold(
  tx: DbTransaction,
  orgId: string,
  bedId: string,
  window: Window,
  exceptId: string,
  now: Date,
) {
  const [clash] = await tx
    .select({ id: bedReservations.id })
    .from(bedReservations)
    .where(liveHolds(orgId, bedId, now, window, exceptId))
    .limit(1);

  if (clash) {
    throw new ORPCError("CONFLICT", { message: "That bed is already held for those dates." });
  }
}

export function auditReservation(
  scope: Scope,
  action: string,
  reservationId: string,
  meta: Record<string, string | null | undefined>,
) {
  audit({
    action,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `bed_reservation:${reservationId}`,
    meta,
  });
}

// One entry per disrupted hold, after commit, naming the command that caused it.
export function auditDisruptions(
  scope: Scope,
  disrupted: { id: string }[],
  meta: { reason: string; cause: string; bedId: string; admissionId?: string },
) {
  for (const hold of disrupted) auditReservation(scope, "ipd.reservation.disrupt", hold.id, meta);
}

// Open occupancy has no promised end, so any live hold on the bed stands in its way
// unless an authorized caller displaces it, with a reason, in the same transaction.
// A conversion passes its own hold as `exceptId`: only that one is consumed.
// A displaced hold stays visible on the worklist until staff confirm it elsewhere or cancel it.
export async function clearHoldsForOccupancy(
  tx: DbTransaction,
  orgId: string,
  bedId: string,
  displace: { reason: string } | undefined,
  now: Date,
  exceptId?: string,
) {
  // Reservation rows lock after the bed, by id (D040).
  const holds = await tx
    .select({ id: bedReservations.id })
    .from(bedReservations)
    .where(liveHolds(orgId, bedId, now, undefined, exceptId))
    .orderBy(asc(bedReservations.id))
    .for("update");

  const ids = holds.map((hold) => hold.id);

  if (ids.length === 0) return [];

  if (!displace) {
    throw conflict(
      "bed_held",
      exceptId
        ? "Another reservation is held on this bed. Move or cancel it first."
        : "That bed is held for a planned arrival.",
    );
  }

  return tx
    .update(bedReservations)
    .set({
      status: "disrupted",
      disruptedReason: displace.reason,
      revision: sql`${bedReservations.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(bedReservations.orgId, orgId), inArray(bedReservations.id, ids)))
    .returning({ id: bedReservations.id });
}
