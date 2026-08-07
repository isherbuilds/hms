import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { departments } from "./departments";
import { patients } from "./patients";
import { practitioners } from "./practitioners";

/**
 * Tenant-scoped clinical encounters and their daily practitioner queue tokens.
 * The state machine is waiting → in_consult → completed or waiting → cancelled;
 * transition timestamps record when the matching state was entered.
 */
export const visits = pgTable(
  "visits",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    visitClass: text("visit_class").notNull().default("opd"),
    tokenNumber: integer("token_number").notNull(),
    status: text("status").notNull().default("waiting"),
    cancelReason: text("cancel_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Attribution only; authorization always comes from the request's organization scope. */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("visits_class_check", sql`${table.visitClass} in ('opd', 'ipd', 'er')`),
    check(
      "visits_status_check",
      sql`${table.status} in ('waiting', 'in_consult', 'completed', 'cancelled')`,
    ),
    index("visits_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
    index("visits_org_practitioner_idx").on(table.orgId, table.practitionerId, table.status),
    index("visits_org_patient_idx").on(table.orgId, table.patientId, table.createdAt.desc()),
  ],
);
