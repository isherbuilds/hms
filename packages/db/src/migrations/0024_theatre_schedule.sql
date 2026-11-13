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
ALTER TABLE "surgical_cases" ADD CONSTRAINT "surgical_cases_org_id_bed_reservation_id_bed_reservations_org_id_id_fk" FOREIGN KEY ("org_id","bed_reservation_id") REFERENCES "public"."bed_reservations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theatre_rooms" ADD CONSTRAINT "theatre_rooms_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_units_org_name_uq" ON "equipment_units" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "resource_blocks_org_room_starts_idx" ON "resource_blocks" USING btree ("org_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "resource_blocks_org_equipment_starts_idx" ON "resource_blocks" USING btree ("org_id","equipment_id","starts_at");--> statement-breakpoint
CREATE INDEX "resource_blocks_org_ends_idx" ON "resource_blocks" USING btree ("org_id","ends_at");--> statement-breakpoint
CREATE INDEX "surgical_case_equipment_org_equipment_idx" ON "surgical_case_equipment" USING btree ("org_id","equipment_id");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_start_idx" ON "surgical_cases" USING btree ("org_id","planned_start_at","id");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_room_status_idx" ON "surgical_cases" USING btree ("org_id","room_id","status");--> statement-breakpoint
CREATE INDEX "surgical_cases_org_practitioner_status_idx" ON "surgical_cases" USING btree ("org_id","practitioner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "theatre_rooms_org_name_uq" ON "theatre_rooms" USING btree ("org_id",lower("name"));