import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { patients } from "./patients";
import { type PaymentMethod } from "./payment-methods";
import { treatmentPlans } from "./treatment-plans";

export const advanceReceipts = pgTable(
  "advance_receipts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id").notNull(),
    treatmentPlanId: text("treatment_plan_id"),
    method: text("method").$type<PaymentMethod>().notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    reference: text("reference"),
    note: text("note"),
    purpose: text("purpose").notNull(),
    receiptNumber: text("receipt_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    orgLegalName: text("org_legal_name").notNull(),
    orgAddress: text("org_address").notNull(),
    orgTaxId: text("org_tax_id").notNull(),
    currency: text("currency").notNull(),
    patientName: text("patient_name").notNull(),
    patientMrn: text("patient_mrn").notNull(),
    patientPhone: text("patient_phone").notNull(),
    patientAddress: text("patient_address"),
    patientGuardian: text("patient_guardian"),
    receivedBy: text("received_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("advance_receipts_amount_check", sql`${table.amount} > 0`),
    unique("advance_receipts_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("advance_receipts_org_number_idx").on(table.orgId, table.receiptNumber),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.treatmentPlanId],
      foreignColumns: [treatmentPlans.orgId, treatmentPlans.id],
    }),
    index("advance_receipts_org_patient_created_idx").on(
      table.orgId,
      table.patientId,
      table.createdAt,
    ),
    index("advance_receipts_org_created_id_idx").on(table.orgId, table.createdAt, table.id),
    index("advance_receipts_org_business_date_idx").on(table.orgId, table.businessDate),
    // Follow-ups sums the credit held against each plan; most receipts carry no plan.
    index("advance_receipts_org_plan_idx")
      .on(table.orgId, table.treatmentPlanId)
      .where(sql`${table.treatmentPlanId} is not null`),
  ],
);
