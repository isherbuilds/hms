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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { advanceReceipts } from "./advance-receipts";
import { creditNotes } from "./credit-notes";
import { invoices } from "./invoices";
import { type PaymentMethod } from "./payment-methods";

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id"),
    creditNoteId: text("credit_note_id"),
    advanceReceiptId: text("advance_receipt_id"),
    method: text("method").$type<PaymentMethod>().notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
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
    check("refunds_amount_check", sql`${table.amount} > 0`),
    check(
      "refunds_source_check",
      sql`num_nonnulls(${table.creditNoteId}, ${table.advanceReceiptId}) = 1`,
    ),
    check(
      "refunds_invoice_source_check",
      sql`(${table.invoiceId} is not null) = (${table.creditNoteId} is not null)`,
    ),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    foreignKey({
      columns: [table.orgId, table.creditNoteId],
      foreignColumns: [creditNotes.orgId, creditNotes.id],
    }),
    foreignKey({
      columns: [table.orgId, table.advanceReceiptId],
      foreignColumns: [advanceReceipts.orgId, advanceReceipts.id],
    }),
    uniqueIndex("refunds_org_number_idx").on(table.orgId, table.refundNumber),
    // Daily collections nets refunds by business date; every other read is scoped
    // to one invoice or credit note.
    index("refunds_org_business_date_idx").on(table.orgId, table.businessDate),
    index("refunds_org_invoice_idx").on(table.orgId, table.invoiceId, table.createdAt),
    index("refunds_org_credit_note_idx").on(table.orgId, table.creditNoteId),
    index("refunds_org_advance_receipt_idx").on(table.orgId, table.advanceReceiptId),
  ],
);
