import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    systemKey: text("system_key"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "accounts_type_check",
      sql`${table.type} in ('asset', 'liability', 'equity', 'income', 'expense')`,
    ),
    unique("accounts_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("accounts_org_code_idx").on(table.orgId, table.code),
    uniqueIndex("accounts_org_system_key_idx")
      .on(table.orgId, table.systemKey)
      .where(sql`${table.systemKey} is not null`),
  ],
);
