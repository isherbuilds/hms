import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { catalogItems } from "./catalog-items";
import { patients } from "./patients";
import { practitioners } from "./practitioners";
import { stockBatches } from "./stock-batches";

// Facility masters are never deleted, so stays keep pointing at them; only beds retire.
export const wards = pgTable(
  "wards",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("wards_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("wards_org_name_uq").on(table.orgId, table.name),
  ],
);

export const bedCategories = pgTable(
  "bed_categories",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("bed_categories_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("bed_categories_org_name_uq").on(table.orgId, table.name),
  ],
);

// Effective-dated and append-only: a later tariff applies to new stays only, because
// each stay snapshots the tariff it started under.
export const bedTariffs = pgTable(
  "bed_tariffs",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    categoryId: text("category_id").notNull(),
    catalogItemId: text("catalog_item_id").notNull(),
    dailyPrice: bigint("daily_price", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("bed_tariffs_daily_price_check", sql`${table.dailyPrice} >= 0`),
    unique("bed_tariffs_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.categoryId],
      foreignColumns: [bedCategories.orgId, bedCategories.id],
    }),
    foreignKey({
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
    }),
    index("bed_tariffs_org_category_effective_idx").on(
      table.orgId,
      table.categoryId,
      table.effectiveFrom.desc(),
      table.id.desc(),
    ),
    // Two rates from one instant would leave the rate in force to an id tiebreak.
    uniqueIndex("bed_tariffs_org_category_effective_uq").on(
      table.orgId,
      table.categoryId,
      table.effectiveFrom,
    ),
  ],
);

// Occupancy is derived from open stays; a bed stores only its configuration and a
// block that staff lift explicitly once it is cleaned.
export const beds = pgTable(
  "beds",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    wardId: text("ward_id").notNull(),
    categoryId: text("category_id").notNull(),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "beds_blocked_reason_check",
      sql`(${table.blockedAt} is null) = (${table.blockedReason} is null)`,
    ),
    unique("beds_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("beds_org_ward_label_uq").on(table.orgId, table.wardId, table.label),
    foreignKey({
      columns: [table.orgId, table.wardId],
      foreignColumns: [wards.orgId, wards.id],
    }),
    foreignKey({
      columns: [table.orgId, table.categoryId],
      foreignColumns: [bedCategories.orgId, bedCategories.id],
    }),
  ],
);

export const ADMISSION_STATUSES = [
  "admitted",
  "discharge_ready",
  "discharged",
  "cancelled",
] as const;

export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const ACTIVE_ADMISSION_STATUSES = [
  "admitted",
  "discharge_ready",
] as const satisfies readonly AdmissionStatus[];

export const ENDED_ADMISSION_STATUSES = [
  "discharged",
  "cancelled",
] as const satisfies readonly AdmissionStatus[];

// An inpatient stay with its own lifecycle (D013/D019): not an Encounter or Visit.
export const admissions = pgTable(
  "admissions",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    patientId: text("patient_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    status: text("status", { enum: ADMISSION_STATUSES }).notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // Snapshotted so later setting changes never re-time a stay.
    timeZone: text("time_zone").notNull(),
    // Optimistic lifecycle version: every state change or transfer advances it.
    revision: integer("revision").notNull().default(0),
    // Optimistic version of this stay's pending/invoiced charge set (D020).
    chargeRevision: integer("charge_revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "admissions_ready_check",
      sql`${table.status} <> 'discharge_ready' or ${table.readyAt} is not null`,
    ),
    check(
      "admissions_discharged_check",
      sql`(${table.status} = 'discharged') = (${table.dischargedAt} is not null)`,
    ),
    check(
      "admissions_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null) and (${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
    check(
      "admissions_timeline_check",
      sql`(${table.readyAt} is null or ${table.readyAt} >= ${table.admittedAt}) and (${table.dischargedAt} is null or ${table.dischargedAt} >= coalesce(${table.readyAt}, ${table.admittedAt}))`,
    ),
    unique("admissions_org_id_id_unique").on(table.orgId, table.id),
    // Lets an ipd Invoice prove its patient is the Admission's patient.
    unique("admissions_org_id_patient_unique").on(table.orgId, table.id, table.patientId),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.practitionerId],
      foreignColumns: [practitioners.orgId, practitioners.id],
    }),
    uniqueIndex("admissions_org_patient_active_uq")
      .on(table.orgId, table.patientId)
      .where(sql`${table.status} in ('admitted', 'discharge_ready')`),
    index("admissions_org_status_admitted_idx").on(
      table.orgId,
      table.status,
      table.admittedAt.desc(),
      table.id.desc(),
    ),
  ],
);

// Occupancy history: a transfer closes one stay and opens the next at the same
// instant. A stay snapshots the tariff it started under.
export const admissionBedStays = pgTable(
  "admission_bed_stays",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    admissionId: text("admission_id").notNull(),
    bedId: text("bed_id").notNull(),
    tariffId: text("tariff_id").notNull(),
    dailyPrice: bigint("daily_price", { mode: "bigint" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "admission_bed_stays_interval_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check("admission_bed_stays_daily_price_check", sql`${table.dailyPrice} >= 0`),
    unique("admission_bed_stays_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.admissionId],
      foreignColumns: [admissions.orgId, admissions.id],
    }),
    foreignKey({
      columns: [table.orgId, table.bedId],
      foreignColumns: [beds.orgId, beds.id],
    }),
    foreignKey({
      columns: [table.orgId, table.tariffId],
      foreignColumns: [bedTariffs.orgId, bedTariffs.id],
    }),
    uniqueIndex("admission_bed_stays_org_bed_open_uq")
      .on(table.orgId, table.bedId)
      .where(sql`${table.endedAt} is null`),
    uniqueIndex("admission_bed_stays_org_admission_open_uq")
      .on(table.orgId, table.admissionId)
      .where(sql`${table.endedAt} is null`),
    index("admission_bed_stays_org_bed_started_idx").on(table.orgId, table.bedId, table.startedAt),
    index("admission_bed_stays_org_admission_started_idx").on(
      table.orgId,
      table.admissionId,
      table.startedAt,
    ),
  ],
);

// What an Admission Charge records; later kinds are a constant change (D042).
export const ADMISSION_CHARGE_KINDS = ["service", "pharmacy_issue"] as const;

export type AdmissionChargeKind = (typeof ADMISSION_CHARGE_KINDS)[number];

// `bundled` medicine is part of the exempt composite healthcare supply; `independent`
// medicine carries the product's own GST rate.
export const ADMISSION_ISSUE_SUPPLIES = ["bundled", "independent"] as const;

export type AdmissionIssueSupply = (typeof ADMISSION_ISSUE_SUPPLIES)[number];

// One ward issue from the pharmacy to an Admission. Price and tax live on the Charge
// each line creates (D027), never here.
export const admissionPharmacyIssues = pgTable(
  "admission_pharmacy_issues",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    admissionId: text("admission_id").notNull(),
    prescriberName: text("prescriber_name"),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("admission_pharmacy_issues_org_id_id_unique").on(table.orgId, table.id),
    unique("admission_pharmacy_issues_org_id_admission_unique").on(
      table.orgId,
      table.id,
      table.admissionId,
    ),
    foreignKey({
      columns: [table.orgId, table.admissionId],
      foreignColumns: [admissions.orgId, admissions.id],
    }),
    index("admission_pharmacy_issues_org_admission_created_idx").on(
      table.orgId,
      table.admissionId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const admissionPharmacyIssueLines = pgTable(
  "admission_pharmacy_issue_lines",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    issueId: text("issue_id").notNull(),
    admissionId: text("admission_id").notNull(),
    batchId: text("batch_id").notNull(),
    qty: integer("qty").notNull(),
    supply: text("supply", { enum: ADMISSION_ISSUE_SUPPLIES }).notNull(),
  },
  (table) => [
    check("admission_pharmacy_issue_lines_qty_check", sql`${table.qty} > 0`),
    index("admission_pharmacy_issue_lines_org_issue_idx").on(table.orgId, table.issueId),
    unique("admission_pharmacy_issue_lines_org_id_admission_batch_unique").on(
      table.orgId,
      table.id,
      table.admissionId,
      table.batchId,
    ),
    foreignKey({
      columns: [table.orgId, table.issueId, table.admissionId],
      foreignColumns: [
        admissionPharmacyIssues.orgId,
        admissionPharmacyIssues.id,
        admissionPharmacyIssues.admissionId,
      ],
    }),
    foreignKey({
      columns: [table.orgId, table.batchId],
      foreignColumns: [stockBatches.orgId, stockBatches.id],
    }),
  ],
);

// Stored states only. Expiry is derived from `holdUntil` at read, never stored, so a
// no-show frees the hold without a cleanup job.
export const BED_RESERVATION_STATUSES = [
  "requested",
  "confirmed",
  "converted",
  "cancelled",
  "disrupted",
] as const;

// A future bed booking. A request promises nothing; a confirmed hold promises one bed
// for a half-open window and is distinct from actual occupancy.
export const bedReservations = pgTable(
  "bed_reservations",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    patientId: text("patient_id").notNull(),
    categoryId: text("category_id").notNull(),
    bedId: text("bed_id"),
    plannedArrivalAt: timestamp("planned_arrival_at", { withTimezone: true }).notNull(),
    plannedDepartureAt: timestamp("planned_departure_at", { withTimezone: true }).notNull(),
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    status: text("status", { enum: BED_RESERVATION_STATUSES }).notNull(),
    revision: integer("revision").notNull().default(0),
    admissionId: text("admission_id"),
    cancelReason: text("cancel_reason"),
    disruptedReason: text("disrupted_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "bed_reservations_window_check",
      sql`${table.plannedDepartureAt} > ${table.plannedArrivalAt}`,
    ),
    check(
      "bed_reservations_hold_check",
      sql`${table.holdUntil} is null or (${table.holdUntil} > ${table.plannedArrivalAt} and ${table.holdUntil} <= ${table.plannedDepartureAt})`,
    ),
    check(
      "bed_reservations_held_check",
      sql`${table.status} not in ('confirmed', 'converted') or (${table.bedId} is not null and ${table.holdUntil} is not null)`,
    ),
    check(
      "bed_reservations_converted_check",
      sql`(${table.status} = 'converted') = (${table.admissionId} is not null)`,
    ),
    check(
      "bed_reservations_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
    check(
      "bed_reservations_disrupted_check",
      sql`${table.status} <> 'disrupted' or ${table.disruptedReason} is not null`,
    ),
    unique("bed_reservations_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.categoryId],
      foreignColumns: [bedCategories.orgId, bedCategories.id],
    }),
    foreignKey({
      columns: [table.orgId, table.bedId],
      foreignColumns: [beds.orgId, beds.id],
    }),
    // The Admission a hold became is the same Patient's.
    foreignKey({
      columns: [table.orgId, table.admissionId, table.patientId],
      foreignColumns: [admissions.orgId, admissions.id, admissions.patientId],
    }),
    index("bed_reservations_org_arrival_idx").on(table.orgId, table.plannedArrivalAt, table.id),
    index("bed_reservations_org_created_idx").on(table.orgId, table.createdAt, table.id),
    index("bed_reservations_org_bed_status_idx").on(table.orgId, table.bedId, table.status),
  ],
);
