import { db } from "@hms/db";
import { ACTIVE_ADMISSION_STATUSES, admissions } from "@hms/db/schema/ipd";
import {
  equipmentUnits,
  MAX_CASE_BUFFER_MINUTES,
  resourceBlocks,
  surgicalCases,
  THEATRE_ROOM_KINDS,
  theatreRooms,
} from "@hms/db/schema/theatre";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
import { nameConflict } from "../lib/db-errors";
import { orgInput, orgProcedure, requirePermission, type Scope } from "../lib/procedures/factory";
import { reason, shortName } from "../lib/schemas";
import {
  bufferedEndAt,
  bufferedStartAt,
  caseFields,
  caseValues,
  MAX_CASE_MS,
  readCase,
  readCases,
  replaceCaseEquipment,
  requireInterval,
  resolveCaseReferences,
} from "../lib/theatre-cases";
import {
  assertHoldable,
  assertNoFutureHold,
  blocksDuring,
  casesHolding,
  lockCase,
  lockPlan,
  lockResource,
  staleCase,
  type ResourceTarget,
} from "../lib/theatre-holds";

const MAX_SCHEDULE_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;

const MAX_BUFFER_MS = MAX_CASE_BUFFER_MINUTES * 60 * 1_000;

const revisionInput = { caseId: z.string(), expectedRevision: z.number().int().nonnegative() };

function auditTheatre(
  scope: Scope,
  action: string,
  target: string,
  meta?: Record<string, unknown>,
) {
  audit({ action, actorId: scope.userId, orgId: scope.orgId, target, meta });
}

const resourceColumns = {
  rooms: {
    id: theatreRooms.id,
    name: theatreRooms.name,
    kind: theatreRooms.kind,
    active: theatreRooms.active,
  },
  equipment: {
    id: equipmentUnits.id,
    name: equipmentUnits.name,
    kind: equipmentUnits.kind,
    active: equipmentUnits.active,
  },
};

function liveBlocks(orgId: string, start: Date, end?: Date) {
  return db
    .select()
    .from(resourceBlocks)
    .where(blocksDuring(orgId, start, end))
    .orderBy(asc(resourceBlocks.startsAt), asc(resourceBlocks.id));
}

export const theatreRouter = {
  resources: orgProcedure({ theatre: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const [rooms, equipment, blocks] = await Promise.all([
      db
        .select(resourceColumns.rooms)
        .from(theatreRooms)
        .where(eq(theatreRooms.orgId, orgId))
        .orderBy(asc(theatreRooms.name), asc(theatreRooms.id)),
      db
        .select(resourceColumns.equipment)
        .from(equipmentUnits)
        .where(eq(equipmentUnits.orgId, orgId))
        .orderBy(asc(equipmentUnits.name), asc(equipmentUnits.id)),
      liveBlocks(orgId, new Date()),
    ]);

    return { rooms, equipment, blocks };
  }),

  createRoom: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput.extend({ name: shortName, kind: z.enum(THEATRE_ROOM_KINDS) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const room = await db
      .insert(theatreRooms)
      .values({ id: Bun.randomUUIDv7(), orgId: scope.orgId, name: input.name, kind: input.kind })
      .returning(resourceColumns.rooms)
      .then(([row]) => row!)
      .catch((error: unknown) => nameConflict(error, "A theatre room with this name"));

    auditTheatre(scope, "theatre.room.create", `theatre_room:${room.id}`, { name: room.name });

    return room;
  }),

  setRoomActive: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput.extend({ roomId: z.string(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const target = { roomId: input.roomId };

    const room = await db.transaction(async (tx) => {
      const locked = await lockResource(tx, scope.orgId, target);

      if (!input.active) await assertNoFutureHold(tx, scope.orgId, target, locked, new Date());

      const [updated] = await tx
        .update(theatreRooms)
        .set({ active: input.active, updatedAt: new Date() })
        .where(and(eq(theatreRooms.orgId, scope.orgId), eq(theatreRooms.id, input.roomId)))
        .returning(resourceColumns.rooms);

      return updated!;
    });

    if (!input.active) auditTheatre(scope, "theatre.room.deactivate", `theatre_room:${room.id}`);

    return room;
  }),

  createEquipment: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput.extend({ name: shortName, kind: shortName }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const unit = await db
      .insert(equipmentUnits)
      .values({ id: Bun.randomUUIDv7(), orgId: scope.orgId, name: input.name, kind: input.kind })
      .returning(resourceColumns.equipment)
      .then(([row]) => row!)
      .catch((error: unknown) => nameConflict(error, "An equipment unit with this name"));

    auditTheatre(scope, "theatre.equipment.create", `equipment_unit:${unit.id}`, {
      name: unit.name,
    });

    return unit;
  }),

  setEquipmentActive: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput.extend({ equipmentId: z.string(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const target = { equipmentId: input.equipmentId };

    const unit = await db.transaction(async (tx) => {
      const locked = await lockResource(tx, scope.orgId, target);

      if (!input.active) await assertNoFutureHold(tx, scope.orgId, target, locked, new Date());

      const [updated] = await tx
        .update(equipmentUnits)
        .set({ active: input.active, updatedAt: new Date() })
        .where(and(eq(equipmentUnits.orgId, scope.orgId), eq(equipmentUnits.id, input.equipmentId)))
        .returning(resourceColumns.equipment);

      return updated!;
    });

    if (!input.active) {
      auditTheatre(scope, "theatre.equipment.deactivate", `equipment_unit:${unit.id}`);
    }

    return unit;
  }),

  // A block over a confirmed case that is not over yet is refused unless the caller
  // holds `override` and gives a reason: then those cases become disrupted with it.
  blockResource: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput
      .extend({
        roomId: z.string().optional(),
        equipmentId: z.string().optional(),
        startsAt: z.date(),
        endsAt: z.date(),
        reason,
        disrupt: z.object({ reason }).optional(),
      })
      .refine((input) => (input.roomId === undefined) !== (input.equipmentId === undefined), {
        message: "Block exactly one room or one equipment unit.",
      })
      .refine((input) => input.endsAt.getTime() > input.startsAt.getTime(), {
        message: "The block must end after it starts.",
        path: ["endsAt"],
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;

    if (input.disrupt) requirePermission(scope, { theatre: ["override"] });

    const target: ResourceTarget = input.roomId
      ? { roomId: input.roomId }
      : { equipmentId: input.equipmentId! };

    const { created, disrupted } = await db.transaction(async (tx) => {
      const resource = await lockResource(tx, orgId, target);
      // A case already over is history, whatever the block's dates say.
      const from = new Date(Math.max(input.startsAt.getTime(), Date.now()));

      // Case rows lock after the resource, by id (D040).
      const held = await casesHolding(tx, orgId, target, from, input.endsAt).for("update", {
        of: surgicalCases,
      });

      if (held.length > 0 && !input.disrupt) {
        throw conflict("case_held", `${resource.name} has a confirmed case at that time.`);
      }

      const [created] = await tx
        .insert(resourceBlocks)
        .values({
          id: Bun.randomUUIDv7(),
          orgId,
          roomId: input.roomId ?? null,
          equipmentId: input.equipmentId ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
          createdBy: scope.userId,
        })
        .returning();

      const disrupted =
        held.length === 0
          ? []
          : await tx
              .update(surgicalCases)
              .set({
                status: "disrupted",
                disruptedReason: input.disrupt!.reason,
                revision: sql`${surgicalCases.revision} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(surgicalCases.orgId, orgId),
                  inArray(
                    surgicalCases.id,
                    held.map((row) => row.id),
                  ),
                ),
              )
              .returning({ id: surgicalCases.id });

      return { created: created!, disrupted };
    });

    auditTheatre(scope, "theatre.block.create", `resource_block:${created.id}`, {
      ...target,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      reason: created.reason,
    });

    for (const row of disrupted) {
      auditTheatre(scope, "theatre.case.disrupt", `surgical_case:${row.id}`, {
        blockId: created.id,
        reason: input.disrupt!.reason,
      });
    }

    return created;
  }),

  removeBlock: orgProcedure(
    { theatre: ["manageResources"] },
    orgInput.extend({ blockId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [removed] = await db
      .update(resourceBlocks)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(resourceBlocks.orgId, scope.orgId),
          eq(resourceBlocks.id, input.blockId),
          isNull(resourceBlocks.removedAt),
        ),
      )
      .returning();

    // Missing and already removed collapse into one CONFLICT (D026).
    if (!removed) {
      throw new ORPCError("CONFLICT", { message: "That block was already removed. Refresh." });
    }

    auditTheatre(scope, "theatre.block.remove", `resource_block:${removed.id}`);

    return removed;
  }),

  schedule: orgProcedure(
    { theatre: ["read"] },
    orgInput.extend({ from: z.date(), to: z.date(), includeCancelled: z.boolean().default(false) }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const span = input.to.getTime() - input.from.getTime();

    if (span <= 0 || span > MAX_SCHEDULE_WINDOW_MS) {
      throw new ORPCError("BAD_REQUEST", { message: "Choose a window of up to 31 days." });
    }

    const [cases, blocks] = await Promise.all([
      readCases(
        db,
        orgId,
        and(
          // Bounds on the stored start let the (org, start) index narrow the scan; the
          // buffered overlap below is the exact rule.
          lt(surgicalCases.plannedStartAt, new Date(input.to.getTime() + MAX_BUFFER_MS)),
          gt(
            surgicalCases.plannedStartAt,
            new Date(input.from.getTime() - MAX_CASE_MS - MAX_BUFFER_MS),
          ),
          sql`${bufferedStartAt} < ${input.to}`,
          sql`${bufferedEndAt} > ${input.from}`,
          input.includeCancelled ? undefined : ne(surgicalCases.status, "cancelled"),
        ),
      ),
      liveBlocks(orgId, input.from, input.to),
    ]);

    return { cases, blocks };
  }),

  getCase: orgProcedure({ theatre: ["read"] }, orgInput.extend({ caseId: z.string() })).handler(
    ({ context, input }) => readCase(db, context.scope.orgId, input.caseId),
  ),

  // A draft promises no availability, so it takes no lock and checks no clash.
  draftCase: orgProcedure(
    { theatre: ["schedule"] },
    orgInput.extend({ patientId: z.string(), ...caseFields.shape }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    requireInterval(input, new Date());

    const procedureName = await resolveCaseReferences(scope.orgId, input.patientId, input);

    const id = Bun.randomUUIDv7();

    return db.transaction(async (tx) => {
      await tx.insert(surgicalCases).values({
        ...caseValues(input, procedureName),
        id,
        orgId: scope.orgId,
        patientId: input.patientId,
        status: "draft",
        createdBy: scope.userId,
      });
      await replaceCaseEquipment(tx, scope.orgId, id, input.equipmentIds);

      return readCase(tx, scope.orgId, id);
    });
  }),

  // A draft or disrupted case is a plain edit; a confirmed one is a reschedule that
  // keeps its holds only if every confirmation check passes for the new values. A
  // confirmed case whose time, room, units and consultant stay as they are (a notes
  // or procedure fix) keeps its holds unchecked, so it can be fixed once started.
  updateCase: orgProcedure(
    { theatre: ["schedule"] },
    orgInput.extend({ ...revisionInput, ...caseFields.shape }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;
    const now = new Date();

    // A case never changes Patient; matching revisions prove the read is current.
    const current = await readCase(db, orgId, input.caseId);

    if (current.revision !== input.expectedRevision) throw staleCase();

    requireInterval(input, now, current.plannedStartAt);

    const equipmentIds = current.equipment.map((unit) => unit.id).sort();
    const roomId = input.roomId ?? null;
    const reschedule = current.status === "confirmed";

    if (reschedule && !roomId) {
      throw new ORPCError("CONFLICT", {
        message: "A confirmed case needs a room. Cancel it or choose another room.",
      });
    }

    const procedureName = await resolveCaseReferences(orgId, current.patientId, input, {
      procedureItemId: current.procedureItemId,
      roomId: current.roomId,
      equipmentIds,
    });

    const moves =
      reschedule &&
      (roomId !== current.roomId ||
        input.practitionerId !== current.practitionerId ||
        input.plannedStartAt.getTime() !== current.plannedStartAt.getTime() ||
        input.plannedEndAt.getTime() !== current.plannedEndAt.getTime() ||
        input.prepMinutes !== current.prepMinutes ||
        input.cleanupMinutes !== current.cleanupMinutes ||
        input.equipmentIds.join() !== equipmentIds.join());

    const plan = { ...input, caseId: current.id, roomId };

    const updated = await db.transaction(async (tx) => {
      // The resources the case holds now and those it will hold, before the case row.
      const locked = await lockPlan(tx, orgId, plan, { roomId: current.roomId, equipmentIds });
      const row = await lockCase(tx, orgId, input.caseId, input.expectedRevision);

      if (row.status === "cancelled") {
        throw new ORPCError("CONFLICT", { message: "A cancelled case cannot be changed." });
      }

      if (moves) await assertHoldable(tx, orgId, plan, locked);

      await tx
        .update(surgicalCases)
        .set({
          ...caseValues(input, procedureName),
          revision: sql`${surgicalCases.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(surgicalCases.orgId, orgId), eq(surgicalCases.id, row.id)));
      await replaceCaseEquipment(tx, orgId, row.id, input.equipmentIds);

      return readCase(tx, orgId, row.id);
    });

    if (moves) {
      auditTheatre(scope, "theatre.case.reschedule", `surgical_case:${updated.id}`, {
        roomId: updated.roomId,
        plannedStartAt: updated.plannedStartAt.toISOString(),
        plannedEndAt: updated.plannedEndAt.toISOString(),
      });
    }

    return updated;
  }),

  // All or nothing: every hold is checked under lock before the one write.
  confirmCase: orgProcedure({ theatre: ["schedule"] }, orgInput.extend(revisionInput)).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgId } = scope;

      // The unlocked read names what to lock; matching revisions prove it is current.
      const current = await readCase(db, orgId, input.caseId);

      if (current.revision !== input.expectedRevision) throw staleCase();

      const plan = {
        ...current,
        caseId: current.id,
        equipmentIds: current.equipment.map((unit) => unit.id),
      };

      const confirmed = await db.transaction(async (tx) => {
        const locked = await lockPlan(tx, orgId, plan);
        const row = await lockCase(tx, orgId, input.caseId, input.expectedRevision);

        if (row.status !== "draft" && row.status !== "disrupted") {
          throw new ORPCError("CONFLICT", {
            message: "Only a draft or disrupted case can be confirmed.",
          });
        }

        await assertHoldable(tx, orgId, plan, locked);

        await tx
          .update(surgicalCases)
          .set({
            status: "confirmed",
            disruptedReason: null,
            revision: sql`${surgicalCases.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(surgicalCases.orgId, orgId), eq(surgicalCases.id, row.id)));

        return readCase(tx, orgId, row.id);
      });

      auditTheatre(scope, "theatre.case.confirm", `surgical_case:${confirmed.id}`, {
        roomId: confirmed.roomId,
        plannedStartAt: confirmed.plannedStartAt.toISOString(),
        plannedEndAt: confirmed.plannedEndAt.toISOString(),
      });

      return confirmed;
    },
  ),

  // Only a confirmed case holds anything, so leaving that state frees every hold.
  cancelCase: orgProcedure(
    { theatre: ["schedule"] },
    orgInput.extend({ ...revisionInput, reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [row] = await db
      .update(surgicalCases)
      .set({
        status: "cancelled",
        cancelReason: input.reason,
        revision: sql`${surgicalCases.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(surgicalCases.orgId, scope.orgId),
          eq(surgicalCases.id, input.caseId),
          eq(surgicalCases.revision, input.expectedRevision),
          inArray(surgicalCases.status, ["draft", "confirmed", "disrupted"]),
        ),
      )
      .returning({ id: surgicalCases.id });

    // Missing, stale and already cancelled collapse into one CONFLICT (D026).
    if (!row) throw staleCase();

    auditTheatre(scope, "theatre.case.cancel", `surgical_case:${row.id}`, {
      reason: input.reason,
    });

    return readCase(db, scope.orgId, row.id);
  }),

  // The link actual use will require (slice 2); booking itself never needs it.
  attachCaseAdmission: orgProcedure(
    { theatre: ["schedule"] },
    orgInput.extend({ ...revisionInput, admissionId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    return db.transaction(async (tx) => {
      // The Admission locks before the case (D040).
      const [admission] = await tx
        .select({ patientId: admissions.patientId, status: admissions.status })
        .from(admissions)
        .where(and(eq(admissions.orgId, orgId), eq(admissions.id, input.admissionId)))
        .for("update");

      if (!admission) {
        throw new ORPCError("NOT_FOUND", { message: "That Admission does not exist." });
      }

      const row = await lockCase(tx, orgId, input.caseId, input.expectedRevision);

      if (row.status === "cancelled") {
        throw new ORPCError("CONFLICT", { message: "A cancelled case cannot be changed." });
      }

      if (admission.patientId !== row.patientId) {
        throw new ORPCError("CONFLICT", { message: "That Admission is for another Patient." });
      }

      if (!ACTIVE_ADMISSION_STATUSES.some((status) => status === admission.status)) {
        throw new ORPCError("CONFLICT", { message: "That Admission has ended." });
      }

      await tx
        .update(surgicalCases)
        .set({
          admissionId: input.admissionId,
          revision: sql`${surgicalCases.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(surgicalCases.orgId, orgId), eq(surgicalCases.id, row.id)));

      return readCase(tx, orgId, row.id);
    });
  }),
};
