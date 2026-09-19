import {
  boolean,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { file } from "./file";

// Minimal receiving: no purchase order, supplier ledger or purchase price. Lines create
// batches as needed and one movement each; the purchasing spec extends this.
// An opening receipt is the same document with `opening` set: no supplier, the retained
// count sheet in `fileId`, and batches that have no movement history yet.
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opening: boolean("opening").default(false).notNull(),
    supplierName: text("supplier_name"),
    supplierReference: text("supplier_reference"),
    // The day staff name on the delivery note or count sheet, not an instant: a
    // timestamp would render as the neighbouring date outside the org time zone.
    receivedOn: date("received_on").notNull(),
    // The supplier's delivery note, or the signed count sheet for an opening receipt.
    fileId: text("file_id"),
    note: text("note"),
    receivedBy: text("received_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("goods_receipts_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.fileId],
      foreignColumns: [file.orgId, file.id],
    }),
    index("goods_receipts_org_received_idx").on(table.orgId, table.receivedOn, table.id),
    index("goods_receipts_org_file_idx").on(table.orgId, table.fileId),
  ],
);
