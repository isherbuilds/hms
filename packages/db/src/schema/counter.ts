import { bigint, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { organization } from "./auth";

/**
 * Per-organization named sequences (MRN, document numbers, daily tokens).
 * Rows are only ever touched through `nextCounter`, whose single upsert holds
 * the row lock until the caller's transaction ends — that lock is what makes
 * a series gapless. See `packages/db/src/counter.ts`.
 */
export const counter = pgTable(
  "counter",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.key] })],
);
