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
import { invoices } from "./invoices";

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference"),
    receiptNumber: text("receipt_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date").notNull(),
    receivedBy: text("received_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("payments_method_check", sql`${table.method} in ('cash', 'upi', 'card')`),
    check("payments_amount_check", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    uniqueIndex("payments_org_receipt_number_idx").on(table.orgId, table.receiptNumber),
    // Dashboard and daily-collections totals read one org's payments over a
    // business-date range, with no invoice involved.
    index("payments_org_business_date_idx").on(table.orgId, table.businessDate),
    // Every other read is scoped to one invoice and sorted by time.
    index("payments_org_invoice_idx").on(table.orgId, table.invoiceId, table.createdAt),
  ],
);
