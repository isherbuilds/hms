CREATE TABLE "advance_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"advance_receipt_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"allocated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_allocations_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "advance_allocations_amount_check" CHECK ("advance_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "advance_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"treatment_plan_id" text,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"note" text,
	"purpose" text NOT NULL,
	"receipt_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"org_legal_name" text NOT NULL,
	"org_address" text NOT NULL,
	"org_tax_id" text NOT NULL,
	"currency" text NOT NULL,
	"patient_name" text NOT NULL,
	"patient_mrn" text NOT NULL,
	"patient_phone" text NOT NULL,
	"patient_address" text,
	"patient_guardian" text,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_receipts_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "advance_receipts_method_check" CHECK ("advance_receipts"."method" in ('cash', 'upi', 'card', 'bank')),
	CONSTRAINT "advance_receipts_amount_check" CHECK ("advance_receipts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_keys" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_keys_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"next_sitting_on" date,
	"next_sitting_note" text,
	"close_reason" text,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "treatment_plans_status_check" CHECK ("treatment_plans"."status" in ('open', 'completed', 'closed')),
	CONSTRAINT "treatment_plans_close_reason_check" CHECK ("treatment_plans"."status" <> 'closed' or "treatment_plans"."close_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"treatment_plan_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"description" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"revenue_category" text NOT NULL,
	"qty_planned" integer NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"drop_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_items_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "treatment_plan_items_unit_price_check" CHECK ("treatment_plan_items"."unit_price" >= 0),
	CONSTRAINT "treatment_plan_items_tax_rate_check" CHECK ("treatment_plan_items"."tax_rate_percent" >= 0),
	CONSTRAINT "treatment_plan_items_qty_check" CHECK ("treatment_plan_items"."qty_planned" > 0),
	CONSTRAINT "treatment_plan_items_status_check" CHECK ("treatment_plan_items"."status" in ('open', 'dropped')),
	CONSTRAINT "treatment_plan_items_drop_reason_check" CHECK ("treatment_plan_items"."status" <> 'dropped' or "treatment_plan_items"."drop_reason" is not null),
	CONSTRAINT "treatment_plan_items_revenue_category_check" CHECK ("treatment_plan_items"."revenue_category" in ('consultation', 'procedure', 'lab', 'radiology', 'other'))
);
--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_source_type_check";--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "credit_note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "advance_receipt_prefix" text DEFAULT 'ADV' NOT NULL;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD COLUMN "treatment_plan_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "advance_receipt_id" text;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_allocated_by_user_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_advance_receipt_id_advance_receipts_org_id_id_fk" FOREIGN KEY ("org_id","advance_receipt_id") REFERENCES "public"."advance_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_keys" ADD CONSTRAINT "request_keys_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_allocations_org_invoice_idx" ON "advance_allocations" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "advance_allocations_org_receipt_idx" ON "advance_allocations" USING btree ("org_id","advance_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advance_receipts_org_number_idx" ON "advance_receipts" USING btree ("org_id","receipt_number");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_patient_created_idx" ON "advance_receipts" USING btree ("org_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_created_id_idx" ON "advance_receipts" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_business_date_idx" ON "advance_receipts" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_plan_idx" ON "advance_receipts" USING btree ("org_id","treatment_plan_id") WHERE "advance_receipts"."treatment_plan_id" is not null;--> statement-breakpoint
CREATE INDEX "treatment_plans_org_patient_status_idx" ON "treatment_plans" USING btree ("org_id","patient_id","status");--> statement-breakpoint
CREATE INDEX "treatment_plans_org_status_next_idx" ON "treatment_plans" USING btree ("org_id","status","next_sitting_on");--> statement-breakpoint
CREATE INDEX "treatment_plan_items_org_plan_idx" ON "treatment_plan_items" USING btree ("org_id","treatment_plan_id");--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_advance_receipt_id_advance_receipts_org_id_id_fk" FOREIGN KEY ("org_id","advance_receipt_id") REFERENCES "public"."advance_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_source_idx" ON "charges" USING btree ("org_id","source_id") WHERE "charges"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "opd_appointments_org_treatment_date_idx" ON "opd_appointments" USING btree ("org_id","treatment_plan_id","business_date") WHERE "opd_appointments"."treatment_plan_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_org_advance_receipt_idx" ON "refunds" USING btree ("org_id","advance_receipt_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_source_type_check" CHECK ("charges"."source_type" in ('consult_fee', 'catalog', 'treatment_plan'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_check" CHECK (num_nonnulls("refunds"."credit_note_id", "refunds"."advance_receipt_id") = 1);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_source_check" CHECK (("refunds"."invoice_id" is not null) = ("refunds"."credit_note_id" is not null));