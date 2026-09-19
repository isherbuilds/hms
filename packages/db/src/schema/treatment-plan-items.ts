import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { CATALOG_CATEGORIES, catalogItems } from "./catalog-items";
import { treatmentPlans } from "./treatment-plans";

const TREATMENT_ITEM_STATUSES = ["open", "dropped"] as const;

export const treatmentPlanItems = pgTable(
  "treatment_plan_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    treatmentPlanId: text("treatment_plan_id").notNull(),
    catalogItemId: text("catalog_item_id").notNull(),
    description: text("description").notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    revenueCategory: text("revenue_category", { enum: CATALOG_CATEGORIES }).notNull(),
    qtyPlanned: integer("qty_planned").notNull(),
    note: text("note"),
    status: text("status", { enum: TREATMENT_ITEM_STATUSES }).notNull().default("open"),
    dropReason: text("drop_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("treatment_plan_items_unit_price_check", sql`${table.unitPrice} >= 0`),
    check("treatment_plan_items_tax_rate_check", sql`${table.taxRatePercent} >= 0`),
    check("treatment_plan_items_qty_check", sql`${table.qtyPlanned} > 0`),
    check(
      "treatment_plan_items_drop_reason_check",
      sql`${table.status} <> 'dropped' or ${table.dropReason} is not null`,
    ),
    unique("treatment_plan_items_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.treatmentPlanId],
      foreignColumns: [treatmentPlans.orgId, treatmentPlans.id],
    }),
    foreignKey({
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    index("treatment_plan_items_org_plan_idx").on(table.orgId, table.treatmentPlanId),
  ],
);
