import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
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
    uniqueIndex("payments_org_receipt_number_idx").on(table.orgId, table.receiptNumber),
    index("payments_org_invoice_idx").on(table.orgId, table.invoiceId),
    index("payments_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
