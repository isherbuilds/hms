import type { DbTransaction } from "@hms/db/counter";
import { practitioners } from "@hms/db/schema/practitioners";
import {
  equipmentUnits,
  resourceBlocks,
  surgicalCaseEquipment,
  surgicalCases,
  theatreRooms,
} from "@hms/db/schema/theatre";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { impossible } from "./conflict";
import { buffered, bufferedEndAt, bufferedStartAt } from "./theatre-cases";

// Lock order (D040): theatre rooms by id → equipment units by id → Practitioner →
// surgical case rows by id. Every writer that could hold a room or a unit locks it
// first, so the clash checks below need no further lock.

async function lockRoom(tx: DbTransaction, orgId: string, roomId: string) {
  const [room] = await tx
    .select({ id: theatreRooms.id, name: theatreRooms.name, active: theatreRooms.active })
    .from(theatreRooms)
    .where(and(eq(theatreRooms.orgId, orgId), eq(theatreRooms.id, roomId)))
    .for("update");

  return room;
}

async function lockUnits(tx: DbTransaction, orgId: string, equipmentIds: string[]) {
  if (equipmentIds.length === 0) return [];

  return tx
    .select({ id: equipmentUnits.id, name: equipmentUnits.name, active: equipmentUnits.active })
    .from(equipmentUnits)
    .where(and(eq(equipmentUnits.orgId, orgId), inArray(equipmentUnits.id, equipmentIds)))
    .orderBy(asc(equipmentUnits.id))
    .for("update");
}

async function lockPractitioner(tx: DbTransaction, orgId: string, practitionerId: string) {
  await tx
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, practitionerId)))
    .for("update");
}

export function staleCase() {
  return new ORPCError("CONFLICT", {
    message: "This case changed on another screen. Refresh and try again.",
  });
}

export async function lockCase(
  tx: DbTransaction,
  orgId: string,
  caseId: string,
  expectedRevision: number,
) {
  const [row] = await tx
    .select({
      id: surgicalCases.id,
      patientId: surgicalCases.patientId,
      status: surgicalCases.status,
      revision: surgicalCases.revision,
    })
    .from(surgicalCases)
    .where(and(eq(surgicalCases.orgId, orgId), eq(surgicalCases.id, caseId)))
    .for("update");

  if (!row || row.revision !== expectedRevision) throw staleCase();

  return row;
}

export type HoldPlan = {
  caseId: string;
  roomId: string | null;
  equipmentIds: string[];
  practitionerId: string;
  plannedStartAt: Date;
  plannedEndAt: Date;
  prepMinutes: number;
  cleanupMinutes: number;
};

// Locks everything a confirmed case would hold, in order, before its own row.
export async function lockPlan(tx: DbTransaction, orgId: string, plan: HoldPlan) {
  const room = plan.roomId ? await lockRoom(tx, orgId, plan.roomId) : undefined;
  const units = await lockUnits(tx, orgId, plan.equipmentIds);
  await lockPractitioner(tx, orgId, plan.practitionerId);

  return { room, units };
}

function clash(message: string) {
  return new ORPCError("CONFLICT", { message });
}

// A confirmed case whose held interval overlaps `[start, end)`, half-open; an
// open end means "from `start` on".
function heldDuring(orgId: string, exceptId: string | undefined, start: Date, end?: Date) {
  return and(
    eq(surgicalCases.orgId, orgId),
    eq(surgicalCases.status, "confirmed"),
    exceptId ? ne(surgicalCases.id, exceptId) : undefined,
    end ? sql`${bufferedStartAt} < ${end}` : undefined,
    sql`${bufferedEndAt} > ${start}`,
  );
}

// Live maintenance blocks overlapping `[start, end)`; an open end means "from `start` on".
export function blocksDuring(orgId: string, start: Date, end?: Date) {
  return and(
    eq(resourceBlocks.orgId, orgId),
    isNull(resourceBlocks.removedAt),
    end ? lt(resourceBlocks.startsAt, end) : undefined,
    gt(resourceBlocks.endsAt, start),
  );
}

export type ResourceTarget = { roomId: string } | { equipmentId: string };

// Confirmed cases holding one room or unit during `[start, end)`. Callers hold the
// resource's lock, which every writer of a hold on it takes first.
export function casesHolding(
  tx: DbTransaction,
  orgId: string,
  target: ResourceTarget,
  start: Date,
  end?: Date,
) {
  const held = heldDuring(orgId, undefined, start, end);

  if ("roomId" in target) {
    return tx
      .select({ id: surgicalCases.id })
      .from(surgicalCases)
      .where(and(held, eq(surgicalCases.roomId, target.roomId)))
      .orderBy(asc(surgicalCases.id));
  }

  return tx
    .select({ id: surgicalCases.id })
    .from(surgicalCases)
    .innerJoin(
      surgicalCaseEquipment,
      and(
        eq(surgicalCaseEquipment.orgId, surgicalCases.orgId),
        eq(surgicalCaseEquipment.caseId, surgicalCases.id),
      ),
    )
    .where(and(held, eq(surgicalCaseEquipment.equipmentId, target.equipmentId)))
    .orderBy(asc(surgicalCases.id));
}

// Every confirmation check, under the locks `lockPlan` took. The first clash wins and
// names the resource in plain words; nothing has been written yet.
export async function assertHoldable(
  tx: DbTransaction,
  orgId: string,
  plan: HoldPlan,
  locked: Awaited<ReturnType<typeof lockPlan>>,
  now: Date,
) {
  if (!plan.roomId) throw clash("Choose a theatre room before confirming.");

  if (plan.plannedStartAt.getTime() < now.getTime()) {
    throw clash("That start time has already passed.");
  }

  const { room, units } = locked;

  if (!room || units.length !== plan.equipmentIds.length) {
    throw impossible("a case references a room or unit outside its organization");
  }

  if (!room.active) throw clash(`${room.name} is not in use.`);

  const retired = units.find((unit) => !unit.active);

  if (retired) throw clash(`${retired.name} is not in use.`);

  const { bufferedStartAt: start, bufferedEndAt: end } = buffered(plan);

  const [blocked] = await tx
    .select({ equipmentId: resourceBlocks.equipmentId })
    .from(resourceBlocks)
    .where(
      and(
        blocksDuring(orgId, start, end),
        plan.equipmentIds.length > 0
          ? or(
              eq(resourceBlocks.roomId, room.id),
              inArray(resourceBlocks.equipmentId, plan.equipmentIds),
            )
          : eq(resourceBlocks.roomId, room.id),
      ),
    )
    .orderBy(sql`${resourceBlocks.equipmentId} nulls first`)
    .limit(1);

  if (blocked) {
    const name = units.find((unit) => unit.id === blocked.equipmentId)?.name ?? room.name;
    throw clash(`${name} is blocked for maintenance at that time.`);
  }

  const [roomClash] = await tx
    .select({ id: surgicalCases.id })
    .from(surgicalCases)
    .where(and(heldDuring(orgId, plan.caseId, start, end), eq(surgicalCases.roomId, room.id)))
    .limit(1);

  if (roomClash) throw clash(`${room.name} is booked at that time.`);

  if (plan.equipmentIds.length > 0) {
    const [unitClash] = await tx
      .select({ name: equipmentUnits.name })
      .from(surgicalCaseEquipment)
      .innerJoin(
        surgicalCases,
        and(
          eq(surgicalCases.orgId, surgicalCaseEquipment.orgId),
          eq(surgicalCases.id, surgicalCaseEquipment.caseId),
        ),
      )
      .innerJoin(
        equipmentUnits,
        and(
          eq(equipmentUnits.orgId, surgicalCaseEquipment.orgId),
          eq(equipmentUnits.id, surgicalCaseEquipment.equipmentId),
        ),
      )
      .where(
        and(
          eq(surgicalCaseEquipment.orgId, orgId),
          inArray(surgicalCaseEquipment.equipmentId, plan.equipmentIds),
          heldDuring(orgId, plan.caseId, start, end),
        ),
      )
      .orderBy(asc(equipmentUnits.id))
      .limit(1);

    if (unitClash) throw clash(`${unitClash.name} is booked at that time.`);
  }

  // The consultant is needed for the planned interval only, not the room turnover.
  const [consultantClash] = await tx
    .select({ id: surgicalCases.id })
    .from(surgicalCases)
    .where(
      and(
        eq(surgicalCases.orgId, orgId),
        eq(surgicalCases.status, "confirmed"),
        ne(surgicalCases.id, plan.caseId),
        eq(surgicalCases.practitionerId, plan.practitionerId),
        lt(surgicalCases.plannedStartAt, plan.plannedEndAt),
        gt(surgicalCases.plannedEndAt, plan.plannedStartAt),
      ),
    )
    .limit(1);

  if (consultantClash) throw clash("The consultant has another case at that time.");
}

// One room or unit, locked in its place in the order; NOT_FOUND outside scope.
export async function lockResource(tx: DbTransaction, orgId: string, target: ResourceTarget) {
  if ("roomId" in target) {
    const room = await lockRoom(tx, orgId, target.roomId);

    if (!room) throw new ORPCError("NOT_FOUND", { message: "That theatre room does not exist." });

    return room;
  }

  const [unit] = await lockUnits(tx, orgId, [target.equipmentId]);

  if (!unit) throw new ORPCError("NOT_FOUND", { message: "That equipment unit does not exist." });

  return unit;
}

// A resource promised to a case that has not finished cannot be retired.
export async function assertNoFutureHold(
  tx: DbTransaction,
  orgId: string,
  target: ResourceTarget,
  resource: { name: string },
  now: Date,
) {
  const [held] = await casesHolding(tx, orgId, target, now).limit(1);

  if (held) {
    throw clash(`${resource.name} has a confirmed case coming up. Move or cancel it first.`);
  }
}
