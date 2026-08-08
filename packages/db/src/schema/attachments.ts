import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { file } from "./file";

/**
 * Generic file attachments: one polymorphic link table for every domain that
 * attaches documents (paper prescriptions on visits today; invoices, pharmacy
 * bills, and the like add a `targetType` value, never a new table). `targetId` intentionally
 * has no foreign key — it points at a different table per type — so each
 * domain's attach procedure must prove the target exists in the caller's org
 * before inserting, and any future delete path for an attachable target must
 * clean its attachments. The file row is the storage source of truth; reads go
 * through the files domain's presigned URLs.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => file.id),
    /** Attribution only; authorization always comes from the request's organization scope. */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("attachments_target_type_check", sql`${table.targetType} in ('visit_prescription')`),
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
    // `file.id` is the only foreign key pointing into the files domain, so
    // `files.delete` has to look for dependants before deleting. Without this
    // the check is a sequential scan of every attachment in the database.
    index("attachments_org_file_idx").on(table.orgId, table.fileId),
  ],
);
