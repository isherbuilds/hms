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
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { goodsReceipts } from "./goods-receipts";
import { stockBatches } from "./stock-batches";

// One priced line of a supplier's bill. Opening stock has no lines: its count is the stock
// movements alone. Amounts are stored as computed by `receiptLineCost` so a later rate or
// tax change never rewrites a past receipt.
export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    receiptId: text("receipt_id").notNull(),
    batchId: text("batch_id").notNull(),
    // Stock units: billed, and free under a scheme such as 10+1.
    qty: integer("qty").notNull(),
    freeQty: integer("free_qty").notNull(),
    // Stock units the bill's rate covers: the pack, or 1 for loose units.
    packSize: integer("pack_size").notNull(),
    rate: bigint("rate", { mode: "bigint" }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 4, scale: 2 }).notNull(),
    gstPercent: numeric("gst_percent", { precision: 4, scale: 2 }).notNull(),
    hsnCode: text("hsn_code"),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
    discount: bigint("discount", { mode: "bigint" }).notNull(),
    taxable: bigint("taxable", { mode: "bigint" }).notNull(),
    gst: bigint("gst", { mode: "bigint" }).notNull(),
    net: bigint("net", { mode: "bigint" }).notNull(),
    unitCost: bigint("unit_cost", { mode: "bigint" }).notNull(),
  },
  (table) => [
    check("goods_receipt_lines_qty_check", sql`${table.qty} > 0 and ${table.freeQty} >= 0`),
    check("goods_receipt_lines_pack_size_check", sql`${table.packSize} > 0`),
    check("goods_receipt_lines_rate_check", sql`${table.rate} >= 0`),
    unique("goods_receipt_lines_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.receiptId],
      foreignColumns: [goodsReceipts.orgId, goodsReceipts.id],
    }),
    foreignKey({
      columns: [table.orgId, table.batchId],
      foreignColumns: [stockBatches.orgId, stockBatches.id],
    }),
    index("goods_receipt_lines_org_receipt_idx").on(table.orgId, table.receiptId),
    index("goods_receipt_lines_org_batch_idx").on(table.orgId, table.batchId),
  ],
);
