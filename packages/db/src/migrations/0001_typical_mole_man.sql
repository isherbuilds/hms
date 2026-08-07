CREATE TABLE "charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"visit_id" text NOT NULL,
	"catalog_item_id" text,
	"description" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_id" text,
	"void_reason" text,
	"generated_by" text DEFAULT 'member' NOT NULL,
	"model_name" text,
	"model_version" text,
	"reviewed_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_qty_check" CHECK ("charges"."qty" > 0),
	CONSTRAINT "charges_source_type_check" CHECK ("charges"."source_type" in ('consult_fee', 'order', 'manual')),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" in ('pending', 'invoiced', 'voided')),
	CONSTRAINT "charges_generated_by_check" CHECK ("charges"."generated_by" in ('member', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"department_id" text NOT NULL,
	"visit_class" text DEFAULT 'opd' NOT NULL,
	"token_number" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"cancel_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_class_check" CHECK ("visits"."visit_class" in ('opd', 'ipd', 'er')),
	CONSTRAINT "visits_status_check" CHECK ("visits"."status" in ('waiting', 'in_consult', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "default_consult_fee_item_id" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "follow_up_validity_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "follow_up_fee_item_id" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "follow_up_validity_days" integer;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_visit_idx" ON "charges" USING btree ("org_id","visit_id","status");--> statement-breakpoint
CREATE INDEX "charges_org_status_idx" ON "charges" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "visits_org_created_idx" ON "visits" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "visits_org_practitioner_idx" ON "visits" USING btree ("org_id","practitioner_id","status");--> statement-breakpoint
CREATE INDEX "visits_org_patient_idx" ON "visits" USING btree ("org_id","patient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_default_consult_fee_item_id_catalog_items_id_fk" FOREIGN KEY ("default_consult_fee_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_follow_up_fee_item_id_catalog_items_id_fk" FOREIGN KEY ("follow_up_fee_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_follow_up_days_check" CHECK ("organization_settings"."follow_up_validity_days" between 1 and 365);--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_follow_up_days_check" CHECK ("practitioners"."follow_up_validity_days" is null or "practitioners"."follow_up_validity_days" between 1 and 365);