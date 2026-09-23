import { foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { creditNotes } from "./credit-notes";
import { invoices } from "./invoices";
import { pharmacySales } from "./pharmacy-sales";

export const RETURN_REASON_CODES = [
  "damaged",
  "wrong_item",
  "unwanted",
  "expired_on_shelf",
  "correction",
] as const;

// A return moves money and stock together: the credit note is posted in the same
// transaction as the `return` movements into quarantine. A return of only
// fully-discounted goods carries no money, so it has no credit note.
export const pharmacyReturns = pgTable(
  "pharmacy_returns",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    pharmacySaleId: text("pharmacy_sale_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    creditNoteId: text("credit_note_id"),
    reasonCode: text("reason_code", { enum: RETURN_REASON_CODES }).notNull(),
    note: text("note"),
    acceptedBy: text("accepted_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("pharmacy_returns_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.pharmacySaleId],
      foreignColumns: [pharmacySales.orgId, pharmacySales.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    foreignKey({
      columns: [table.orgId, table.creditNoteId],
      foreignColumns: [creditNotes.orgId, creditNotes.id],
    }),
    index("pharmacy_returns_org_sale_idx").on(table.orgId, table.pharmacySaleId),
  ],
);
