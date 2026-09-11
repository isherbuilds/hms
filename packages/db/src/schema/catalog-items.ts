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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const CATALOG_CATEGORIES = [
  "consultation",
  "procedure",
  "lab",
  "radiology",
  "other",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

// Revenue posts per category, so a lab item on an OPD invoice would make the two
// streams indistinguishable at the document level. Lab and radiology are billed by
// the domain that orders them.
export const OPD_BILLABLE_CATEGORIES = [
  "consultation",
  "procedure",
] as const satisfies readonly CatalogCategory[];

// Soft-deactivate only: charges snapshot price and tax at creation, so a deleted
// item would leave existing charges dangling.
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    category: text("category", { enum: CATALOG_CATEGORIES }).notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    // The single stored rate; the CGST/SGST split is display-time.
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull().default("0"),
    taxCode: text("tax_code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "catalog_items_category_check",
      sql`${table.category} in ('consultation', 'procedure', 'lab', 'radiology', 'other')`,
    ),
    check("catalog_items_unit_price_check", sql`${table.unitPrice} >= 0`),
    check(
      "catalog_items_tax_rate_check",
      sql`${table.taxRatePercent} >= 0 and ${table.taxRatePercent} <= 99.99`,
    ),
    unique("catalog_items_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("catalog_items_org_code_idx").on(table.orgId, table.code),
    index("catalog_items_org_category_name_idx").on(table.orgId, table.category, table.name),
    index("catalog_items_org_name_idx").on(table.orgId, table.name),
  ],
);
