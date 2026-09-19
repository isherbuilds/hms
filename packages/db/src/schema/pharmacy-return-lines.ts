import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { invoiceLines } from "./invoice-lines";
import { pharmacyReturns } from "./pharmacy-returns";
import { stockBatches } from "./stock-batches";

// A line is goods, money, or both: a fully discounted line returns goods with zero
// money, and a correction returns money with zero quantity.
export const pharmacyReturnLines = pgTable(
  "pharmacy_return_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    returnId: text("return_id").notNull(),
    invoiceLineId: text("invoice_line_id").notNull(),
    batchId: text("batch_id").notNull(),
    qty: integer("qty").notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
  },
  (table) => [
    check("pharmacy_return_lines_qty_check", sql`${table.qty} >= 0`),
    check("pharmacy_return_lines_gross_check", sql`${table.gross} >= 0`),
    check("pharmacy_return_lines_non_empty_check", sql`${table.qty} > 0 or ${table.gross} > 0`),
    unique("pharmacy_return_lines_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.returnId],
      foreignColumns: [pharmacyReturns.orgId, pharmacyReturns.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceLineId],
      foreignColumns: [invoiceLines.orgId, invoiceLines.id],
    }),
    foreignKey({
      columns: [table.orgId, table.batchId],
      foreignColumns: [stockBatches.orgId, stockBatches.id],
    }),
    // Capping a line at sold minus already returned sums the prior returns of one line.
    index("pharmacy_return_lines_org_invoice_line_idx").on(table.orgId, table.invoiceLineId),
  ],
);
