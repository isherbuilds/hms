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
ALTER TABLE "charges" DROP CONSTRAINT "charges_parent_check";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_catalog_item_source_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_parent_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_sign_check";--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_id" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_kind" text;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "admission_issue_line_id" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "ipd_invoice_prefix" text DEFAULT 'IP' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "admission_id" text;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_issue_id_admission_id_admission_pharmacy_issues_org_id_id_admission_id_fk" FOREIGN KEY ("org_id","issue_id","admission_id") REFERENCES "public"."admission_pharmacy_issues"("org_id","id","admission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issue_lines" ADD CONSTRAINT "admission_pharmacy_issue_lines_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_issues" ADD CONSTRAINT "admission_pharmacy_issues_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_pharmacy_issues_org_admission_created_idx" ON "admission_pharmacy_issues" USING btree ("org_id","admission_id","created_at","id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_admission_issue_line_id_admission_id_stock_batch_id_admission_pharmacy_issue_lines_org_id_id_admission_id_batch_id_fk" FOREIGN KEY ("org_id","admission_issue_line_id","admission_id","stock_batch_id") REFERENCES "public"."admission_pharmacy_issue_lines"("org_id","id","admission_id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_admission_id_patient_id_admissions_org_id_id_patient_id_fk" FOREIGN KEY ("org_id","admission_id","patient_id") REFERENCES "public"."admissions"("org_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_admission_idx" ON "charges" USING btree ("org_id","admission_id","status") WHERE "charges"."admission_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_org_admission_issue_line_idx" ON "charges" USING btree ("org_id","admission_issue_line_id") WHERE "charges"."admission_issue_line_id" is not null and "charges"."status" <> 'voided';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_admission_idx" ON "invoices" USING btree ("org_id","admission_id") WHERE "invoices"."admission_id" is not null;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_parent_check" CHECK (num_nonnulls("charges"."opd_appointment_id", "charges"."pharmacy_sale_id", "charges"."admission_id") = 1);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_catalog_item_source_check" CHECK (("charges"."source_type" = 'admission') = ("charges"."admission_id" is not null) and ("charges"."source_type" = 'admission') = ("charges"."admission_kind" is not null) and ("charges"."source_type" <> 'admission' or "charges"."source_id" is not distinct from "charges"."admission_id") and ("charges"."admission_issue_line_id" is not null) = coalesce("charges"."admission_kind" = 'pharmacy_issue', false) and ("charges"."stock_batch_id" is not null) = ("charges"."source_type" = 'pharmacy_batch' or coalesce("charges"."admission_kind" = 'pharmacy_issue', false)) and ("charges"."catalog_item_id" is null) = ("charges"."stock_batch_id" is not null) and ("charges"."source_type" <> 'pharmacy_batch' or ("charges"."pharmacy_sale_id" is not null and "charges"."source_id" is null)));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_check" CHECK (("invoices"."stream" = 'opd' and "invoices"."opd_appointment_id" is not null and "invoices"."patient_id" is not null and "invoices"."pharmacy_sale_id" is null and "invoices"."admission_id" is null) or ("invoices"."stream" = 'pharmacy' and "invoices"."pharmacy_sale_id" is not null and "invoices"."opd_appointment_id" is null and "invoices"."admission_id" is null) or ("invoices"."stream" = 'ipd' and "invoices"."admission_id" is not null and "invoices"."patient_id" is not null and "invoices"."opd_appointment_id" is null and "invoices"."pharmacy_sale_id" is null));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_check" CHECK (("stock_movements"."reason" in ('sale', 'writeoff', 'breakage', 'internal_issue', 'admission_issue') and "stock_movements"."qty" < 0) or ("stock_movements"."reason" in ('opening', 'receipt', 'return') and "stock_movements"."qty" > 0) or ("stock_movements"."reason" in ('release', 'quarantine', 'count_correction')));