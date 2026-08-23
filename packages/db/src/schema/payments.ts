import { sql } from "drizzle-orm";
import {
  check,
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

/** Payments received against immutable issued invoices, with receipt numbering fixed at record time. */
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
    /** Attribution only; authorization always comes from the request's organization scope. */
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
    // Dashboard collection totals read one organization's payments over a
    // Business-Date range, independently of any invoice.
    index("payments_org_created_idx").on(table.orgId, table.createdAt),
    // Every read is scoped to one invoice and sorted by time, so the sort
    // rides along in the same index.
    index("payments_org_invoice_idx").on(table.orgId, table.invoiceId, table.createdAt),
  ],
);
