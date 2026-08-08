import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { catalogItems } from "./catalog-items";
import { invoices } from "./invoices";
import { visits } from "./visits";

/**
 * Billable visit line items. Description, unit price, tax rate, and tax code are
 * snapshotted at creation so later catalog changes never reprice existing care.
 * Provenance is written as `member` in v0; the AI fields make later drafting additive.
 */
export const charges = pgTable(
  "charges",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    catalogItemId: text("catalog_item_id").references(() => catalogItems.id),
    description: text("description").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    qty: integer("qty").notNull().default(1),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    status: text("status").notNull().default("pending"),
    /** Set exactly once when a pending charge becomes part of an issued invoice. */
    invoiceId: text("invoice_id").references(() => invoices.id),
    voidReason: text("void_reason"),
    generatedBy: text("generated_by").notNull().default("member"),
    modelName: text("model_name"),
    modelVersion: text("model_version"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    /** Attribution only; authorization always comes from the request's organization scope. */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("charges_qty_check", sql`${table.qty} > 0`),
    check(
      "charges_source_type_check",
      sql`${table.sourceType} in ('consult_fee', 'order', 'manual')`,
    ),
    check("charges_status_check", sql`${table.status} in ('pending', 'invoiced', 'voided')`),
    check("charges_generated_by_check", sql`${table.generatedBy} in ('member', 'ai')`),
    index("charges_org_visit_idx").on(table.orgId, table.visitId, table.status),
    index("charges_org_status_idx").on(table.orgId, table.status),
  ],
);
