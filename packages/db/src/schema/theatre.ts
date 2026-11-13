import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { catalogItems } from "./catalog-items";
import { admissions, bedReservations } from "./ipd";
import { patients } from "./patients";
import { practitioners } from "./practitioners";

export const THEATRE_ROOM_KINDS = ["operating_theatre", "procedure_room"] as const;

export const SURGICAL_CASE_STATUSES = ["draft", "confirmed", "disrupted", "cancelled"] as const;

// Preparation and cleanup buffers, in minutes, each side of the planned interval.
export const MAX_CASE_BUFFER_MINUTES = 240;

// Rooms and units are never deleted, so cases keep pointing at them; they retire.
export const theatreRooms = pgTable(
  "theatre_rooms",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    kind: text("kind", { enum: THEATRE_ROOM_KINDS }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("theatre_rooms_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("theatre_rooms_org_name_uq").on(table.orgId, sql`lower(${table.name})`),
  ],
);

// One row per individually identified reusable unit; never a pooled count.
export const equipmentUnits = pgTable(
  "equipment_units",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("equipment_units_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("equipment_units_org_name_uq").on(table.orgId, sql`lower(${table.name})`),
  ],
);

// A dated maintenance block on exactly one room or unit, half-open `[startsAt, endsAt)`.
// Removal keeps the row for history; a removed block no longer blocks.
export const resourceBlocks = pgTable(
  "resource_blocks",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    roomId: text("room_id"),
    equipmentId: text("equipment_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "resource_blocks_target_check",
      sql`(${table.roomId} is null) <> (${table.equipmentId} is null)`,
    ),
    check("resource_blocks_interval_check", sql`${table.endsAt} > ${table.startsAt}`),
    unique("resource_blocks_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.roomId],
      foreignColumns: [theatreRooms.orgId, theatreRooms.id],
    }),
    foreignKey({
      columns: [table.orgId, table.equipmentId],
      foreignColumns: [equipmentUnits.orgId, equipmentUnits.id],
    }),
    index("resource_blocks_org_room_starts_idx").on(table.orgId, table.roomId, table.startsAt),
    index("resource_blocks_org_equipment_starts_idx").on(
      table.orgId,
      table.equipmentId,
      table.startsAt,
    ),
    index("resource_blocks_org_ends_idx").on(table.orgId, table.endsAt),
  ],
);

// A planned surgical case. A draft promises nothing; a confirmed case holds its room
// and units for the buffered interval and its consultant for the planned interval.
export const surgicalCases = pgTable(
  "surgical_cases",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    patientId: text("patient_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    procedureItemId: text("procedure_item_id").notNull(),
    procedureName: text("procedure_name").notNull(),
    roomId: text("room_id"),
    plannedStartAt: timestamp("planned_start_at", { withTimezone: true }).notNull(),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }).notNull(),
    prepMinutes: integer("prep_minutes").notNull().default(0),
    cleanupMinutes: integer("cleanup_minutes").notNull().default(0),
    status: text("status", { enum: SURGICAL_CASE_STATUSES }).notNull(),
    revision: integer("revision").notNull().default(0),
    admissionId: text("admission_id"),
    bedReservationId: text("bed_reservation_id"),
    cancelReason: text("cancel_reason"),
    disruptedReason: text("disrupted_reason"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("surgical_cases_interval_check", sql`${table.plannedEndAt} > ${table.plannedStartAt}`),
    // The schedule's lower bound on a stored start relies on this limit.
    check(
      "surgical_cases_duration_check",
      sql`${table.plannedEndAt} - ${table.plannedStartAt} <= interval '24 hours'`,
    ),
    check(
      "surgical_cases_buffers_check",
      sql`${table.prepMinutes} between 0 and ${sql.raw(String(MAX_CASE_BUFFER_MINUTES))} and ${table.cleanupMinutes} between 0 and ${sql.raw(String(MAX_CASE_BUFFER_MINUTES))}`,
    ),
    check(
      "surgical_cases_confirmed_room_check",
      sql`${table.status} <> 'confirmed' or ${table.roomId} is not null`,
    ),
    check(
      "surgical_cases_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
    check(
      "surgical_cases_disrupted_check",
      sql`${table.status} <> 'disrupted' or ${table.disruptedReason} is not null`,
    ),
    unique("surgical_cases_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.practitionerId],
      foreignColumns: [practitioners.orgId, practitioners.id],
    }),
    foreignKey({
      columns: [table.orgId, table.procedureItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    foreignKey({
      columns: [table.orgId, table.roomId],
      foreignColumns: [theatreRooms.orgId, theatreRooms.id],
    }),
    // Includes the Patient, so a case can only attach its own Patient's Admission.
    foreignKey({
      columns: [table.orgId, table.admissionId, table.patientId],
      foreignColumns: [admissions.orgId, admissions.id, admissions.patientId],
    }),
    // Includes the Patient, so a case can only name its own Patient's bed reservation.
    foreignKey({
      columns: [table.orgId, table.bedReservationId, table.patientId],
      foreignColumns: [bedReservations.orgId, bedReservations.id, bedReservations.patientId],
    }),
    index("surgical_cases_org_start_idx").on(table.orgId, table.plannedStartAt, table.id),
    index("surgical_cases_org_room_status_idx").on(table.orgId, table.roomId, table.status),
    index("surgical_cases_org_practitioner_status_idx").on(
      table.orgId,
      table.practitionerId,
      table.status,
    ),
  ],
);

// The concrete units a case needs; held with the case's room while it is confirmed.
export const surgicalCaseEquipment = pgTable(
  "surgical_case_equipment",
  {
    orgId: orgIdColumn(),
    caseId: text("case_id").notNull(),
    equipmentId: text("equipment_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.caseId, table.equipmentId] }),
    foreignKey({
      columns: [table.orgId, table.caseId],
      foreignColumns: [surgicalCases.orgId, surgicalCases.id],
    }),
    foreignKey({
      columns: [table.orgId, table.equipmentId],
      foreignColumns: [equipmentUnits.orgId, equipmentUnits.id],
    }),
    index("surgical_case_equipment_org_equipment_idx").on(table.orgId, table.equipmentId),
  ],
);
