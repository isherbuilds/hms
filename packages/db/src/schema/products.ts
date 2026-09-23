import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import { catalogItems } from "./catalog-items";

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

// Anything the store holds. A product with a `catalogItemId` is sold across the
// counter; one without it is an internal supply (gloves, soap, cleaning liquid)
// that is stocked and issued but never billed. `name` is the single display name:
// the linked catalog row carries the same value, because that row is the invoice
// snapshot source (D027). Code, HSN, GST rate and active live on the catalog row.
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    catalogItemId: text("catalog_item_id"),
    name: text("name").notNull(),
    genericName: text("generic_name"),
    form: text("form"),
    strength: text("strength"),
    stockUnit: text("stock_unit", { enum: STOCK_UNITS }).notNull(),
    unitsPerPack: integer("units_per_pack").notNull(),
    schedule: text("schedule", { enum: PRODUCT_SCHEDULES }).notNull().default("none"),
    manufacturer: text("manufacturer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("products_units_per_pack_check", sql`${table.unitsPerPack} >= 1`),
    unique("products_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    uniqueIndex("products_org_catalog_item_idx")
      .on(table.orgId, table.catalogItemId)
      .where(sql`${table.catalogItemId} is not null`),
    // The item list pages on this exact keyset order.
    index("products_org_name_idx").on(table.orgId, table.name, table.id),
  ],
);
