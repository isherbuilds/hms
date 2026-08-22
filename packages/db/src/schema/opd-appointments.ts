import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { departments } from "./departments";
import { patients } from "./patients";
import { practitioners } from "./practitioners";

export const OPD_ARRIVAL_MODES = ["scheduled", "walk_in"] as const;
export const OPD_KINDS = ["consultation", "procedure"] as const;
export const OPD_APPOINTMENT_STATUSES = [
  "booked",
  "waiting",
  "in_consult",
  "completed",
  "cancelled",
  "no_show",
  "left_unseen",
] as const;

/**
 * One outpatient attendance, whether booked ahead or created as a walk-in.
 * The row owns operational state only; money, files, and future clinical facts
 * remain typed child records.
 */
export const opdAppointments = pgTable(
  "opd_appointments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id").references(() => patients.id),
    callerName: text("caller_name"),
    callerPhone: text("caller_phone"),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    arrivalMode: text("arrival_mode", { enum: OPD_ARRIVAL_MODES }).notNull(),
    kind: text("kind", { enum: OPD_KINDS }).notNull().default("consultation"),
    status: text("status", { enum: OPD_APPOINTMENT_STATUSES }).notNull(),
    businessDate: date("business_date").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    tokenNumber: integer("token_number"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    consultationStartedAt: timestamp("consultation_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    leftUnseenAt: timestamp("left_unseen_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "opd_appointments_token_positive_check",
      sql`${table.tokenNumber} is null or ${table.tokenNumber} > 0`,
    ),
    check(
      "opd_appointments_identity_check",
      sql`${table.patientId} is not null or (${table.callerName} is not null and ${table.callerPhone} is not null)`,
    ),
    check(
      "opd_appointments_scheduled_check",
      sql`${table.arrivalMode} <> 'scheduled' or ${table.scheduledFor} is not null`,
    ),
    check(
      "opd_appointments_arrived_check",
      sql`${table.status} not in ('waiting', 'in_consult', 'completed', 'left_unseen') or (${table.patientId} is not null and ${table.tokenNumber} is not null and ${table.arrivedAt} is not null)`,
    ),
    check(
      "opd_appointments_booked_check",
      sql`${table.status} <> 'booked' or (${table.arrivalMode} = 'scheduled' and ${table.tokenNumber} is null and ${table.arrivedAt} is null)`,
    ),
    uniqueIndex("opd_appointments_org_practitioner_date_token_uq")
      .on(table.orgId, table.practitionerId, table.businessDate, table.tokenNumber)
      .where(sql`${table.tokenNumber} is not null`),
    index("opd_appointments_org_date_active_arrived_idx")
      .on(table.orgId, table.businessDate, table.arrivedAt, table.id)
      .where(
        sql`${table.tokenNumber} is not null and ${table.status} in ('waiting', 'in_consult')`,
      ),
    index("opd_appointments_org_date_arrived_idx")
      .on(table.orgId, table.businessDate, table.arrivedAt, table.id)
      .where(sql`${table.tokenNumber} is not null`),
    index("opd_appointments_org_date_scheduled_idx")
      .on(table.orgId, table.businessDate, table.scheduledFor, table.id)
      .where(sql`${table.arrivalMode} = 'scheduled'`),
    index("opd_appointments_org_patient_completed_idx").on(
      table.orgId,
      table.patientId,
      table.practitionerId,
      table.completedAt,
    ),
  ],
);
