import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { patients } from "./patients";
import { practitioners } from "./practitioners";

const TREATMENT_PLAN_STATUSES = ["open", "completed", "closed"] as const;

export const treatmentPlans = pgTable(
  "treatment_plans",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    status: text("status", { enum: TREATMENT_PLAN_STATUSES }).notNull().default("open"),
    nextSittingOn: date("next_sitting_on", { mode: "string" }),
    nextSittingNote: text("next_sitting_note"),
    closeReason: text("close_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("treatment_plans_status_check", sql`${table.status} in ('open', 'completed', 'closed')`),
    check(
      "treatment_plans_close_reason_check",
      sql`${table.status} <> 'closed' or ${table.closeReason} is not null`,
    ),
    unique("treatment_plans_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.practitionerId],
      foreignColumns: [practitioners.orgId, practitioners.id],
    }),
    index("treatment_plans_org_patient_status_idx").on(table.orgId, table.patientId, table.status),
    index("treatment_plans_org_status_next_idx").on(table.orgId, table.status, table.nextSittingOn),
  ],
);
