import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth";

// Returned until the first save; `settings.update` always writes a full row.
export const SETTINGS_DEFAULTS = {
  legalName: "",
  address: "",
  taxId: "",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  mrnPrefix: "",
  invoicePrefix: "INV",
  receiptPrefix: "RCT",
  creditNotePrefix: "CN",
  fiscalYearStartMonth: 4,
  followUpValidityDays: 14,
} as const;

export const organizationSettings = pgTable(
  "organization_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    address: text("address").notNull(),
    taxId: text("tax_id").notNull(),
    currency: text("currency").notNull(),
    mrnPrefix: text("mrn_prefix").notNull(),
    invoicePrefix: text("invoice_prefix").notNull(),
    receiptPrefix: text("receipt_prefix").notNull(),
    creditNotePrefix: text("credit_note_prefix").notNull(),
    // 1-12; April (4) is the Indian fiscal year start.
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull(),
    // The DB defaults on this and `followUpValidityDays` exist only to backfill rows
    // in the migration; SETTINGS_DEFAULTS is the application source.
    timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
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
