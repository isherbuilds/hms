import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import { products } from "./products";

// Batch number, expiry and MRP are immutable once created.
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    productId: text("product_id").notNull(),
    batchNumber: text("batch_number").notNull(),
    // The last day of the printed month, or null for a product without expiry.
    expiryDate: date("expiry_date"),
    // Printed paise per mrpUnits stock units.
    mrp: bigint("mrp", { mode: "bigint" }).notNull(),
    mrpUnits: integer("mrp_units").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("stock_batches_mrp_check", sql`${table.mrp} >= 0`),
    check("stock_batches_mrp_units_check", sql`${table.mrpUnits} > 0`),
    unique("stock_batches_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.productId],
      foreignColumns: [products.orgId, products.id],
    }),
    uniqueIndex("stock_batches_org_product_batch_idx").on(
      table.orgId,
      table.productId,
      table.batchNumber,
    ),
    // The batch-lock order and the expiring-soon read share this index.
    index("stock_batches_org_expiry_idx").on(table.orgId, table.expiryDate, table.id),
  ],
);
