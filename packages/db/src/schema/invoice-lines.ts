import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { CATALOG_CATEGORIES } from "./catalog-items";
import { charges } from "./charges";
import { invoices } from "./invoices";

/**
 * Immutable snapshot-of-record for every issued invoice line. Description,
 * quantity, price, discount allocation, taxable value, tax, and gross are fixed
 * at issuance; invoice header totals are sums of these stored line values.
 */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    chargeId: text("charge_id").notNull(),
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 2 }).notNull(),
    allocatedDiscount: numeric("allocated_discount", { precision: 12, scale: 2 }).notNull(),
    taxableValue: numeric("taxable_value", { precision: 12, scale: 2 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull(),
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull(),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    revenueCategory: text("revenue_category", { enum: CATALOG_CATEGORIES }).notNull(),
  },
  (table) => [
    check(
      "invoice_lines_revenue_category_check",
      sql`${table.revenueCategory} in ('consultation', 'procedure', 'lab', 'radiology', 'other')`,
    ),
    unique("invoice_lines_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    foreignKey({
      columns: [table.orgId, table.chargeId],
      foreignColumns: [charges.orgId, charges.id],
    }),
    uniqueIndex("invoice_lines_charge_idx").on(table.chargeId),
    index("invoice_lines_org_invoice_idx").on(table.orgId, table.invoiceId),
  ],
);
