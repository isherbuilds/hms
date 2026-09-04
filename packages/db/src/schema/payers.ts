import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { PAYER_TYPES, type PayerType } from "./payer-types";

export const payers = pgTable(
  "payers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<PayerType>().notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "payers_type_check",
      sql`${table.type} in (${sql.raw(PAYER_TYPES.map((type) => `'${type}'`).join(", "))})`,
    ),
    unique("payers_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("payers_org_name_idx").on(table.orgId, table.name),
  ],
);
