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
import { invoices } from "./invoices";
import { opdAppointments } from "./opd-appointments";
import { pharmacySales } from "./pharmacy-sales";

export const CHARGE_SOURCE_TYPES = [
  "consult_fee",
  "catalog",
  "treatment_plan",
  "pharmacy_batch",
] as const;

export const CHARGE_STATUSES = ["pending", "invoiced", "voided"] as const;

// Description, price, tax and revenue category are snapshotted at creation, so
// later catalog changes never alter existing care.
export const charges = pgTable(
  "charges",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opdAppointmentId: text("opd_appointment_id"),
    pharmacySaleId: text("pharmacy_sale_id"),
    catalogItemId: text("catalog_item_id").notNull(),
    description: text("description").notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    priceUnits: integer("price_units").notNull().default(1),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    revenueCategory: text("revenue_category", { enum: CATALOG_CATEGORIES }).notNull(),
    qty: integer("qty").notNull().default(1),
    sourceType: text("source_type", { enum: CHARGE_SOURCE_TYPES }).notNull(),
    sourceId: text("source_id"),
    status: text("status", { enum: CHARGE_STATUSES }).notNull().default("pending"),
    // Set exactly once, when a pending charge joins an issued invoice.
    invoiceId: text("invoice_id"),
    voidReason: text("void_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("charges_qty_check", sql`${table.qty} > 0`),
    check("charges_unit_price_check", sql`${table.unitPrice} >= 0`),
    check("charges_price_units_check", sql`${table.priceUnits} > 0`),
    check("charges_tax_rate_percent_check", sql`${table.taxRatePercent} >= 0`),
    check(
      "charges_parent_check",
      sql`(${table.opdAppointmentId} is not null and ${table.pharmacySaleId} is null) or (${table.pharmacySaleId} is not null and ${table.opdAppointmentId} is null)`,
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
      columns: [table.orgId, table.pharmacySaleId],
      foreignColumns: [pharmacySales.orgId, pharmacySales.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    index("charges_org_opd_appointment_idx").on(table.orgId, table.opdAppointmentId, table.status),
    index("charges_org_pharmacy_sale_idx").on(table.orgId, table.pharmacySaleId),
    // Only a plan-posted charge carries a source id, so the partial index skips every
    // consult fee and visit service; the source type filters after the lookup.
    index("charges_org_source_idx")
      .on(table.orgId, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index("charges_org_status_created_idx").on(
      table.orgId,
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);
