import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { catalogItems } from "./catalog-items";
import { departments } from "./departments";

// Staff records, not accounts: `memberUserId` is optional attribution. FKs alone
// never prove tenancy — handlers must check department and fee item ids are in the
// same org before writing them.
export const practitioners = pgTable(
  "practitioners",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    departmentId: text("department_id").notNull(),
    registrationNumber: text("registration_number"),
    memberUserId: text("member_user_id").references(() => user.id, { onDelete: "set null" }),
    // Snapshotted into the automatic consult-fee charge at appointment creation.
    consultFeeItemId: text("consult_fee_item_id"),
    // Used only for a repeat appointment inside the configured follow-up window.
    followUpFeeItemId: text("follow_up_fee_item_id"),
    followUpValidityDays: integer("follow_up_validity_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("practitioners_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
    foreignKey({
      columns: [table.orgId, table.consultFeeItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    foreignKey({
      columns: [table.orgId, table.followUpFeeItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    index("practitioners_org_name_idx").on(table.orgId, table.name),
    index("practitioners_org_department_idx").on(table.orgId, table.departmentId),
    check(
      "practitioners_follow_up_days_check",
      sql`${table.followUpValidityDays} is null or ${table.followUpValidityDays} between 1 and 365`,
    ),
  ],
);
