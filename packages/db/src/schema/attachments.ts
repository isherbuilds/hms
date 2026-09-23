import { foreignKey, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { file } from "./file";

const ATTACHMENT_TARGETS = ["prescription"] as const;

// `targetId` has no foreign key — it points at a different table per `targetType`.
// Each domain's attach procedure must prove the target is in the caller's org, and
// any delete path for an attachable target must clean its attachments.
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    targetType: text("target_type", { enum: ATTACHMENT_TARGETS }).notNull(),
    targetId: text("target_id").notNull(),
    fileId: text("file_id").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Tenant-scoped, like every other child row: a direct writer cannot attach a
    // file that belongs to another organization.
    foreignKey({
      columns: [table.orgId, table.fileId],
      foreignColumns: [file.orgId, file.id],
    }),
    uniqueIndex("attachments_org_target_file_uq").on(
      table.orgId,
      table.targetType,
      table.targetId,
      table.fileId,
    ),
    index("attachments_org_target_idx").on(
      table.orgId,
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    // Without this, `file.delete`'s dependant check is a sequential scan of every
    // attachment in the database.
    index("attachments_org_file_idx").on(table.orgId, table.fileId),
  ],
);
