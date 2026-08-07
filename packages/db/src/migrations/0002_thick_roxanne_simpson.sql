CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mrn" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"sex" text NOT NULL,
	"date_of_birth" date,
	"age_years" integer,
	"address" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_age_or_dob_check" CHECK ("patients"."date_of_birth" is not null or "patients"."age_years" is not null),
	CONSTRAINT "patients_sex_check" CHECK ("patients"."sex" in ('male', 'female', 'other')),
	CONSTRAINT "patients_age_range_check" CHECK ("patients"."age_years" is null or "patients"."age_years" between 0 and 150)
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_mrn_idx" ON "patients" USING btree ("org_id","mrn");--> statement-breakpoint
CREATE INDEX "patients_org_phone_idx" ON "patients" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "patients_org_created_idx" ON "patients" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);