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
	CONSTRAINT "bed_reservations_window_check" CHECK ("bed_reservations"."planned_departure_at" > "bed_reservations"."planned_arrival_at"),
	CONSTRAINT "bed_reservations_hold_check" CHECK ("bed_reservations"."hold_until" is null or ("bed_reservations"."hold_until" > "bed_reservations"."planned_arrival_at" and "bed_reservations"."hold_until" <= "bed_reservations"."planned_departure_at")),
	CONSTRAINT "bed_reservations_held_check" CHECK ("bed_reservations"."status" not in ('confirmed', 'converted') or ("bed_reservations"."bed_id" is not null and "bed_reservations"."hold_until" is not null)),
	CONSTRAINT "bed_reservations_converted_check" CHECK (("bed_reservations"."status" = 'converted') = ("bed_reservations"."admission_id" is not null)),
	CONSTRAINT "bed_reservations_cancelled_check" CHECK (("bed_reservations"."status" = 'cancelled') = ("bed_reservations"."cancel_reason" is not null)),
	CONSTRAINT "bed_reservations_disrupted_check" CHECK ("bed_reservations"."status" <> 'disrupted' or "bed_reservations"."disrupted_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_category_id_bed_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."bed_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_bed_id_beds_org_id_id_fk" FOREIGN KEY ("org_id","bed_id") REFERENCES "public"."beds"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bed_reservations_org_arrival_idx" ON "bed_reservations" USING btree ("org_id","planned_arrival_at","id");--> statement-breakpoint
CREATE INDEX "bed_reservations_org_bed_status_idx" ON "bed_reservations" USING btree ("org_id","bed_id","status");