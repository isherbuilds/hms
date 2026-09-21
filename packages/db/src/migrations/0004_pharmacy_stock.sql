CREATE TABLE "goods_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opening" boolean DEFAULT false NOT NULL,
	"supplier_name" text,
	"supplier_reference" text,
	"received_on" date NOT NULL,
	"file_id" text,
	"note" text,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"catalog_item_id" text,
	"name" text NOT NULL,
	"generic_name" text,
	"form" text,
	"strength" text,
	"stock_unit" text NOT NULL,
	"units_per_pack" integer NOT NULL,
	"schedule" text DEFAULT 'none' NOT NULL,
	"manufacturer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "products_units_per_pack_check" CHECK ("products"."units_per_pack" >= 1)
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text NOT NULL,
	"batch_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"mrp" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "stock_batches_mrp_check" CHECK ("stock_batches"."mrp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"bucket" text NOT NULL,
	"qty" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"department_id" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "stock_movements_qty_check" CHECK ("stock_movements"."qty" <> 0),
	CONSTRAINT "stock_movements_sign_check" CHECK (("stock_movements"."reason" in ('sale', 'writeoff', 'breakage', 'internal_issue') and "stock_movements"."qty" < 0) or ("stock_movements"."reason" in ('opening', 'receipt', 'return') and "stock_movements"."qty" > 0) or ("stock_movements"."reason" in ('release', 'quarantine', 'count_correction')))
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text,
	"opd_appointment_id" text,
	"buyer_name" text NOT NULL,
	"buyer_phone" text,
	"for_name" text,
	"prescriber_name" text,
	"prescription_reference" text,
	"note" text,
	"sold_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_sales_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"pharmacy_sale_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_id" text,
	"reason_code" text NOT NULL,
	"note" text,
	"accepted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_returns_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_return_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"return_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"qty" integer NOT NULL,
	"gross" bigint NOT NULL,
	CONSTRAINT "pharmacy_return_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "pharmacy_return_lines_qty_check" CHECK ("pharmacy_return_lines"."qty" >= 0),
	CONSTRAINT "pharmacy_return_lines_gross_check" CHECK ("pharmacy_return_lines"."gross" >= 0),
	CONSTRAINT "pharmacy_return_lines_non_empty_check" CHECK ("pharmacy_return_lines"."qty" > 0 or "pharmacy_return_lines"."gross" > 0)
);
--> statement-breakpoint
ALTER TABLE "request_keys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "request_keys" CASCADE;--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_type_check";--> statement-breakpoint
ALTER TABLE "advance_receipts" DROP CONSTRAINT "advance_receipts_method_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_target_type_check";--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_category_check";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_source_type_check";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_status_check";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_revenue_category_check";--> statement-breakpoint
ALTER TABLE "patients" DROP CONSTRAINT "patients_sex_check";--> statement-breakpoint
ALTER TABLE "patients" DROP CONSTRAINT "patients_blood_group_check";--> statement-breakpoint
ALTER TABLE "payers" DROP CONSTRAINT "payers_type_check";--> statement-breakpoint
ALTER TABLE "opd_appointments" DROP CONSTRAINT "opd_appointments_arrival_mode_check";--> statement-breakpoint
ALTER TABLE "opd_appointments" DROP CONSTRAINT "opd_appointments_status_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_math_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_revenue_category_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_method_check";--> statement-breakpoint
ALTER TABLE "treatment_plans" DROP CONSTRAINT "treatment_plans_status_check";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" DROP CONSTRAINT "treatment_plan_items_status_check";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" DROP CONSTRAINT "treatment_plan_items_revenue_category_check";--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "opd_appointment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "opd_appointment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "patient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "patient_mrn" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "patient_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "pharmacy_sale_id" text;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "pharmacy_invoice_prefix" text DEFAULT 'PH' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stream" text DEFAULT 'opd' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pharmacy_sale_id" text;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_org_id_file_id_file_org_id_id_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."file"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_department_id_departments_org_id_id_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_sold_by_user_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_org_id_opd_appointment_id_opd_appointments_org_id_id_fk" FOREIGN KEY ("org_id","opd_appointment_id") REFERENCES "public"."opd_appointments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_org_id_pharmacy_sale_id_pharmacy_sales_org_id_id_fk" FOREIGN KEY ("org_id","pharmacy_sale_id") REFERENCES "public"."pharmacy_sales"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_returns" ADD CONSTRAINT "pharmacy_returns_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_return_lines" ADD CONSTRAINT "pharmacy_return_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_return_lines" ADD CONSTRAINT "pharmacy_return_lines_org_id_return_id_pharmacy_returns_org_id_id_fk" FOREIGN KEY ("org_id","return_id") REFERENCES "public"."pharmacy_returns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_return_lines" ADD CONSTRAINT "pharmacy_return_lines_org_id_invoice_line_id_invoice_lines_org_id_id_fk" FOREIGN KEY ("org_id","invoice_line_id") REFERENCES "public"."invoice_lines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_return_lines" ADD CONSTRAINT "pharmacy_return_lines_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipts_org_received_idx" ON "goods_receipts" USING btree ("org_id","received_on","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_org_file_idx" ON "goods_receipts" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_catalog_item_idx" ON "products" USING btree ("org_id","catalog_item_id") WHERE "products"."catalog_item_id" is not null;--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("org_id","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_org_product_batch_idx" ON "stock_batches" USING btree ("org_id","product_id","batch_number");--> statement-breakpoint
CREATE INDEX "stock_batches_org_expiry_idx" ON "stock_batches" USING btree ("org_id","expiry_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_source_idx" ON "stock_movements" USING btree ("org_id","source_type","source_id","batch_id","bucket");--> statement-breakpoint
CREATE INDEX "stock_movements_org_batch_bucket_idx" ON "stock_movements" USING btree ("org_id","batch_id","bucket");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_org_created_idx" ON "pharmacy_sales" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "pharmacy_returns_org_sale_idx" ON "pharmacy_returns" USING btree ("org_id","pharmacy_sale_id");--> statement-breakpoint
CREATE INDEX "pharmacy_return_lines_org_invoice_line_idx" ON "pharmacy_return_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "pharmacy_return_lines_org_return_idx" ON "pharmacy_return_lines" USING btree ("org_id","return_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_pharmacy_sale_id_pharmacy_sales_org_id_id_fk" FOREIGN KEY ("org_id","pharmacy_sale_id") REFERENCES "public"."pharmacy_sales"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_pharmacy_sale_id_pharmacy_sales_org_id_id_fk" FOREIGN KEY ("org_id","pharmacy_sale_id") REFERENCES "public"."pharmacy_sales"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_pharmacy_sale_idx" ON "charges" USING btree ("org_id","pharmacy_sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_pharmacy_sale_idx" ON "invoices" USING btree ("org_id","pharmacy_sale_id") WHERE "invoices"."pharmacy_sale_id" is not null;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_parent_check" CHECK (("charges"."opd_appointment_id" is not null and "charges"."pharmacy_sale_id" is null) or ("charges"."pharmacy_sale_id" is not null and "charges"."opd_appointment_id" is null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_check" CHECK (("invoices"."stream" = 'opd' and "invoices"."opd_appointment_id" is not null and "invoices"."patient_id" is not null and "invoices"."pharmacy_sale_id" is null) or ("invoices"."stream" = 'pharmacy' and "invoices"."pharmacy_sale_id" is not null and "invoices"."opd_appointment_id" is null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_math_check" CHECK ("invoices"."grand_total" = "invoices"."subtotal" - "invoices"."discount_amount" + (case "invoices"."stream" when 'opd' then "invoices"."tax_total" else 0 end));