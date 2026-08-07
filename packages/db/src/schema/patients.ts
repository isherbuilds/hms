import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, user } from "./auth";

/**
 * Patient master data is always tenant-scoped and immutable to the org boundary to
 * prevent identity bleed across organizations.
 */
export const patients = pgTable(
  "patients",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * MRN is derived from org sequence state and must remain unique per organization,
     * so the unique index is keyed by tenant + mrn.
     */
    mrn: text("mrn").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    /**
     * Sex is constrained here to keep downstream matching and analytics simple and
     * to avoid free-form values propagating past write boundaries.
     */
    sex: text("sex", { enum: ["male", "female", "other"] }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    ageYears: integer("age_years"),
    /**
     * Address is required in this schema but callers pass/emit empty string when not
     * provided; no null semantics are needed for downstream rendering.
     */
    address: text("address").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "patients_age_or_dob_check",
      sql`${table.dateOfBirth} is not null or ${table.ageYears} is not null`,
    ),
    check("patients_sex_check", sql`${table.sex} in ('male', 'female', 'other')`),
    check(
      "patients_age_range_check",
      sql`${table.ageYears} is null or ${table.ageYears} between 0 and 150`,
    ),
    uniqueIndex("patients_org_mrn_idx").on(table.orgId, table.mrn),
    index("patients_org_phone_idx").on(table.orgId, table.phone),
    // Covers patient search/list keyset pagination: org, newest-first id tiebreak.
    index("patients_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
