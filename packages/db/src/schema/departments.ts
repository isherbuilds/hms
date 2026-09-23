import { foreignKey, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import { catalogItems } from "./catalog-items";

// No delete path — departments are renamed, not removed.
export const departments = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    defaultConsultFeeItemId: text("default_consult_fee_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("departments_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.defaultConsultFeeItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    uniqueIndex("departments_org_name_idx").on(table.orgId, table.name),
  ],
);
