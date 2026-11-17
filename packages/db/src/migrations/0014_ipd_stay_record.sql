DROP INDEX "admission_bed_stays_org_bed_open_uq";--> statement-breakpoint
DROP INDEX "admission_bed_stays_org_admission_open_uq";--> statement-breakpoint
DROP INDEX "invoices_org_admission_idx";--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "admission_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "attendant_name" text;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "attendant_phone" text;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "medico_legal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "medico_legal_ref" text;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "discharge_type" text;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_org_number_uq" ON "admissions" USING btree ("org_id","admission_number");--> statement-breakpoint
CREATE INDEX "invoices_org_admission_idx" ON "invoices" USING btree ("org_id","admission_id") WHERE "invoices"."admission_id" is not null;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_discharge_type_check" CHECK (("admissions"."status" = 'discharged') = ("admissions"."discharge_type" is not null));--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_medico_legal_ref_check" CHECK ("admissions"."medico_legal" or "admissions"."medico_legal_ref" is null);