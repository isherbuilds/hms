import { foreignKey, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import { patients } from "./patients";
import { payers } from "./payers";

export const patientPayers = pgTable(
  "patient_payers",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    patientId: text("patient_id").notNull(),
    payerId: text("payer_id").notNull(),
    policyNumber: text("policy_number"),
    employeeNumber: text("employee_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.payerId],
      foreignColumns: [payers.orgId, payers.id],
    }),
    uniqueIndex("patient_payers_org_patient_idx").on(table.orgId, table.patientId),
  ],
);
