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
	CONSTRAINT "admissions_ready_check" CHECK ("admissions"."status" <> 'discharge_ready' or "admissions"."ready_at" is not null),
	CONSTRAINT "admissions_discharged_check" CHECK (("admissions"."status" = 'discharged') = ("admissions"."discharged_at" is not null)),
	CONSTRAINT "admissions_cancelled_check" CHECK (("admissions"."status" = 'cancelled') = ("admissions"."cancelled_at" is not null and "admissions"."cancel_reason" is not null)),
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
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_bed_id_beds_org_id_id_fk" FOREIGN KEY ("org_id","bed_id") REFERENCES "public"."beds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_org_id_tariff_id_bed_tariffs_org_id_id_fk" FOREIGN KEY ("org_id","tariff_id") REFERENCES "public"."bed_tariffs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_categories" ADD CONSTRAINT "bed_categories_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariffs" ADD CONSTRAINT "bed_tariffs_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_ward_id_wards_org_id_id_fk" FOREIGN KEY ("org_id","ward_id") REFERENCES "public"."wards"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_bed_stays_org_bed_open_uq" ON "admission_bed_stays" USING btree ("org_id","bed_id") WHERE "admission_bed_stays"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_bed_stays_org_admission_open_uq" ON "admission_bed_stays" USING btree ("org_id","admission_id") WHERE "admission_bed_stays"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "admission_bed_stays_org_bed_started_idx" ON "admission_bed_stays" USING btree ("org_id","bed_id","started_at");--> statement-breakpoint
CREATE INDEX "admission_bed_stays_org_admission_started_idx" ON "admission_bed_stays" USING btree ("org_id","admission_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_org_patient_active_uq" ON "admissions" USING btree ("org_id","patient_id") WHERE "admissions"."status" in ('admitted', 'discharge_ready');--> statement-breakpoint
CREATE INDEX "admissions_org_status_admitted_idx" ON "admissions" USING btree ("org_id","status","admitted_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bed_categories_org_name_uq" ON "bed_categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "bed_tariffs_org_category_effective_idx" ON "bed_tariffs" USING btree ("org_id","category_id","effective_from" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "beds_org_ward_label_uq" ON "beds" USING btree ("org_id","ward_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "wards_org_name_uq" ON "wards" USING btree ("org_id","name");