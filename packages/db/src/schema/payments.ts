import { type SQL, sql } from "drizzle-orm";
import {
  bigint,
  type AnyPgColumn,
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
import { invoices } from "./invoices";
import { PAYMENT_METHODS, type PaymentMethod } from "./payment-methods";

// drizzle-kit serializes check SQL verbatim, so the list must be literal, not bound.
export function paymentMethodCheck(column: AnyPgColumn): SQL {
  return sql`${column} in (${sql.raw(PAYMENT_METHODS.map((method) => `'${method}'`).join(", "))})`;
}

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
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
    check("payments_method_check", paymentMethodCheck(table.method)),
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
