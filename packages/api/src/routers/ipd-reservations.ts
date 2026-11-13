import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { admissionBedStays, bedCategories, bedReservations, beds, wards } from "@hms/db/schema/ipd";
import { patients } from "@hms/db/schema/patients";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  assertNoOverlappingHold,
  assertUnoccupied,
  auditReservation,
  BACKDATE_TOLERANCE_MS,
  lockBeds,
  requireInScope,
} from "../lib/ipd-beds";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { reason } from "../lib/schemas";

const ARRIVALS_HORIZON_MS = 48 * 60 * 60 * 1_000;

type Window = { plannedArrivalAt: Date; plannedDepartureAt: Date };

// Half-open `[arrival, departure)`; a hold lapses inside it, after arrival.
function requireWindow(window: Window, holdUntil: Date | null | undefined, now: Date) {
  if (window.plannedDepartureAt.getTime() <= window.plannedArrivalAt.getTime()) {
    throw new ORPCError("BAD_REQUEST", { message: "Departure must be after arrival." });
  }

  if (now.getTime() - window.plannedArrivalAt.getTime() > BACKDATE_TOLERANCE_MS) {
    throw new ORPCError("BAD_REQUEST", { message: "That arrival time has already passed." });
  }

  if (holdUntil) requireHoldTime(window, holdUntil, now);
}

function requireHoldTime(window: Window, holdUntil: Date, now: Date) {
  if (
    holdUntil.getTime() <= now.getTime() ||
    holdUntil.getTime() <= window.plannedArrivalAt.getTime() ||
    holdUntil.getTime() > window.plannedDepartureAt.getTime()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Hold the bed until a future time after arrival and no later than departure.",
    });
  }
}

function requireCategory(bed: { categoryId: string }, categoryId: string) {
  if (bed.categoryId !== categoryId) {
    throw new ORPCError("BAD_REQUEST", { message: "That bed is not in the requested category." });
  }
}

// The open stay on the reserved bed, if any, says whether a due hold is overstayed.
function reservationRows(executor: typeof db | DbTransaction, orgId: string, where?: SQL) {
  return executor
    .select({
      id: bedReservations.id,
      patientId: bedReservations.patientId,
      patientName: patients.name,
      mrn: patients.mrn,
      categoryId: bedReservations.categoryId,
      categoryName: bedCategories.name,
      bedId: bedReservations.bedId,
      bedLabel: beds.label,
      wardName: wards.name,
      plannedArrivalAt: bedReservations.plannedArrivalAt,
      plannedDepartureAt: bedReservations.plannedDepartureAt,
      holdUntil: bedReservations.holdUntil,
      status: bedReservations.status,
      revision: bedReservations.revision,
      admissionId: bedReservations.admissionId,
      cancelReason: bedReservations.cancelReason,
      disruptedReason: bedReservations.disruptedReason,
      occupiedBy: admissionBedStays.admissionId,
    })
    .from(bedReservations)
    .innerJoin(
      patients,
      and(eq(patients.orgId, bedReservations.orgId), eq(patients.id, bedReservations.patientId)),
    )
    .innerJoin(
      bedCategories,
      and(
        eq(bedCategories.orgId, bedReservations.orgId),
        eq(bedCategories.id, bedReservations.categoryId),
      ),
    )
    .leftJoin(beds, and(eq(beds.orgId, bedReservations.orgId), eq(beds.id, bedReservations.bedId)))
    .leftJoin(wards, and(eq(wards.orgId, beds.orgId), eq(wards.id, beds.wardId)))
    .leftJoin(
      admissionBedStays,
      and(
        eq(admissionBedStays.orgId, bedReservations.orgId),
        eq(admissionBedStays.bedId, bedReservations.bedId),
        isNull(admissionBedStays.endedAt),
      ),
    )
    .where(and(eq(bedReservations.orgId, orgId), where))
    .orderBy(asc(bedReservations.plannedArrivalAt), asc(bedReservations.id));
}

function reservationView(
  { occupiedBy, ...row }: Awaited<ReturnType<typeof reservationRows>>[number],
  now: Date,
) {
  const lapsed = (row.status === "requested" || row.status === "confirmed") && isLapsed(row, now);

  const effectiveStatus = lapsed ? ("expired" as const) : row.status;

  return {
    ...row,
    effectiveStatus,
    // Actual occupancy stays authoritative: a due hold on an occupied bed is flagged.
    atRisk:
      effectiveStatus === "confirmed" &&
      occupiedBy !== null &&
      row.plannedArrivalAt.getTime() <= now.getTime(),
  };
}

async function readReservation(executor: typeof db | DbTransaction, orgId: string, id: string) {
  const [row] = await reservationRows(executor, orgId, eq(bedReservations.id, id));

  if (!row) throw new ORPCError("NOT_FOUND", { message: "That reservation does not exist." });

  return reservationView(row, new Date());
}

function viewFilter(view: "arrivals" | "waitlist" | "attention" | "all", now: Date) {
  switch (view) {
    case "arrivals":
      return and(
        eq(bedReservations.status, "confirmed"),
        gt(bedReservations.holdUntil, now),
        lte(bedReservations.plannedArrivalAt, new Date(now.getTime() + ARRIVALS_HORIZON_MS)),
      );
    case "waitlist":
      return and(
        eq(bedReservations.status, "requested"),
        or(isNull(bedReservations.holdUntil), gt(bedReservations.holdUntil, now)),
      );
    case "attention":
      return or(
        eq(bedReservations.status, "disrupted"),
        and(
          inArray(bedReservations.status, ["requested", "confirmed"]),
          lte(bedReservations.holdUntil, now),
        ),
        and(
          eq(bedReservations.status, "confirmed"),
          lte(bedReservations.plannedArrivalAt, now),
          isNotNull(admissionBedStays.id),
        ),
      );
    case "all":
      return undefined;
  }
}

type LockedBed = Awaited<ReturnType<typeof lockBeds>> extends Map<string, infer B> ? B : never;

// Lock order (D040) puts the Patient before the Bed and the reservation, so it is
// found through the reservation in the same statement; a reservation's Patient never
// changes. The unlocked bed id names the bed to lock next; the revision check catches a move.
async function lockReservationPatient(tx: DbTransaction, orgId: string, reservationId: string) {
  const [row] = await tx
    .select({ bedId: bedReservations.bedId })
    .from(patients)
    .innerJoin(
      bedReservations,
      and(eq(bedReservations.orgId, patients.orgId), eq(bedReservations.patientId, patients.id)),
    )
    .where(and(eq(patients.orgId, orgId), eq(bedReservations.id, reservationId)))
    .limit(1)
    .for("update", { of: patients });

  // Missing and stale collapse into one CONFLICT (D026).
  if (!row) throw staleReservation();

  return row;
}

function staleReservation() {
  return new ORPCError("CONFLICT", {
    message: "This reservation changed on another screen. Refresh and try again.",
  });
}

async function lockReservation(
  tx: DbTransaction,
  orgId: string,
  reservationId: string,
  expectedRevision: number,
) {
  const [row] = await tx
    .select({
      id: bedReservations.id,
      patientId: bedReservations.patientId,
      categoryId: bedReservations.categoryId,
      bedId: bedReservations.bedId,
      plannedArrivalAt: bedReservations.plannedArrivalAt,
      plannedDepartureAt: bedReservations.plannedDepartureAt,
      holdUntil: bedReservations.holdUntil,
      status: bedReservations.status,
      revision: bedReservations.revision,
    })
    .from(bedReservations)
    .where(and(eq(bedReservations.orgId, orgId), eq(bedReservations.id, reservationId)))
    .limit(1)
    .for("update");

  if (!row || row.revision !== expectedRevision) throw staleReservation();

  return row;
}

function isLapsed(row: { holdUntil: Date | null }, now: Date) {
  return row.holdUntil !== null && row.holdUntil.getTime() <= now.getTime();
}

// Conservative first release: only a ready, empty bed can be promised, even for later dates.
async function assertHoldable(
  tx: DbTransaction,
  orgId: string,
  bed: LockedBed | undefined,
  reservation: Window & { id: string; categoryId: string },
  now: Date,
) {
  if (!bed) throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });

  requireCategory(bed, reservation.categoryId);

  if (!bed.active) throw new ORPCError("CONFLICT", { message: "That bed is not in use." });

  if (bed.blockedAt) {
    throw new ORPCError("CONFLICT", { message: "That bed is blocked until it is released." });
  }

  await assertUnoccupied(tx, orgId, bed.id);
  await assertNoOverlappingHold(tx, orgId, bed.id, reservation, reservation.id, now);
}

// Arrival consumes a live hold for exactly this Patient, bed and window.
export async function lockHoldForArrival(
  tx: DbTransaction,
  orgId: string,
  claim: { reservationId: string; expectedRevision: number; patientId: string; bedId: string },
  at: Date,
  now: Date,
) {
  const row = await lockReservation(tx, orgId, claim.reservationId, claim.expectedRevision);

  if (
    row.status !== "confirmed" ||
    isLapsed(row, now) ||
    row.patientId !== claim.patientId ||
    row.bedId !== claim.bedId
  ) {
    throw new ORPCError("CONFLICT", {
      message: "That reservation is not a live hold for this Patient and bed.",
    });
  }

  if (
    at.getTime() < row.plannedArrivalAt.getTime() ||
    at.getTime() >= row.plannedDepartureAt.getTime()
  ) {
    throw new ORPCError("CONFLICT", {
      message: "The arrival is outside the held dates. Reschedule the reservation first.",
    });
  }

  return row;
}

export async function markConverted(
  tx: DbTransaction,
  orgId: string,
  reservationId: string,
  admissionId: string,
) {
  await tx
    .update(bedReservations)
    .set({
      status: "converted",
      admissionId,
      revision: sql`${bedReservations.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(bedReservations.orgId, orgId), eq(bedReservations.id, reservationId)));
}

// Confirmed, unlapsed holds per bed, for the board; they are not occupancy.
export async function boardHolds(orgId: string, now: Date) {
  const rows = await db
    .select({
      bedId: bedReservations.bedId,
      reservationId: bedReservations.id,
      patientName: patients.name,
      plannedArrivalAt: bedReservations.plannedArrivalAt,
      plannedDepartureAt: bedReservations.plannedDepartureAt,
      holdUntil: bedReservations.holdUntil,
    })
    .from(bedReservations)
    .innerJoin(
      patients,
      and(eq(patients.orgId, bedReservations.orgId), eq(patients.id, bedReservations.patientId)),
    )
    .where(
      and(
        eq(bedReservations.orgId, orgId),
        eq(bedReservations.status, "confirmed"),
        gt(bedReservations.holdUntil, now),
      ),
    )
    .orderBy(asc(bedReservations.plannedArrivalAt), asc(bedReservations.id));

  const byBed = new Map<string, Omit<(typeof rows)[number], "bedId">[]>();

  for (const { bedId, ...hold } of rows) {
    // A confirmed hold always names its bed (bed_reservations_held_check).
    const list = byBed.get(bedId!) ?? [];
    list.push(hold);
    byBed.set(bedId!, list);
  }

  return byBed;
}

const revisionInput = {
  reservationId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
};

const windowInput = {
  plannedArrivalAt: z.date(),
  plannedDepartureAt: z.date(),
  holdUntil: z.date().optional(),
};

export const ipdReservationsRouter = {
  // A waitlist entry: it promises no capacity, so it takes no lock.
  requestBed: orgProcedure(
    { ipd: ["create"] },
    orgInput.extend({
      patientId: z.string(),
      categoryId: z.string(),
      bedId: z.string().optional(),
      ...windowInput,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    requireWindow(input, input.holdUntil, new Date());

    const [, , bed] = await Promise.all([
      requireInScope(
        db
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
          .limit(1),
        "That Patient no longer exists.",
      ),
      requireInScope(
        db
          .select({ id: bedCategories.id })
          .from(bedCategories)
          .where(and(eq(bedCategories.orgId, scope.orgId), eq(bedCategories.id, input.categoryId)))
          .limit(1),
        "That bed category no longer exists.",
      ),
      input.bedId
        ? requireInScope(
            db
              .select({ categoryId: beds.categoryId })
              .from(beds)
              .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
              .limit(1),
            "That bed no longer exists.",
          )
        : null,
    ]);

    if (bed) requireCategory(bed, input.categoryId);

    const id = Bun.randomUUIDv7();

    await db.insert(bedReservations).values({
      id,
      orgId: scope.orgId,
      patientId: input.patientId,
      categoryId: input.categoryId,
      bedId: input.bedId ?? null,
      plannedArrivalAt: input.plannedArrivalAt,
      plannedDepartureAt: input.plannedDepartureAt,
      holdUntil: input.holdUntil ?? null,
      status: "requested",
      createdBy: scope.userId,
    });

    return readReservation(db, scope.orgId, id);
  }),

  listBedReservations: orgProcedure(
    { ipd: ["read"] },
    orgInput.extend({ view: z.enum(["arrivals", "waitlist", "attention", "all"]) }),
  ).handler(async ({ context, input }) => {
    const now = new Date();
    const rows = await reservationRows(db, context.scope.orgId, viewFilter(input.view, now));

    return { items: rows.map((row) => reservationView(row, now)) };
  }),

  confirmBedReservation: orgProcedure(
    { ipd: ["update"] },
    orgInput.extend({ ...revisionInput, bedId: z.string(), holdUntil: z.date() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;
    const now = new Date();

    const reservation = await db.transaction(async (tx) => {
      await lockReservationPatient(tx, orgId, input.reservationId);
      const bed = (await lockBeds(tx, orgId, [input.bedId])).get(input.bedId);
      const row = await lockReservation(tx, orgId, input.reservationId, input.expectedRevision);

      // A live hold is changed by rescheduling; a lapsed or disrupted one is confirmed again.
      if (
        row.status === "converted" ||
        row.status === "cancelled" ||
        (row.status === "confirmed" && !isLapsed(row, now))
      ) {
        throw new ORPCError("CONFLICT", { message: "This reservation cannot be confirmed now." });
      }

      requireHoldTime(row, input.holdUntil, now);
      await assertHoldable(tx, orgId, bed, row, now);

      await tx
        .update(bedReservations)
        .set({
          status: "confirmed",
          bedId: input.bedId,
          holdUntil: input.holdUntil,
          disruptedReason: null,
          revision: sql`${bedReservations.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(bedReservations.orgId, orgId), eq(bedReservations.id, row.id)));

      return readReservation(tx, orgId, row.id);
    });

    auditReservation(scope, "ipd.reservation.confirm", reservation.id, {
      bedId: input.bedId,
      holdUntil: input.holdUntil.toISOString(),
    });

    return reservation;
  }),

  // A hold stays a hold only if every confirmation check passes for the new window and bed.
  rescheduleBedReservation: orgProcedure(
    { ipd: ["update"] },
    orgInput.extend({ ...revisionInput, ...windowInput, bedId: z.string().optional() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;
    const now = new Date();
    requireWindow(input, undefined, now);

    const reservation = await db.transaction(async (tx) => {
      const current = await lockReservationPatient(tx, orgId, input.reservationId);
      const bedId = input.bedId ?? current.bedId;
      const bed = bedId ? (await lockBeds(tx, orgId, [bedId])).get(bedId) : undefined;
      const row = await lockReservation(tx, orgId, input.reservationId, input.expectedRevision);

      if (row.status !== "requested" && row.status !== "confirmed") {
        throw new ORPCError("CONFLICT", {
          message: "Only a request or a hold can be rescheduled.",
        });
      }

      // A lapsed hold time must be replaced, never carried into the new window.
      const holdUntil = input.holdUntil ?? row.holdUntil;

      if (holdUntil) requireHoldTime(input, holdUntil, now);

      const next = { ...input, id: row.id, categoryId: row.categoryId };

      if (row.status === "confirmed") {
        await assertHoldable(tx, orgId, bed, next, now);
      } else if (bedId) {
        if (!bed) throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
        requireCategory(bed, row.categoryId);
      }

      await tx
        .update(bedReservations)
        .set({
          plannedArrivalAt: input.plannedArrivalAt,
          plannedDepartureAt: input.plannedDepartureAt,
          holdUntil,
          bedId,
          revision: sql`${bedReservations.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(bedReservations.orgId, orgId), eq(bedReservations.id, row.id)));

      return readReservation(tx, orgId, row.id);
    });

    auditReservation(scope, "ipd.reservation.reschedule", reservation.id, {
      bedId: reservation.bedId,
      plannedArrivalAt: input.plannedArrivalAt.toISOString(),
      plannedDepartureAt: input.plannedDepartureAt.toISOString(),
      holdUntil: reservation.holdUntil?.toISOString() ?? null,
    });

    return reservation;
  }),

  // Frees only the bed: no money moves (no pre-admission payments exist).
  cancelBedReservation: orgProcedure(
    { ipd: ["update"] },
    orgInput.extend({ ...revisionInput, reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [row] = await db
      .update(bedReservations)
      .set({
        status: "cancelled",
        cancelReason: input.reason,
        revision: sql`${bedReservations.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bedReservations.orgId, scope.orgId),
          eq(bedReservations.id, input.reservationId),
          eq(bedReservations.revision, input.expectedRevision),
          inArray(bedReservations.status, ["requested", "confirmed", "disrupted"]),
        ),
      )
      .returning({ id: bedReservations.id });

    // Missing, stale, converted and cancelled collapse into one CONFLICT (D026).
    if (!row) throw staleReservation();

    auditReservation(scope, "ipd.reservation.cancel", row.id, { reason: input.reason });

    return readReservation(db, scope.orgId, row.id);
  }),
};
