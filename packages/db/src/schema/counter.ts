import { bigint, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { orgIdColumn } from "./auth";

// Touched only through `nextCounter`, whose row lock is what makes a series
// gapless. See packages/db/src/counter.ts.
export const counter = pgTable(
  "counter",
  {
    orgId: orgIdColumn(),
    key: text("key").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.key] })],
);
