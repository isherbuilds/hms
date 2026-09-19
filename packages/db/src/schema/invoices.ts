import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { opdAppointments } from "./opd-appointments";
import { patients } from "./patients";
import { pharmacySales } from "./pharmacy-sales";

const INVOICE_STREAMS = ["opd", "pharmacy"] as const;

// Immutable: issuance is the only write, and credit notes are the only correction
// path. Print fields are snapshots, so later profile edits cannot alter the document.
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stream: text("stream", { enum: INVOICE_STREAMS }).notNull().default("opd"),
    opdAppointmentId: text("opd_appointment_id"),
    pharmacySaleId: text("pharmacy_sale_id"),
    patientId: text("patient_id"),
    invoiceNumber: text("invoice_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date").notNull(),
    discountAmount: bigint("discount_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    // Internal, and deliberately not printed, so the desk can write plainly. Required
    // by the app whenever there is a discount or an unpaid departure.
    note: text("note"),
    subtotal: bigint("subtotal", { mode: "bigint" }).notNull(),
    taxTotal: bigint("tax_total", { mode: "bigint" }).notNull(),
    grandTotal: bigint("grand_total", { mode: "bigint" }).notNull(),
    orgLegalName: text("org_legal_name").notNull(),
    orgAddress: text("org_address").notNull(),
    orgTaxId: text("org_tax_id").notNull(),
    currency: text("currency").notNull(),
    patientName: text("patient_name").notNull(),
    patientMrn: text("patient_mrn"),
    patientPhone: text("patient_phone"),
    patientAddress: text("patient_address"),
    // "W/o Gurmeet Singh" as printed; snapshotted like the name so the document is stable.
    patientGuardian: text("patient_guardian"),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("invoices_discount_amount_check", sql`${table.discountAmount} >= 0`),
    check("invoices_subtotal_check", sql`${table.subtotal} >= 0`),
    check("invoices_tax_total_check", sql`${table.taxTotal} >= 0`),
    check("invoices_grand_total_check", sql`${table.grandTotal} >= 0`),
    check(
      "invoices_discount_not_above_subtotal_check",
      sql`${table.discountAmount} <= ${table.subtotal}`,
    ),
    // Exactly one parent, and it matches the stream.
    check(
      "invoices_parent_check",
      sql`(${table.stream} = 'opd' and ${table.opdAppointmentId} is not null and ${table.patientId} is not null and ${table.pharmacySaleId} is null) or (${table.stream} = 'pharmacy' and ${table.pharmacySaleId} is not null and ${table.opdAppointmentId} is null)`,
    ),
    // Pharmacy prices are MRP inclusive of GST, so its tax is already inside the gross.
    check(
      "invoices_total_math_check",
      sql`${table.grandTotal} = ${table.subtotal} - ${table.discountAmount} + (case ${table.stream} when 'opd' then ${table.taxTotal} else 0 end)`,
    ),
    unique("invoices_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("invoices_org_number_idx").on(table.orgId, table.invoiceNumber),
    foreignKey({
      columns: [table.orgId, table.opdAppointmentId],
      foreignColumns: [opdAppointments.orgId, opdAppointments.id],
    }),
    foreignKey({
      columns: [table.orgId, table.pharmacySaleId],
      foreignColumns: [pharmacySales.orgId, pharmacySales.id],
    }),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    index("invoices_org_opd_appointment_idx").on(
      table.orgId,
      table.opdAppointmentId,
      table.createdAt,
    ),
    // One invoice per sale.
    uniqueIndex("invoices_org_pharmacy_sale_idx")
      .on(table.orgId, table.pharmacySaleId)
      .where(sql`${table.pharmacySaleId} is not null`),
    index("invoices_org_business_date_idx").on(table.orgId, table.businessDate),
    // Ascending: the worklist reads oldest-first, and a DESC index cannot serve an ASC
    // scan without the same NULLS trap as file.ts.
    index("invoices_org_created_idx").on(table.orgId, table.createdAt, table.id),
  ],
);
