import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";

export const STOCK_UNITS = [
  "tablet",
  "capsule",
  "ml",
  "strip",
  "bottle",
  "vial",
  "tube",
  "piece",
] as const;

export const PRODUCT_SCHEDULES = ["none", "h", "h1", "x"] as const;

// Anything the store holds. Products own their stock identity and sale facts:
// sold goods carry GST, HSN and active state; internal supplies are stocked and
// issued without appearing at the counter.
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    genericName: text("generic_name"),
    form: text("form"),
    strength: text("strength"),
    stockUnit: text("stock_unit", { enum: STOCK_UNITS }).notNull(),
    unitsPerPack: integer("units_per_pack").notNull(),
    expires: boolean("expires").notNull(),
    pack: text("pack"),
    schedule: text("schedule", { enum: PRODUCT_SCHEDULES }).notNull().default("none"),
    manufacturer: text("manufacturer"),
    sold: boolean("sold").notNull(),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("products_org_id_id_unique").on(table.orgId, table.id),
    check("products_units_per_pack_check", sql`${table.unitsPerPack} >= 1`),
    check(
      "products_tax_rate_check",
      sql`${table.taxRatePercent} >= 0 and ${table.taxRatePercent} <= 99.99`,
    ),
    // The item list pages on this exact keyset order.
    index("products_org_name_idx").on(table.orgId, table.name, table.id),
  ],
);
