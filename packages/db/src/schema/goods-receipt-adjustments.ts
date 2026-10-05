import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgTable, text } from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import { goodsReceipts } from "./goods-receipts";

// A freight/packing charge or a bill-level discount printed apart from the stock lines.
// The kind gives the sign; ids are UUIDv7, so they sort in entry order.
export const goodsReceiptAdjustments = pgTable(
  "goods_receipt_adjustments",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    receiptId: text("receipt_id").notNull(),
    kind: text("kind", { enum: ["landed_charge", "invoice_discount"] }).notNull(),
    reason: text("reason").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    gstAmount: bigint("gst_amount", { mode: "bigint" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.receiptId],
      foreignColumns: [goodsReceipts.orgId, goodsReceipts.id],
    }),
    check(
      "goods_receipt_adjustments_amount_check",
      sql`${table.amount} > 0 and ${table.gstAmount} >= 0`,
    ),
  ],
);
