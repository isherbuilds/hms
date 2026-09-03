import { date, index, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    narration: text("narration").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("journal_entries_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("journal_entries_org_source_idx").on(table.orgId, table.sourceType, table.sourceId),
    index("journal_entries_org_date_idx").on(table.orgId, table.entryDate),
  ],
);
