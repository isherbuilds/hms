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

import { organization, user } from "./auth";
import { departments } from "./departments";
import { stockBatches } from "./stock-batches";

export const STOCK_BUCKETS = ["shelf", "quarantine"] as const;

export type StockBucket = (typeof STOCK_BUCKETS)[number];

const STOCK_MOVEMENT_REASONS = [
  "opening",
  "receipt",
  "sale",
  "return",
  "release",
  "quarantine",
  "writeoff",
  "breakage",
  "count_correction",
  "internal_issue",
] as const;

export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

const STOCK_MOVEMENT_SOURCES = [
  "goods_receipt",
  "pharmacy_sale",
  "pharmacy_return",
  "adjustment",
] as const;

export type StockMovementSource = (typeof STOCK_MOVEMENT_SOURCES)[number];

// On hand per bucket is sum(qty); stock is never typed. Append-only.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    bucket: text("bucket", { enum: STOCK_BUCKETS }).notNull(),
    qty: integer("qty").notNull(),
    reason: text("reason", { enum: STOCK_MOVEMENT_REASONS }).notNull(),
    sourceType: text("source_type", { enum: STOCK_MOVEMENT_SOURCES }).notNull(),
    sourceId: text("source_id").notNull(),
    // Set only by an `internal_issue`: the department the stock left the store for.
    departmentId: text("department_id"),
    note: text("note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("stock_movements_qty_check", sql`${table.qty} <> 0`),
    // `release` and `quarantine` are a negative/positive pair across the two buckets and
    // `count_correction` goes either way, so only the one-way reasons pin a sign.
    check(
      "stock_movements_sign_check",
      sql`(${table.reason} in ('sale', 'writeoff', 'breakage', 'internal_issue') and ${table.qty} < 0) or (${table.reason} in ('opening', 'receipt', 'return') and ${table.qty} > 0) or (${table.reason} in ('release', 'quarantine', 'count_correction'))`,
    ),
    unique("stock_movements_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.batchId],
      foreignColumns: [stockBatches.orgId, stockBatches.id],
    }),
    foreignKey({
      columns: [table.orgId, table.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
    // A source posts each movement once per bucket, so a retried writer cannot double-move.
    uniqueIndex("stock_movements_source_idx").on(
      table.orgId,
      table.sourceType,
      table.sourceId,
      table.batchId,
      table.bucket,
    ),
    index("stock_movements_org_batch_bucket_idx").on(table.orgId, table.batchId, table.bucket),
    index("stock_movements_org_created_idx").on(table.orgId, table.createdAt, table.id),
  ],
);
