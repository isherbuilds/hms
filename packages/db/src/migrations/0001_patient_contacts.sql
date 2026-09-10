ALTER TABLE "patients" ADD COLUMN "guardian_relation" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_phone" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "emergency_contact_relation" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "patient_guardian" text;