import {
  check,
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, user } from "./auth";

export const patients = pgTable(
  "patients",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mrn: text("mrn").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    sex: text("sex", { enum: ["male", "female", "other", "unknown"] }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    dobEstimated: boolean("dob_estimated").default(false).notNull(),
    // Callers pass "" when not provided; no null semantics downstream.
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
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    check("patients_sex_check", sql`${table.sex} in ('male', 'female', 'other', 'unknown')`),
    check(
      "patients_blood_group_check",
      sql`${table.bloodGroup} is null or ${table.bloodGroup} in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`,
    ),
    unique("patients_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("patients_org_mrn_idx").on(table.orgId, table.mrn),
    uniqueIndex("patients_org_uid_idx")
      .on(table.orgId, table.uid)
      .where(sql`${table.uid} is not null`),
    // `patient.search` keysets on the UUIDv7 id instead, so keep this only while a
    // createdAt-ordered query exists. Same DESC NULLS trap as file.ts.
    index("patients_org_created_idx").on(
      table.orgId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
);
