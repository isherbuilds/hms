import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";
import { journalEntries } from "./journal-entries";

export const journalLines = pgTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull(),
    accountId: text("account_id").notNull(),
    debit: bigint("debit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    credit: bigint("credit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    check("journal_lines_debit_check", sql`${table.debit} >= 0`),
    check("journal_lines_credit_check", sql`${table.credit} >= 0`),
    check("journal_lines_one_side_check", sql`(${table.debit} = 0) <> (${table.credit} = 0)`),
    foreignKey({
      columns: [table.orgId, table.entryId],
      foreignColumns: [journalEntries.orgId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    index("journal_lines_org_account_idx").on(table.orgId, table.accountId),
    index("journal_lines_org_entry_idx").on(table.orgId, table.entryId),
  ],
);
