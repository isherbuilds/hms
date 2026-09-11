import { sql } from "drizzle-orm";
import {
  bigint,
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

// Fixed at issuance; invoice header totals are sums of these stored line values.
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
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    lineSubtotal: bigint("line_subtotal", { mode: "bigint" }).notNull(),
    allocatedDiscount: bigint("allocated_discount", { mode: "bigint" }).notNull(),
    taxableValue: bigint("taxable_value", { mode: "bigint" }).notNull(),
    taxAmount: bigint("tax_amount", { mode: "bigint" }).notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
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
