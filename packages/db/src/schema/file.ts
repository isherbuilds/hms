import { pgTable, text, timestamp, bigint, index } from "drizzle-orm/pg-core";

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
  // Covers `files.list`: tenant predicate first, then the exact sort/keyset
  // order so a page is an index range scan rather than a sort.
  (table) => [
    index("file_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
