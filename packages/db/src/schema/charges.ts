import { sql } from "drizzle-orm";
import {
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
import { invoices } from "./invoices";
import { opdAppointments } from "./opd-appointments";

/**
 * Billable line items, hung directly off the OPD appointment they were incurred
 * in. Description,
 * price, tax, and revenue category are snapshotted at creation so later catalog
 * changes never alter existing care.
 *
 * A patient-level account (advances, deposits, insurance) is deliberately absent.
 * If a live workflow earns one, it is additive; it does not restore the removed
 * per-attendance wrapper (decision D013).
 */
export const charges = pgTable(
  "charges",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opdAppointmentId: text("opd_appointment_id").notNull(),
    catalogItemId: text("catalog_item_id").notNull(),
    description: text("description").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    revenueCategory: text("revenue_category", { enum: CATALOG_CATEGORIES }).notNull(),
    qty: integer("qty").notNull().default(1),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    status: text("status").notNull().default("pending"),
    /** Set exactly once when a pending charge becomes part of an issued invoice. */
    invoiceId: text("invoice_id"),
    voidReason: text("void_reason"),
    /** Attribution only; authorization always comes from the request's organization scope. */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("charges_qty_check", sql`${table.qty} > 0`),
    check("charges_unit_price_check", sql`${table.unitPrice} >= 0`),
    check("charges_tax_rate_percent_check", sql`${table.taxRatePercent} >= 0`),
    // No `order`: orders left the consult domain before it shipped, and
    // in-house fulfillment is billed as a `catalog` charge by the desk.
    check("charges_source_type_check", sql`${table.sourceType} in ('consult_fee', 'catalog')`),
    check("charges_status_check", sql`${table.status} in ('pending', 'invoiced', 'voided')`),
    check(
      "charges_revenue_category_check",
      sql`${table.revenueCategory} in ('consultation', 'procedure', 'lab', 'radiology', 'other')`,
    ),
    unique("charges_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.opdAppointmentId],
      foreignColumns: [opdAppointments.orgId, opdAppointments.id],
    }),
    foreignKey({
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    index("charges_org_opd_appointment_idx").on(table.orgId, table.opdAppointmentId, table.status),
    index("charges_org_status_created_idx").on(
      table.orgId,
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);
