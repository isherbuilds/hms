import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
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
    sex: text("sex", { enum: ["male", "female", "other", "unknown"] }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    ageYears: integer("age_years"),
    /**
     * Address is required in this schema but callers pass/emit empty string when not
     * provided; no null semantics are needed for downstream rendering.
     */
    address: text("address").notNull(),
    email: text("email"),
    bloodGroup: text("blood_group", {
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    }),
    allergies: text("allergies"),
    medicalHistory: text("medical_history"),
    uid: text("uid"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "patients_age_or_dob_check",
      sql`${table.dateOfBirth} is not null or ${table.ageYears} is not null`,
    ),
    check("patients_sex_check", sql`${table.sex} in ('male', 'female', 'other', 'unknown')`),
    check(
      "patients_age_range_check",
      sql`${table.ageYears} is null or ${table.ageYears} between 0 and 150`,
    ),
    check(
      "patients_blood_group_check",
      sql`${table.bloodGroup} is null or ${table.bloodGroup} in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`,
    ),
    unique("patients_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("patients_org_mrn_idx").on(table.orgId, table.mrn),
    uniqueIndex("patients_org_uid_idx")
      .on(table.orgId, table.uid)
      .where(sql`${table.uid} is not null`),
    // Covers patient search/list keyset pagination: org, newest-first id tiebreak.
    // `.desc()` alone emits `DESC NULLS LAST`, but `ORDER BY x DESC` means NULLS
    // FIRST — a mismatch the planner will not bridge, so it discards the index
    // and falls back to a scan and sort. Both columns are NOT NULL, so this
    // only has to agree with the query.
    index("patients_org_created_idx").on(
      table.orgId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
);
