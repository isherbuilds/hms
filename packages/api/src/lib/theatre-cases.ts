import { db } from "@hms/db";
import { catalogItems } from "@hms/db/schema/catalog-items";
import type { DbTransaction } from "@hms/db/counter";
import { bedReservations } from "@hms/db/schema/ipd";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import {
  equipmentUnits,
  MAX_CASE_BUFFER_MINUTES,
  surgicalCaseEquipment,
  surgicalCases,
  theatreRooms,
} from "@hms/db/schema/theatre";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { BACKDATE_TOLERANCE_MS, requireInScope } from "./ipd-beds";
import { note } from "./schemas";

const MAX_CASE_MS = 24 * 60 * 60 * 1_000;

type Executor = typeof db | DbTransaction;

const bufferMinutes = z.number().int().min(0).max(MAX_CASE_BUFFER_MINUTES).default(0);

// Everything a desk may set on a case; an edit sends the whole set again.
export const caseFields = z.object({
  practitionerId: z.string(),
  procedureItemId: z.string(),
  plannedStartAt: z.date(),
  plannedEndAt: z.date(),
  prepMinutes: bufferMinutes,
  cleanupMinutes: bufferMinutes,
  roomId: z.string().optional(),
  equipmentIds: z
    .array(z.string())
    .max(20)
    .default([])
    .transform((ids) => [...new Set(ids)].sort()),
  bedReservationId: z.string().optional(),
  notes: note,
});

export type CaseFields = z.output<typeof caseFields>;

// The held instants of a stored case, half-open: the room and units are busy from
// preparation until cleanup ends.
export const bufferedStartAt = sql<Date>`(${surgicalCases.plannedStartAt} - make_interval(mins => ${surgicalCases.prepMinutes}))`;

export const bufferedEndAt = sql<Date>`(${surgicalCases.plannedEndAt} + make_interval(mins => ${surgicalCases.cleanupMinutes}))`;

export function buffered(
  fields: Pick<CaseFields, "plannedStartAt" | "plannedEndAt" | "prepMinutes" | "cleanupMinutes">,
) {
  return {
    bufferedStartAt: new Date(fields.plannedStartAt.getTime() - fields.prepMinutes * 60_000),
    bufferedEndAt: new Date(fields.plannedEndAt.getTime() + fields.cleanupMinutes * 60_000),
  };
}

function badRequest(message: string) {
  return new ORPCError("BAD_REQUEST", { message });
}

export function requireInterval(fields: CaseFields, now: Date) {
  const start = fields.plannedStartAt.getTime();
  const end = fields.plannedEndAt.getTime();

  if (end <= start) throw badRequest("The case must end after it starts.");

  if (end - start > MAX_CASE_MS) throw badRequest("A case can be planned for at most 24 hours.");

  if (now.getTime() - start > BACKDATE_TOLERANCE_MS) {
    throw badRequest("That start time has already passed.");
  }
}

async function requireUnits(orgId: string, ids: string[]) {
  if (ids.length === 0) return;

  const units = await db
    .select({ active: equipmentUnits.active })
    .from(equipmentUnits)
    .where(and(eq(equipmentUnits.orgId, orgId), inArray(equipmentUnits.id, ids)));

  if (units.length !== ids.length) {
    throw new ORPCError("NOT_FOUND", { message: "That equipment unit does not exist." });
  }

  if (units.some((unit) => !unit.active)) throw badRequest("That equipment unit is not in use.");
}

// Every reference must exist under scope (NOT_FOUND) and be usable (BAD_REQUEST).
// Returns the procedure name the case snapshots.
export async function resolveCaseReferences(
  orgId: string,
  patientId: string,
  fields: CaseFields,
  options: { checkPatient: boolean },
) {
  const [, , procedure, room, , reservation] = await Promise.all([
    options.checkPatient
      ? requireInScope(
          db
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
            .limit(1),
          "That Patient does not exist.",
        )
      : null,
    requireInScope(
      db
        .select({ id: practitioners.id })
        .from(practitioners)
        .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, fields.practitionerId)))
        .limit(1),
      "That consultant does not exist.",
    ),
    requireInScope(
      db
        .select({
          name: catalogItems.name,
          category: catalogItems.category,
          active: catalogItems.active,
        })
        .from(catalogItems)
        .where(and(eq(catalogItems.orgId, orgId), eq(catalogItems.id, fields.procedureItemId)))
        .limit(1),
      "That procedure does not exist.",
    ),
    fields.roomId
      ? requireInScope(
          db
            .select({ active: theatreRooms.active })
            .from(theatreRooms)
            .where(and(eq(theatreRooms.orgId, orgId), eq(theatreRooms.id, fields.roomId)))
            .limit(1),
          "That theatre room does not exist.",
        )
      : null,
    requireUnits(orgId, fields.equipmentIds),
    fields.bedReservationId
      ? requireInScope(
          db
            .select({ patientId: bedReservations.patientId })
            .from(bedReservations)
            .where(
              and(
                eq(bedReservations.orgId, orgId),
                eq(bedReservations.id, fields.bedReservationId),
              ),
            )
            .limit(1),
          "That bed reservation does not exist.",
        )
      : null,
  ]);

  if (procedure.category !== "procedure" || !procedure.active) {
    throw badRequest("Choose an active procedure from the catalog.");
  }

  if (room && !room.active) throw badRequest("That theatre room is not in use.");

  if (reservation && reservation.patientId !== patientId) {
    throw badRequest("That bed reservation is for another Patient.");
  }

  return procedure.name;
}

export function caseValues(fields: CaseFields, procedureName: string) {
  return {
    practitionerId: fields.practitionerId,
    procedureItemId: fields.procedureItemId,
    procedureName,
    roomId: fields.roomId ?? null,
    plannedStartAt: fields.plannedStartAt,
    plannedEndAt: fields.plannedEndAt,
    prepMinutes: fields.prepMinutes,
    cleanupMinutes: fields.cleanupMinutes,
    bedReservationId: fields.bedReservationId ?? null,
    notes: fields.notes || null,
  };
}

export async function replaceCaseEquipment(
  tx: DbTransaction,
  orgId: string,
  caseId: string,
  equipmentIds: string[],
) {
  await tx
    .delete(surgicalCaseEquipment)
    .where(and(eq(surgicalCaseEquipment.orgId, orgId), eq(surgicalCaseEquipment.caseId, caseId)));

  if (equipmentIds.length === 0) return;

  await tx
    .insert(surgicalCaseEquipment)
    .values(equipmentIds.map((equipmentId) => ({ orgId, caseId, equipmentId })));
}

export async function readCases(executor: Executor, orgId: string, where: SQL | undefined) {
  const rows = await executor
    .select({
      id: surgicalCases.id,
      status: surgicalCases.status,
      revision: surgicalCases.revision,
      patientId: surgicalCases.patientId,
      patientName: patients.name,
      mrn: patients.mrn,
      practitionerId: surgicalCases.practitionerId,
      consultantName: practitioners.name,
      procedureItemId: surgicalCases.procedureItemId,
      procedureName: surgicalCases.procedureName,
      roomId: surgicalCases.roomId,
      roomName: theatreRooms.name,
      plannedStartAt: surgicalCases.plannedStartAt,
      plannedEndAt: surgicalCases.plannedEndAt,
      prepMinutes: surgicalCases.prepMinutes,
      cleanupMinutes: surgicalCases.cleanupMinutes,
      admissionId: surgicalCases.admissionId,
      bedReservationId: surgicalCases.bedReservationId,
      cancelReason: surgicalCases.cancelReason,
      disruptedReason: surgicalCases.disruptedReason,
      notes: surgicalCases.notes,
    })
    .from(surgicalCases)
    .innerJoin(
      patients,
      and(eq(patients.orgId, surgicalCases.orgId), eq(patients.id, surgicalCases.patientId)),
    )
    .innerJoin(
      practitioners,
      and(
        eq(practitioners.orgId, surgicalCases.orgId),
        eq(practitioners.id, surgicalCases.practitionerId),
      ),
    )
    .leftJoin(
      theatreRooms,
      and(eq(theatreRooms.orgId, surgicalCases.orgId), eq(theatreRooms.id, surgicalCases.roomId)),
    )
    .where(and(eq(surgicalCases.orgId, orgId), where))
    .orderBy(asc(surgicalCases.plannedStartAt), asc(surgicalCases.id));

  const units =
    rows.length === 0
      ? []
      : await executor
          .select({
            caseId: surgicalCaseEquipment.caseId,
            id: equipmentUnits.id,
            name: equipmentUnits.name,
          })
          .from(surgicalCaseEquipment)
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
              inArray(
                surgicalCaseEquipment.caseId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(equipmentUnits.name), asc(equipmentUnits.id));

  const unitsByCase = Map.groupBy(units, (unit) => unit.caseId);

  return rows.map((row) => ({
    ...row,
    ...buffered(row),
    equipment: (unitsByCase.get(row.id) ?? []).map(({ id, name }) => ({ id, name })),
  }));
}

export async function readCase(executor: Executor, orgId: string, caseId: string) {
  const [row] = await readCases(executor, orgId, eq(surgicalCases.id, caseId));

  if (!row) throw new ORPCError("NOT_FOUND", { message: "That surgical case does not exist." });

  return row;
}
