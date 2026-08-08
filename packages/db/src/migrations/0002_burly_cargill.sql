CREATE TABLE "credit_note_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"taxable_value" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) NOT NULL,
	"gross" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"reason" text NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"visit_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_reason" text,
	"subtotal" numeric(12, 2) NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"grand_total" numeric(12, 2) NOT NULL,
	"org_legal_name" text NOT NULL,
	"org_address" text NOT NULL,
	"org_tax_id" text NOT NULL,
	"currency" text NOT NULL,
	"patient_name" text NOT NULL,
	"patient_mrn" text NOT NULL,
	"patient_phone" text NOT NULL,
	"patient_address" text,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_discount_amount_check" CHECK ("invoices"."discount_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(12, 2) NOT NULL,
	"allocated_discount" numeric(12, 2) NOT NULL,
	"taxable_value" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reference" text,
	"receipt_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('cash', 'upi', 'card')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reference" text,
	"refund_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"refunded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_method_check" CHECK ("refunds"."method" in ('cash', 'upi', 'card')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_credit_note_idx" ON "credit_note_lines" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_invoice_line_idx" ON "credit_note_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_idx" ON "credit_notes" USING btree ("org_id","credit_note_number");--> statement-breakpoint
CREATE INDEX "credit_notes_org_invoice_idx" ON "credit_notes" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("org_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_org_visit_idx" ON "invoices" USING btree ("org_id","visit_id");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_charge_idx" ON "invoice_lines" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_invoice_idx" ON "invoice_lines" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_receipt_number_idx" ON "payments" USING btree ("org_id","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_org_created_idx" ON "payments" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_org_number_idx" ON "refunds" USING btree ("org_id","refund_number");--> statement-breakpoint
CREATE INDEX "refunds_org_invoice_idx" ON "refunds" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "refunds_org_credit_note_idx" ON "refunds" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "refunds_org_created_idx" ON "refunds" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;