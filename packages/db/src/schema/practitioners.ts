import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { catalogItems } from "./catalog-items";
import { departments } from "./departments";

/**
 * Practitioners are staff records, not accounts: doctors without logins exist,
 * so `memberUserId` is optional attribution linking a practitioner to a member.
 * FKs alone never prove tenancy —
 * handlers must verify department and fee catalog item ids belong to the same
 * org before writing them.
 */
export const practitioners = pgTable(
  "practitioners",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    registrationNumber: text("registration_number"),
    memberUserId: text("member_user_id").references(() => user.id, { onDelete: "set null" }),
    /** Catalog item snapshotted into the auto consult-fee Charge at visit creation (Slice 5). */
    consultFeeItemId: text("consult_fee_item_id").references(() => catalogItems.id),
    /** Optional follow-up fee used only for a recent visit within the configured window. */
    followUpFeeItemId: text("follow_up_fee_item_id").references(() => catalogItems.id),
    followUpValidityDays: integer("follow_up_validity_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("practitioners_org_name_idx").on(table.orgId, table.name),
    index("practitioners_org_department_idx").on(table.orgId, table.departmentId),
    check(
      "practitioners_follow_up_days_check",
      sql`${table.followUpValidityDays} is null or ${table.followUpValidityDays} between 1 and 365`,
    ),
  ],
);
