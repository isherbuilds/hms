import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { advanceReceipts } from "./advance-receipts";
import { organization, user } from "./auth";
import { invoices } from "./invoices";

export const advanceAllocations = pgTable(
  "advance_allocations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    advanceReceiptId: text("advance_receipt_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    allocatedBy: text("allocated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("advance_allocations_amount_check", sql`${table.amount} > 0`),
    unique("advance_allocations_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.advanceReceiptId],
      foreignColumns: [advanceReceipts.orgId, advanceReceipts.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    index("advance_allocations_org_invoice_idx").on(table.orgId, table.invoiceId),
    index("advance_allocations_org_receipt_idx").on(table.orgId, table.advanceReceiptId),
  ],
);
