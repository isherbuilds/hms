CREATE TABLE "admission_bed_stays" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"bed_id" text NOT NULL,
	"tariff_id" text NOT NULL,
	"daily_price" bigint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_bed_stays_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "admission_bed_stays_interval_check" CHECK ("admission_bed_stays"."ended_at" is null or "admission_bed_stays"."ended_at" >= "admission_bed_stays"."started_at"),
	CONSTRAINT "admission_bed_stays_daily_price_check" CHECK ("admission_bed_stays"."daily_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "admission_pharmacy_issue_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"qty" integer NOT NULL,
	"supply" text NOT NULL,
	CONSTRAINT "admission_pharmacy_issue_lines_org_id_admission_batch_unique" UNIQUE("org_id","id","admission_id","batch_id"),
	CONSTRAINT "admission_pharmacy_issue_lines_qty_check" CHECK ("admission_pharmacy_issue_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "admission_pharmacy_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"prescriber_name" text,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_pharmacy_issues_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "admission_pharmacy_issues_org_id_admission_unique" UNIQUE("org_id","id","admission_id")
);
--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"status" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	"discharged_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"time_zone" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"charge_revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "admissions_org_id_patient_unique" UNIQUE("org_id","id","patient_id"),
	CONSTRAINT "admissions_ready_check" CHECK ("admissions"."status" <> 'discharge_ready' or "admissions"."ready_at" is not null),
	CONSTRAINT "admissions_discharged_check" CHECK (("admissions"."status" = 'discharged') = ("admissions"."discharged_at" is not null)),
	CONSTRAINT "admissions_cancelled_check" CHECK (("admissions"."status" = 'cancelled') = ("admissions"."cancelled_at" is not null) and ("admissions"."status" = 'cancelled') = ("admissions"."cancel_reason" is not null)),
	CONSTRAINT "admissions_timeline_check" CHECK (("admissions"."ready_at" is null or "admissions"."ready_at" >= "admissions"."admitted_at") and ("admissions"."discharged_at" is null or "admissions"."discharged_at" >= coalesce("admissions"."ready_at", "admissions"."admitted_at")))
);
--> statement-breakpoint
CREATE TABLE "bed_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_categories_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "bed_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"category_id" text NOT NULL,
	"bed_id" text,
	"planned_arrival_at" timestamp with time zone NOT NULL,
	"planned_departure_at" timestamp with time zone NOT NULL,
	"hold_until" timestamp with time zone,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"admission_id" text,
	"cancel_reason" text,
	"disrupted_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_reservations_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "bed_reservations_org_id_patient_unique" UNIQUE("org_id","id","patient_id"),
	CONSTRAINT "bed_reservations_window_check" CHECK ("bed_reservations"."planned_departure_at" > "bed_reservations"."planned_arrival_at"),
	CONSTRAINT "bed_reservations_hold_check" CHECK ("bed_reservations"."hold_until" is null or ("bed_reservations"."hold_until" > "bed_reservations"."planned_arrival_at" and "bed_reservations"."hold_until" <= "bed_reservations"."planned_departure_at")),
	CONSTRAINT "bed_reservations_held_check" CHECK ("bed_reservations"."status" not in ('confirmed', 'converted') or ("bed_reservations"."bed_id" is not null and "bed_reservations"."hold_until" is not null)),
	CONSTRAINT "bed_reservations_converted_check" CHECK (("bed_reservations"."status" = 'converted') = ("bed_reservations"."admission_id" is not null)),
	CONSTRAINT "bed_reservations_cancelled_check" CHECK (("bed_reservations"."status" = 'cancelled') = ("bed_reservations"."cancel_reason" is not null)),
	CONSTRAINT "bed_reservations_disrupted_check" CHECK ("bed_reservations"."status" <> 'disrupted' or "bed_reservations"."disrupted_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "bed_tariffs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"daily_price" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_tariffs_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "bed_tariffs_daily_price_check" CHECK ("bed_tariffs"."daily_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "beds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ward_id" text NOT NULL,
	"category_id" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beds_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "beds_blocked_reason_check" CHECK (("beds"."blocked_at" is null) = ("beds"."blocked_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wards_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "equipment_units" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_units_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "resource_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"room_id" text,
	"equipment_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "resource_blocks_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "resource_blocks_target_check" CHECK (("resource_blocks"."room_id" is null) <> ("resource_blocks"."equipment_id" is null)),
	CONSTRAINT "resource_blocks_interval_check" CHECK ("resource_blocks"."ends_at" > "resource_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "surgical_case_equipment" (
	"org_id" text NOT NULL,
	"case_id" text NOT NULL,
	"equipment_id" text NOT NULL,
	CONSTRAINT "surgical_case_equipment_org_id_case_id_equipment_id_pk" PRIMARY KEY("org_id","case_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "surgical_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"procedure_item_id" text NOT NULL,
	"procedure_name" text NOT NULL,
	"room_id" text,
	"planned_start_at" timestamp with time zone NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"prep_minutes" integer DEFAULT 0 NOT NULL,
	"cleanup_minutes" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"admission_id" text,
	"bed_reservation_id" text,
	"cancel_reason" text,
	"disrupted_reason" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surgical_cases_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "surgical_cases_interval_check" CHECK ("surgical_cases"."planned_end_at" > "surgical_cases"."planned_start_at"),
	CONSTRAINT "surgical_cases_duration_check" CHECK ("surgical_cases"."planned_end_at" - "surgical_cases"."planned_start_at" <= interval '24 hours'),
	CONSTRAINT "surgical_cases_buffers_check" CHECK ("surgical_cases"."prep_minutes" between 0 and 240 and "surgical_cases"."cleanup_minutes" between 0 and 240),
	CONSTRAINT "surgical_cases_confirmed_room_check" CHECK ("surgical_cases"."status" <> 'confirmed' or "surgical_cases"."room_id" is not null),
	CONSTRAINT "surgical_cases_cancelled_check" CHECK (("surgical_cases"."status" = 'cancelled') = ("surgical_cases"."cancel_reason" is not null)),
	CONSTRAINT "surgical_cases_disrupted_check" CHECK ("surgical_cases"."status" <> 'disrupted' or "surgical_cases"."disrupted_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "theatre_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theatre_rooms_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_parent_check";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_catalog_item_source_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_math_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_parent_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_sign_check";--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_id" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_kind" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_issue_line_id" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "price_basis" text GENERATED ALWAYS AS (case when stock_batch_id is null then 'exclusive' else 'inclusive' end) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "ipd_invoice_prefix" text DEFAULT 'IPD' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "admission_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "added_tax_total" bigint GENERATED ALWAYS AS (grand_total - subtotal + discount_amount - round_off) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_bed_id_beds_org_id_id_fk" FOREIGN KEY ("org_id","bed_id") REFERENCES "public"."beds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_tariff_id_bed_tariffs_org_id_id_fk" FOREIGN KEY ("org_id","tariff_id") REFERENCES "public"."bed_tariffs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_issue_id_admission_id_admission_pharmacy_issues_org_id_id_admission_id_fk" FOREIGN KEY ("org_id","issue_id","admission_id") REFERENCES "public"."admission_pharmacy_issues"("org_id","id","admission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_categories" ADD CONSTRAINT "bed_categories_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_bed_id_beds_org_id_id_fk" FOREIGN KEY ("org_id","bed_id") REFERENCES "public"."beds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_admission_id_patient_id_admissions_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","admission_id","patient_id") REFERENCES "public"."admissions"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_ward_id_wards_org_id_id_fk" FOREIGN KEY ("org_id","ward_id") REFERENCES "public"."wards"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_units" ADD CONSTRAINT "equipment_units_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_org_id_room_id_theatre_rooms_org_id_id_fk" FOREIGN KEY ("org_id","room_id") REFERENCES "public"."theatre_rooms"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_org_id_equipment_id_equipment_units_org_id_id_fk" FOREIGN KEY ("org_id","equipment_id") REFERENCES "public"."equipment_units"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_case_equipment" ADD CONSTRAINT "surgical_case_equipment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_case_equipment" ADD CONSTRAINT "surgical_case_equipment_org_id_case_id_surgical_cases_org_id_id_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "public"."surgical_cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_case_equipment" ADD CONSTRAINT "surgical_case_equipment_org_id_equipment_id_equipment_units_org_id_id_fk" FOREIGN KEY ("org_id","equipment_id") REFERENCES "public"."equipment_units"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_procedure_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","procedure_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_room_id_theatre_rooms_org_id_id_fk" FOREIGN KEY ("org_id","room_id") REFERENCES "public"."theatre_rooms"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_admission_id_patient_id_admissions_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","admission_id","patient_id") REFERENCES "public"."admissions"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_bed_reservation_id_patient_id_bed_reservations_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","bed_reservation_id","patient_id") REFERENCES "public"."bed_reservations"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theatre_rooms" ADD CONSTRAINT "theatre_rooms_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_bed_stays_org_bed_open_uq" ON "admission_bed_stays" USING btree ("org_id","bed_id") WHERE "admission_bed_stays"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_bed_stays_org_admission_open_uq" ON "admission_bed_stays" USING btree ("org_id","admission_id") WHERE "admission_bed_stays"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "admission_bed_stays_org_bed_started_idx" ON "admission_bed_stays" USING btree ("org_id","bed_id","started_at");--> statement-breakpoint
CREATE INDEX "admission_bed_stays_org_admission_started_idx" ON "admission_bed_stays" USING btree ("org_id","admission_id","started_at");--> statement-breakpoint
CREATE INDEX "admission_pharmacy_issue_lines_org_issue_idx" ON "admission_pharmacy_issue_lines" USING btree ("org_id","issue_id");--> statement-breakpoint
CREATE INDEX "admission_pharmacy_issues_org_admission_created_idx" ON "admission_pharmacy_issues" USING btree ("org_id","admission_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_org_patient_active_uq" ON "admissions" USING btree ("org_id","patient_id") WHERE "admissions"."status" in ('admitted', 'discharge_ready');--> statement-breakpoint
CREATE INDEX "admissions_org_status_admitted_idx" ON "admissions" USING btree ("org_id","status","admitted_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bed_categories_org_name_uq" ON "bed_categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "bed_reservations_org_arrival_idx" ON "bed_reservations" USING btree ("org_id","planned_arrival_at","id");--> statement-breakpoint
CREATE INDEX "bed_reservations_org_created_idx" ON "bed_reservations" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "bed_reservations_org_bed_status_idx" ON "bed_reservations" USING btree ("org_id","bed_id","status");--> statement-breakpoint
CREATE INDEX "bed_tariffs_org_category_effective_idx" ON "bed_tariffs" USING btree ("org_id","category_id","effective_from" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bed_tariffs_org_category_effective_uq" ON "bed_tariffs" USING btree ("org_id","category_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "beds_org_ward_label_uq" ON "beds" USING btree ("org_id","ward_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "wards_org_name_uq" ON "wards" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_units_org_name_uq" ON "equipment_units" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "resource_blocks_org_room_starts_idx" ON "resource_blocks" USING btree ("org_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "resource_blocks_org_equipment_starts_idx" ON "resource_blocks" USING btree ("org_id","equipment_id","starts_at");--> statement-breakpoint
CREATE INDEX "resource_blocks_org_ends_idx" ON "resource_blocks" USING btree ("org_id","ends_at");--> statement-breakpoint
CREATE INDEX "surgical_case_equipment_org_equipment_idx" ON "surgical_case_equipment" USING btree ("org_id","equipment_id");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_start_idx" ON "surgical_cases" USING btree ("org_id","planned_start_at","id");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_room_status_idx" ON "surgical_cases" USING btree ("org_id","room_id","status");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_practitioner_status_idx" ON "surgical_cases" USING btree ("org_id","practitioner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "theatre_rooms_org_name_uq" ON "theatre_rooms" USING btree ("org_id",lower("name"));--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_admission_issue_line_id_admission_id_stock_batch_id_admission_pharmacy_issue_lines_org_id_id_admission_id_batch_id_fk" FOREIGN KEY ("org_id","admission_issue_line_id","admission_id","stock_batch_id") REFERENCES "public"."admission_pharmacy_issue_lines"("org_id","id","admission_id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_admission_id_patient_id_admissions_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","admission_id","patient_id") REFERENCES "public"."admissions"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_admission_idx" ON "charges" USING btree ("org_id","admission_id","status") WHERE "charges"."admission_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_org_admission_issue_line_idx" ON "charges" USING btree ("org_id","admission_issue_line_id") WHERE "charges"."admission_issue_line_id" is not null and "charges"."status" <> 'voided';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_admission_idx" ON "invoices" USING btree ("org_id","admission_id") WHERE "invoices"."admission_id" is not null;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_parent_check" CHECK (num_nonnulls("charges"."opd_appointment_id", "charges"."pharmacy_sale_id", "charges"."admission_id") = 1);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_catalog_item_source_check" CHECK (("charges"."source_type" = 'admission') = ("charges"."admission_id" is not null) and ("charges"."source_type" = 'admission') = ("charges"."admission_kind" is not null) and ("charges"."source_type" <> 'admission' or "charges"."source_id" is not distinct from "charges"."admission_id") and ("charges"."admission_issue_line_id" is not null) = coalesce("charges"."admission_kind" = 'pharmacy_issue', false) and ("charges"."stock_batch_id" is not null) = ("charges"."source_type" = 'pharmacy_batch' or coalesce("charges"."admission_kind" = 'pharmacy_issue', false)) and ("charges"."catalog_item_id" is null) = ("charges"."stock_batch_id" is not null) and ("charges"."source_type" <> 'pharmacy_batch' or ("charges"."pharmacy_sale_id" is not null and "charges"."source_id" is null)));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_added_tax_total_check" CHECK ("invoices"."added_tax_total" >= 0 and "invoices"."added_tax_total" <= "invoices"."tax_total");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_check" CHECK (("invoices"."stream" = 'opd' and "invoices"."opd_appointment_id" is not null and "invoices"."patient_id" is not null and "invoices"."pharmacy_sale_id" is null and "invoices"."admission_id" is null) or ("invoices"."stream" = 'pharmacy' and "invoices"."pharmacy_sale_id" is not null and "invoices"."opd_appointment_id" is null and "invoices"."admission_id" is null) or ("invoices"."stream" = 'ipd' and "invoices"."admission_id" is not null and "invoices"."patient_id" is not null and "invoices"."opd_appointment_id" is null and "invoices"."pharmacy_sale_id" is null));--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_basis_math_check" CHECK ("invoice_lines"."gross" = "invoice_lines"."taxable_value" + "invoice_lines"."tax_amount" and "invoice_lines"."line_subtotal" - "invoice_lines"."allocated_discount" in ("invoice_lines"."gross", "invoice_lines"."taxable_value"));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_check" CHECK (("stock_movements"."reason" in ('sale', 'writeoff', 'breakage', 'internal_issue', 'admission_issue') and "stock_movements"."qty" < 0) or ("stock_movements"."reason" in ('opening', 'receipt', 'return') and "stock_movements"."qty" > 0) or ("stock_movements"."reason" in ('release', 'quarantine', 'count_correction')));