import { index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { invoices } from "./invoices";

/**
 * Immutable corrections issued against invoices. Credit notes are the only
 * correction path for an issued invoice; their header totals are sums of the
 * stored credit-note line values.
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    creditNoteNumber: text("credit_note_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    reason: text("reason").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    /** Attribution only; authorization always comes from the request's organization scope. */
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("credit_notes_org_number_idx").on(table.orgId, table.creditNoteNumber),
    index("credit_notes_org_invoice_idx").on(table.orgId, table.invoiceId),
  ],
);
