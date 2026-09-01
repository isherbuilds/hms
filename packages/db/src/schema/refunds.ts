import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { creditNotes } from "./credit-notes";
import { invoices } from "./invoices";

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    creditNoteId: text("credit_note_id").notNull(),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference"),
    refundNumber: text("refund_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date").notNull(),
    refundedBy: text("refunded_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("refunds_method_check", sql`${table.method} in ('cash', 'upi', 'card')`),
    check("refunds_amount_check", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    foreignKey({
      columns: [table.orgId, table.creditNoteId],
      foreignColumns: [creditNotes.orgId, creditNotes.id],
    }),
    uniqueIndex("refunds_org_number_idx").on(table.orgId, table.refundNumber),
    // Every read is scoped to one invoice and sorted by time.
    index("refunds_org_invoice_idx").on(table.orgId, table.invoiceId, table.createdAt),
    index("refunds_org_credit_note_idx").on(table.orgId, table.creditNoteId),
  ],
);
