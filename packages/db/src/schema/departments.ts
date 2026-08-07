import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

/**
 * Clinical departments (OPD units). Referenced by practitioners and, from
 * Slice 5 on, by visits. No delete path — departments are renamed, not removed.
 */
export const departments = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One department per name per tenant; also serves the org-scoped name-ordered list.
    uniqueIndex("departments_org_name_idx").on(table.orgId, table.name),
  ],
);
