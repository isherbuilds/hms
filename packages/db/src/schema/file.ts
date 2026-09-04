import { pgTable, text, timestamp, bigint, index, unique } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const file = pgTable(
  "file",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    size: bigint("size", { mode: "number" }).notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // Covers `file.list`: tenant predicate, then the exact keyset order.
  (table) => [
    unique("file_org_id_id_unique").on(table.orgId, table.id),
    // `.desc()` emits `DESC NULLS LAST` but `ORDER BY x DESC` means NULLS FIRST — a
    // mismatch the planner will not bridge, so it discards the index and sorts.
    index("file_org_created_idx").on(
      table.orgId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
);
