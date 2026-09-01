import { pgTable, text, timestamp, jsonb, index, bigint, boolean } from "drizzle-orm/pg-core";

// No FK to organization: entries must outlive the org, keeping their orgId.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    action: text("action").notNull(),
    denied: boolean("denied").default(false).notNull(),
    actorId: text("actor_id").notNull(),
    orgId: text("org_id").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // The id is insertion-ordered, so it is both the keyset cursor and the sort key.
  (table) => [index("audit_log_org_id_idx").on(table.orgId, table.id)],
);
