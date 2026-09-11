import { bigint, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { creditNotes } from "./credit-notes";
import { invoiceLines } from "./invoice-lines";

// Credit-note header totals are sums of these stored line values.
export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    creditNoteId: text("credit_note_id").notNull(),
    invoiceLineId: text("invoice_line_id").notNull(),
    taxableValue: bigint("taxable_value", { mode: "bigint" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "bigint" }).notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.creditNoteId],
      foreignColumns: [creditNotes.orgId, creditNotes.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceLineId],
      foreignColumns: [invoiceLines.orgId, invoiceLines.id],
    }),
    index("credit_note_lines_org_credit_note_idx").on(table.orgId, table.creditNoteId),
    index("credit_note_lines_org_invoice_line_idx").on(table.orgId, table.invoiceLineId),
  ],
);
