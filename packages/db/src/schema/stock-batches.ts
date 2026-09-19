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
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { products } from "./products";

// Immutable once created: number, expiry and MRP never change, so the batch row is the
// structural snapshot a sale line points at. A conflicting arrival is refused, never merged.
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    batchNumber: text("batch_number").notNull(),
    // The last day of the printed month.
    expiryDate: date("expiry_date").notNull(),
    mrp: bigint("mrp", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("stock_batches_mrp_check", sql`${table.mrp} >= 0`),
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
