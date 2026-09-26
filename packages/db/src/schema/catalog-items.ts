import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";

export const CATALOG_CATEGORIES = [
  "consultation",
  "procedure",
  "lab",
  "radiology",
  "pharmacy",
  "other",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const OPD_BILLABLE_CATEGORIES = [
  "consultation",
  "procedure",
] as const satisfies readonly CatalogCategory[];

// Soft-deactivate only: charges snapshot price and tax, so deleting would leave them dangling.
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    category: text("category", { enum: CATALOG_CATEGORIES }).notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    customRate: boolean("custom_rate").notNull().default(false),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull().default("0"),
    taxCode: text("tax_code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("catalog_items_unit_price_check", sql`${table.unitPrice} >= 0`),
    check(
      "catalog_items_tax_rate_check",
      sql`${table.taxRatePercent} >= 0 and ${table.taxRatePercent} <= 99.99`,
    ),
    unique("catalog_items_org_id_id_unique").on(table.orgId, table.id),
    index("catalog_items_org_category_name_idx").on(table.orgId, table.category, table.name),
    index("catalog_items_org_name_idx").on(table.orgId, table.name),
  ],
);
