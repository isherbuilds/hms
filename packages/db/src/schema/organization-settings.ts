import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth";

/**
 * Single source of truth for a fresh organization's settings: `settings.get`
 * returns these until the first save, and `settings.update` always writes a
 * full row. The follow-up-days DB default exists only to backfill existing
 * rows during migration; `SETTINGS_DEFAULTS` remains the application source.
 */
export const SETTINGS_DEFAULTS = {
  legalName: "",
  address: "",
  taxId: "",
  currency: "INR",
  mrnPrefix: "",
  invoicePrefix: "INV",
  receiptPrefix: "RCT",
  creditNotePrefix: "CN",
  fiscalYearStartMonth: 4,
  followUpValidityDays: 14,
} as const;

// 1:1 with organization — the org id is the primary key.
export const organizationSettings = pgTable(
  "organization_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    address: text("address").notNull(),
    /** GSTIN/PAN or equivalent — printed on invoices, never validated here. */
    taxId: text("tax_id").notNull(),
    /** ISO 4217 code; org-level, no conversion anywhere. */
    currency: text("currency").notNull(),
    mrnPrefix: text("mrn_prefix").notNull(),
    invoicePrefix: text("invoice_prefix").notNull(),
    receiptPrefix: text("receipt_prefix").notNull(),
    creditNotePrefix: text("credit_note_prefix").notNull(),
    /** 1–12; April (4) is the Indian fiscal year start. */
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull(),
    /**
     * The DB default exists solely to backfill existing rows in the migration;
     * `SETTINGS_DEFAULTS` remains the application-level source.
     */
    followUpValidityDays: integer("follow_up_validity_days").notNull().default(14),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "organization_settings_fiscal_month_check",
      sql`${table.fiscalYearStartMonth} between 1 and 12`,
    ),
    check(
      "organization_settings_follow_up_days_check",
      sql`${table.followUpValidityDays} between 1 and 365`,
    ),
  ],
);
