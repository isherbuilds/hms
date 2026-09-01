import { sql, type SQL } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { departments } from "./departments";
import { patients } from "./patients";
import { practitioners } from "./practitioners";

export const OPD_ARRIVAL_MODES = ["scheduled", "walk_in"] as const;
export const OPD_APPOINTMENT_STATUSES = ["booked", "checked_in", "cancelled", "no_show"] as const;

// The row owns operational state only; money and files stay typed child records.
export const opdAppointments = pgTable(
  "opd_appointments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id"),
    callerName: text("caller_name"),
    callerPhone: text("caller_phone"),
    practitionerId: text("practitioner_id").notNull(),
    departmentId: text("department_id").notNull(),
    arrivalMode: text("arrival_mode", { enum: OPD_ARRIVAL_MODES }).notNull(),
    status: text("status", { enum: OPD_APPOINTMENT_STATUSES }).notNull(),
    businessDate: date("business_date").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    tokenNumber: integer("token_number"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    dayOrderAt: timestamp("day_order_at", { withTimezone: true }).generatedAlwaysAs(
      (): SQL => sql`coalesce(${opdAppointments.arrivedAt}, ${opdAppointments.scheduledFor})`,
    ),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // Optimistic version of this attendance's pending/invoiced charge set.
    chargeRevision: integer("charge_revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "opd_appointments_arrival_mode_check",
      sql`${table.arrivalMode} in (${sql.raw(
        OPD_ARRIVAL_MODES.map((mode) => `'${mode}'`).join(", "),
      )})`,
    ),
    check(
      "opd_appointments_status_check",
      sql`${table.status} in (${sql.raw(
        OPD_APPOINTMENT_STATUSES.map((status) => `'${status}'`).join(", "),
      )})`,
    ),
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
      sql`${table.status} <> 'checked_in' or (${table.patientId} is not null and ${table.tokenNumber} is not null and ${table.arrivedAt} is not null)`,
    ),
    check(
      "opd_appointments_booked_check",
      sql`${table.status} <> 'booked' or (${table.arrivalMode} = 'scheduled' and ${table.tokenNumber} is null and ${table.arrivedAt} is null)`,
    ),
    unique("opd_appointments_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.practitionerId],
      foreignColumns: [practitioners.orgId, practitioners.id],
    }),
    foreignKey({
      columns: [table.orgId, table.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
    uniqueIndex("opd_appointments_org_practitioner_date_token_uq")
      .on(table.orgId, table.practitionerId, table.businessDate, table.tokenNumber)
      .where(sql`${table.tokenNumber} is not null`),
    index("opd_appointments_org_date_day_order_idx").on(
      table.orgId,
      table.businessDate,
      table.dayOrderAt,
      table.id,
    ),
    // Carries the exact (business_date, id) keyset order the patient record pages on.
    index("opd_appointments_org_patient_date_idx").on(
      table.orgId,
      table.patientId,
      table.businessDate.desc(),
      table.id.desc(),
    ),
    index("opd_appointments_org_patient_arrived_idx")
      .on(table.orgId, table.patientId, table.practitionerId, table.arrivedAt)
      .where(sql`${table.status} = 'checked_in'`),
  ],
);
