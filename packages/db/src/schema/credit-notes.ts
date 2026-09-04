import {
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { invoices } from "./invoices";

// The only correction path for an issued invoice. Header totals are sums of the
// stored credit-note lines.
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    creditNoteNumber: text("credit_note_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date").notNull(),
    reason: text("reason").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("credit_notes_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    uniqueIndex("credit_notes_org_number_idx").on(table.orgId, table.creditNoteNumber),
    index("credit_notes_org_invoice_idx").on(table.orgId, table.invoiceId),
    index("credit_notes_org_business_date_idx").on(table.orgId, table.businessDate),
  ],
);
