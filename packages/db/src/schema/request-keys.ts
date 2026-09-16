import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";

// One row per money command the client submitted. Touched only through
// `claimRequestKey`, whose insert makes a retried command a no-op (D039).
export const requestKeys = pgTable(
  "request_keys",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.id] })],
);
