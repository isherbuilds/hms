import { boolean, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";
import type { PayerType } from "./payer-types";

export const payers = pgTable(
  "payers",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    type: text("type").$type<PayerType>().notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("payers_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("payers_org_name_idx").on(table.orgId, table.name),
  ],
);
