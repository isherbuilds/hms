import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { creditNotes } from "./credit-notes";
import { invoices } from "./invoices";

/** Refunds paid against credit notes, with the invoice relationship snapshotted for balance queries. */
export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    creditNoteId: text("credit_note_id")
      .notNull()
      .references(() => creditNotes.id),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference"),
    refundNumber: text("refund_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    /** Attribution only; authorization always comes from the request's organization scope. */
    refundedBy: text("refunded_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("refunds_method_check", sql`${table.method} in ('cash', 'upi', 'card')`),
    check("refunds_amount_check", sql`${table.amount} > 0`),
    uniqueIndex("refunds_org_number_idx").on(table.orgId, table.refundNumber),
    index("refunds_org_invoice_idx").on(table.orgId, table.invoiceId),
    index("refunds_org_credit_note_idx").on(table.orgId, table.creditNoteId),
    index("refunds_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
