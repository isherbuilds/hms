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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { REVENUE_CATEGORIES, catalogItems } from "./catalog-items";
import { invoices } from "./invoices";
import { ADMISSION_CHARGE_KINDS, admissionPharmacyIssueLines, admissions } from "./ipd";
import { opdAppointments } from "./opd-appointments";
import { pharmacySales } from "./pharmacy-sales";
import { PRICE_BASES } from "./price-basis";
import { stockBatches } from "./stock-batches";

const CHARGE_SOURCE_TYPES = [
  "consult_fee",
  "catalog",
  "treatment_plan",
  "pharmacy_batch",
  "admission",
] as const;

const CHARGE_STATUSES = ["pending", "invoiced", "voided"] as const;

// Description, price, tax and revenue category are snapshotted at creation;
// later changes to services or products never alter an existing Charge.
export const charges = pgTable(
  "charges",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    opdAppointmentId: text("opd_appointment_id"),
    pharmacySaleId: text("pharmacy_sale_id"),
    admissionId: text("admission_id"),
    admissionKind: text("admission_kind", { enum: ADMISSION_CHARGE_KINDS }),
    // Set only on a `pharmacy_issue` Charge: the ward issue line it bills.
    admissionIssueLineId: text("admission_issue_line_id"),
    catalogItemId: text("catalog_item_id"),
    description: text("description").notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    priceUnits: integer("price_units").notNull().default(1),
    taxRatePercent: numeric("tax_rate_percent", { precision: 4, scale: 2 }).notNull(),
    taxCode: text("tax_code"),
    // A Charge that sells a stock batch is priced at MRP, GST inside; everything else adds GST.
    priceBasis: text("price_basis", { enum: PRICE_BASES })
      .notNull()
      .generatedAlwaysAs(
        sql`case when stock_batch_id is null then 'exclusive' else 'inclusive' end`,
      ),
    revenueCategory: text("revenue_category", { enum: REVENUE_CATEGORIES }).notNull(),
    qty: integer("qty").notNull().default(1),
    sourceType: text("source_type", { enum: CHARGE_SOURCE_TYPES }).notNull(),
    sourceId: text("source_id"),
    stockBatchId: text("stock_batch_id"),
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
    check("charges_price_units_check", sql`${table.priceUnits} >= 1`),
    check("charges_tax_rate_percent_check", sql`${table.taxRatePercent} >= 0`),
    check(
      "charges_parent_check",
      sql`num_nonnulls(${table.opdAppointmentId}, ${table.pharmacySaleId}, ${table.admissionId}) = 1`,
    ),
    check(
      "charges_catalog_item_source_check",
      sql`(${table.sourceType} = 'admission') = (${table.admissionId} is not null) and (${table.sourceType} = 'admission') = (${table.admissionKind} is not null) and (${table.sourceType} <> 'admission' or ${table.sourceId} is not distinct from ${table.admissionId}) and (${table.admissionIssueLineId} is not null) = coalesce(${table.admissionKind} = 'pharmacy_issue', false) and (${table.stockBatchId} is not null) = (${table.sourceType} = 'pharmacy_batch' or coalesce(${table.admissionKind} = 'pharmacy_issue', false)) and (${table.catalogItemId} is null) = (${table.stockBatchId} is not null) and (${table.sourceType} <> 'pharmacy_batch' or (${table.pharmacySaleId} is not null and ${table.sourceId} is null))`,
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
      columns: [table.orgId, table.admissionId],
      foreignColumns: [admissions.orgId, admissions.id],
    }),
    foreignKey({
      columns: [table.orgId, table.admissionIssueLineId, table.admissionId, table.stockBatchId],
      foreignColumns: [
        admissionPharmacyIssueLines.orgId,
        admissionPharmacyIssueLines.id,
        admissionPharmacyIssueLines.admissionId,
        admissionPharmacyIssueLines.batchId,
      ],
    }),
    foreignKey({
      columns: [table.orgId, table.stockBatchId],
      foreignColumns: [stockBatches.orgId, stockBatches.id],
    }),
    foreignKey({
      columns: [table.orgId, table.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    index("charges_org_opd_appointment_idx").on(table.orgId, table.opdAppointmentId, table.status),
    index("charges_org_admission_idx")
      .on(table.orgId, table.admissionId, table.status)
      .where(sql`${table.admissionId} is not null`),
    // An issue line is billed by one live Charge.
    uniqueIndex("charges_org_admission_issue_line_idx")
      .on(table.orgId, table.admissionIssueLineId)
      .where(sql`${table.admissionIssueLineId} is not null and ${table.status} <> 'voided'`),
    index("charges_org_pharmacy_sale_idx").on(table.orgId, table.pharmacySaleId),
    // Treatment plan charges retain their source ids.
    index("charges_org_source_idx")
      .on(table.orgId, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index("charges_org_stock_batch_idx")
      .on(table.orgId, table.stockBatchId)
      .where(sql`${table.stockBatchId} is not null`),
    index("charges_org_status_created_idx").on(
      table.orgId,
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);
