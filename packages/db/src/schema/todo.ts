import { pgTable, text, boolean, serial, timestamp, index } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const todo = pgTable(
  "todo",
  {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    completed: boolean("completed").default(false).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("todo_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
