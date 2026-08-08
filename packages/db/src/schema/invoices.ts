import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { patients } from "./patients";
import { visits } from "./visits";

/**
 * Immutable issued invoice headers. Organization and patient print fields are
 * snapshots captured at issuance, so later profile edits cannot alter the document.
 * Header totals are sums of the immutable invoice-line values. Invoices have no
 * status or update path: issuance is the only write, and credit notes are the only
 * correction path.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    invoiceNumber: text("invoice_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    discountReason: text("discount_reason"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull(),
    grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).notNull(),
    orgLegalName: text("org_legal_name").notNull(),
    orgAddress: text("org_address").notNull(),
    orgTaxId: text("org_tax_id").notNull(),
    currency: text("currency").notNull(),
    patientName: text("patient_name").notNull(),
    patientMrn: text("patient_mrn").notNull(),
    patientPhone: text("patient_phone").notNull(),
    patientAddress: text("patient_address"),
    /** Attribution only; authorization always comes from the request's organization scope. */
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("invoices_discount_amount_check", sql`${table.discountAmount} >= 0`),
    uniqueIndex("invoices_org_number_idx").on(table.orgId, table.invoiceNumber),
    index("invoices_org_visit_idx").on(table.orgId, table.visitId),
    index("invoices_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
