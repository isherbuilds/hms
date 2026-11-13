ALTER TABLE "bed_reservations" DROP CONSTRAINT "bed_reservations_org_id_admission_id_admissions_org_id_id_fk";
--> statement-breakpoint
ALTER TABLE "bed_reservations" ADD CONSTRAINT "bed_reservations_org_id_admission_id_patient_id_admissions_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","admission_id","patient_id") REFERENCES "public"."admissions"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bed_reservations_org_created_idx" ON "bed_reservations" USING btree ("org_id","created_at","id");