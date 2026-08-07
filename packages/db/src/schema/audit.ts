import { pgTable, text, timestamp, jsonb, index, bigint, boolean } from "drizzle-orm/pg-core";

// Deliberately no FK to organization: audit entries must outlive the org (and
// keep their orgId) after it is deleted.
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
  // The identity id is insertion-ordered, so it serves as both the keyset
  // cursor and the sort key; the composite covers `audit.list`'s org filter.
  (table) => [index("audit_log_org_id_idx").on(table.orgId, table.id)],
);
