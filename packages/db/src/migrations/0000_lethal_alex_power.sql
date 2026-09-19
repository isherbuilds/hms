CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
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
	CONSTRAINT "advance_receipts_amount_check" CHECK ("advance_receipts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action" text NOT NULL,
	"denied" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"org_id" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"custom_rate" boolean DEFAULT false NOT NULL,
	"tax_rate_percent" numeric(4, 2) DEFAULT '0' NOT NULL,
	"tax_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "catalog_items_unit_price_check" CHECK ("catalog_items"."unit_price" >= 0),
	CONSTRAINT "catalog_items_tax_rate_check" CHECK ("catalog_items"."tax_rate_percent" >= 0 and "catalog_items"."tax_rate_percent" <= 99.99)
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opd_appointment_id" text,
	"pharmacy_sale_id" text,
	"catalog_item_id" text NOT NULL,
	"description" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"revenue_category" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_id" text,
	"void_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "charges_qty_check" CHECK ("charges"."qty" > 0),
	CONSTRAINT "charges_unit_price_check" CHECK ("charges"."unit_price" >= 0),
	CONSTRAINT "charges_tax_rate_percent_check" CHECK ("charges"."tax_rate_percent" >= 0),
	CONSTRAINT "charges_parent_check" CHECK (("charges"."opd_appointment_id" is not null and "charges"."pharmacy_sale_id" is null) or ("charges"."pharmacy_sale_id" is not null and "charges"."opd_appointment_id" is null))
);
--> statement-breakpoint
CREATE TABLE "counter" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "counter_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"taxable_value" bigint NOT NULL,
	"tax_amount" bigint NOT NULL,
	"gross" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"tax_total" bigint NOT NULL,
	"total" bigint NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"default_consult_fee_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
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
CREATE TABLE "organization_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"address" text NOT NULL,
	"tax_id" text NOT NULL,
	"currency" text NOT NULL,
	"mrn_prefix" text NOT NULL,
	"invoice_prefix" text NOT NULL,
	"pharmacy_invoice_prefix" text DEFAULT 'PH' NOT NULL,
	"receipt_prefix" text NOT NULL,
	"advance_receipt_prefix" text DEFAULT 'ADV' NOT NULL,
	"credit_note_prefix" text NOT NULL,
	"fiscal_year_start_month" integer NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"follow_up_validity_days" integer DEFAULT 14 NOT NULL,
	"unbilled_alert_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_fiscal_month_check" CHECK ("organization_settings"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "organization_settings_follow_up_days_check" CHECK ("organization_settings"."follow_up_validity_days" between 1 and 365),
	CONSTRAINT "organization_settings_unbilled_alert_hours_check" CHECK ("organization_settings"."unbilled_alert_hours" between 1 and 168)
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mrn" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"sex" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"dob_estimated" boolean DEFAULT false NOT NULL,
	"address" text NOT NULL,
	"email" text,
	"blood_group" text,
	"allergies" text,
	"medical_history" text,
	"uid" text,
	"guardian_relation" text,
	"guardian_name" text,
	"guardian_phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payers_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "patient_payers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"policy_number" text,
	"employee_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"department_id" text NOT NULL,
	"registration_number" text,
	"member_user_id" text,
	"consult_fee_item_id" text,
	"follow_up_fee_item_id" text,
	"follow_up_validity_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practitioners_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "practitioners_follow_up_days_check" CHECK ("practitioners"."follow_up_validity_days" is null or "practitioners"."follow_up_validity_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "opd_appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text,
	"treatment_plan_id" text,
	"caller_name" text,
	"caller_phone" text,
	"practitioner_id" text NOT NULL,
	"department_id" text NOT NULL,
	"arrival_mode" text NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"scheduled_for" timestamp with time zone,
	"token_number" integer,
	"arrived_at" timestamp with time zone,
	"day_order_at" timestamp with time zone GENERATED ALWAYS AS (coalesce("opd_appointments"."arrived_at", "opd_appointments"."scheduled_for")) STORED,
	"cancelled_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"cancel_reason" text,
	"charge_revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opd_appointments_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "opd_appointments_token_positive_check" CHECK ("opd_appointments"."token_number" is null or "opd_appointments"."token_number" > 0),
	CONSTRAINT "opd_appointments_identity_check" CHECK ("opd_appointments"."patient_id" is not null or ("opd_appointments"."caller_name" is not null and "opd_appointments"."caller_phone" is not null)),
	CONSTRAINT "opd_appointments_scheduled_check" CHECK ("opd_appointments"."arrival_mode" <> 'scheduled' or "opd_appointments"."scheduled_for" is not null),
	CONSTRAINT "opd_appointments_arrived_check" CHECK ("opd_appointments"."status" <> 'checked_in' or ("opd_appointments"."patient_id" is not null and "opd_appointments"."token_number" is not null and "opd_appointments"."arrived_at" is not null)),
	CONSTRAINT "opd_appointments_booked_check" CHECK ("opd_appointments"."status" <> 'booked' or ("opd_appointments"."arrival_mode" = 'scheduled' and "opd_appointments"."token_number" is null and "opd_appointments"."arrived_at" is null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"stream" text DEFAULT 'opd' NOT NULL,
	"opd_appointment_id" text,
	"pharmacy_sale_id" text,
	"patient_id" text,
	"invoice_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"subtotal" bigint NOT NULL,
	"tax_total" bigint NOT NULL,
	"grand_total" bigint NOT NULL,
	"org_legal_name" text NOT NULL,
	"org_address" text NOT NULL,
	"org_tax_id" text NOT NULL,
	"currency" text NOT NULL,
	"patient_name" text NOT NULL,
	"patient_mrn" text,
	"patient_phone" text,
	"patient_address" text,
	"patient_guardian" text,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "invoices_discount_amount_check" CHECK ("invoices"."discount_amount" >= 0),
	CONSTRAINT "invoices_subtotal_check" CHECK ("invoices"."subtotal" >= 0),
	CONSTRAINT "invoices_tax_total_check" CHECK ("invoices"."tax_total" >= 0),
	CONSTRAINT "invoices_grand_total_check" CHECK ("invoices"."grand_total" >= 0),
	CONSTRAINT "invoices_discount_not_above_subtotal_check" CHECK ("invoices"."discount_amount" <= "invoices"."subtotal"),
	CONSTRAINT "invoices_parent_check" CHECK (("invoices"."stream" = 'opd' and "invoices"."opd_appointment_id" is not null and "invoices"."patient_id" is not null and "invoices"."pharmacy_sale_id" is null) or ("invoices"."stream" = 'pharmacy' and "invoices"."pharmacy_sale_id" is not null and "invoices"."opd_appointment_id" is null)),
	CONSTRAINT "invoices_total_math_check" CHECK ("invoices"."grand_total" = "invoices"."subtotal" - "invoices"."discount_amount" + (case "invoices"."stream" when 'opd' then "invoices"."tax_total" else 0 end))
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_subtotal" bigint NOT NULL,
	"allocated_discount" bigint NOT NULL,
	"taxable_value" bigint NOT NULL,
	"tax_amount" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"revenue_category" text NOT NULL,
	CONSTRAINT "invoice_lines_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"receipt_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text,
	"credit_note_id" text,
	"advance_receipt_id" text,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"refund_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"refunded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_source_check" CHECK (num_nonnulls("refunds"."credit_note_id", "refunds"."advance_receipt_id") = 1),
	CONSTRAINT "refunds_invoice_source_check" CHECK (("refunds"."invoice_id" is not null) = ("refunds"."credit_note_id" is not null))
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
	CONSTRAINT "treatment_plan_items_drop_reason_check" CHECK ("treatment_plan_items"."status" <> 'dropped' or "treatment_plan_items"."drop_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"narration" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "journal_lines_debit_check" CHECK ("journal_lines"."debit" >= 0),
	CONSTRAINT "journal_lines_credit_check" CHECK ("journal_lines"."credit" >= 0),
	CONSTRAINT "journal_lines_one_side_check" CHECK (("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
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
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_allocated_by_user_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_advance_receipt_id_advance_receipts_org_id_id_fk" FOREIGN KEY ("org_id","advance_receipt_id") REFERENCES "public"."advance_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_allocations" ADD CONSTRAINT "advance_allocations_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_file_id_file_org_id_id_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."file"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_opd_appointment_id_opd_appointments_org_id_id_fk" FOREIGN KEY ("org_id","opd_appointment_id") REFERENCES "public"."opd_appointments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_pharmacy_sale_id_pharmacy_sales_org_id_id_fk" FOREIGN KEY ("org_id","pharmacy_sale_id") REFERENCES "public"."pharmacy_sales"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter" ADD CONSTRAINT "counter_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_invoice_line_id_invoice_lines_org_id_id_fk" FOREIGN KEY ("org_id","invoice_line_id") REFERENCES "public"."invoice_lines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_default_consult_fee_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","default_consult_fee_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_org_id_file_id_file_org_id_id_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."file"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payers" ADD CONSTRAINT "payers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payers" ADD CONSTRAINT "patient_payers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payers" ADD CONSTRAINT "patient_payers_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payers" ADD CONSTRAINT "patient_payers_org_id_payer_id_payers_org_id_id_fk" FOREIGN KEY ("org_id","payer_id") REFERENCES "public"."payers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_member_user_id_user_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_department_id_departments_org_id_id_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_consult_fee_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","consult_fee_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_follow_up_fee_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","follow_up_fee_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_department_id_departments_org_id_id_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_opd_appointment_id_opd_appointments_org_id_id_fk" FOREIGN KEY ("org_id","opd_appointment_id") REFERENCES "public"."opd_appointments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_pharmacy_sale_id_pharmacy_sales_org_id_id_fk" FOREIGN KEY ("org_id","pharmacy_sale_id") REFERENCES "public"."pharmacy_sales"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_charge_id_charges_org_id_id_fk" FOREIGN KEY ("org_id","charge_id") REFERENCES "public"."charges"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_advance_receipt_id_advance_receipts_org_id_id_fk" FOREIGN KEY ("org_id","advance_receipt_id") REFERENCES "public"."advance_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_patient_id_patients_org_id_id_fk" FOREIGN KEY ("org_id","patient_id") REFERENCES "public"."patients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_treatment_plan_id_treatment_plans_org_id_id_fk" FOREIGN KEY ("org_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "accounts_org_code_idx" ON "accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_system_key_idx" ON "accounts" USING btree ("org_id","system_key") WHERE "accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "advance_allocations_org_invoice_idx" ON "advance_allocations" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "advance_allocations_org_receipt_idx" ON "advance_allocations" USING btree ("org_id","advance_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advance_receipts_org_number_idx" ON "advance_receipts" USING btree ("org_id","receipt_number");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_patient_created_idx" ON "advance_receipts" USING btree ("org_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_created_id_idx" ON "advance_receipts" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_business_date_idx" ON "advance_receipts" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "advance_receipts_org_plan_idx" ON "advance_receipts" USING btree ("org_id","treatment_plan_id") WHERE "advance_receipts"."treatment_plan_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_org_target_file_uq" ON "attachments" USING btree ("org_id","target_type","target_id","file_id");--> statement-breakpoint
CREATE INDEX "attachments_org_target_idx" ON "attachments" USING btree ("org_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_file_idx" ON "attachments" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_id_idx" ON "audit_log" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_accountId_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_org_code_idx" ON "catalog_items" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "catalog_items_org_category_name_idx" ON "catalog_items" USING btree ("org_id","category","name");--> statement-breakpoint
CREATE INDEX "catalog_items_org_name_idx" ON "catalog_items" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "charges_org_opd_appointment_idx" ON "charges" USING btree ("org_id","opd_appointment_id","status");--> statement-breakpoint
CREATE INDEX "charges_org_pharmacy_sale_idx" ON "charges" USING btree ("org_id","pharmacy_sale_id");--> statement-breakpoint
CREATE INDEX "charges_org_source_idx" ON "charges" USING btree ("org_id","source_id") WHERE "charges"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "charges_org_status_created_idx" ON "charges" USING btree ("org_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_credit_note_idx" ON "credit_note_lines" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_invoice_line_idx" ON "credit_note_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_idx" ON "credit_notes" USING btree ("org_id","credit_note_number");--> statement-breakpoint
CREATE INDEX "credit_notes_org_invoice_idx" ON "credit_notes" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_business_date_idx" ON "credit_notes" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_idx" ON "departments" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "file_org_created_idx" ON "file" USING btree ("org_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "goods_receipts_org_received_idx" ON "goods_receipts" USING btree ("org_id","received_on","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_org_file_idx" ON "goods_receipts" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_mrn_idx" ON "patients" USING btree ("org_id","mrn");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_uid_idx" ON "patients" USING btree ("org_id","uid") WHERE "patients"."uid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payers_org_name_idx" ON "payers" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_payers_org_patient_idx" ON "patient_payers" USING btree ("org_id","patient_id");--> statement-breakpoint
CREATE INDEX "practitioners_org_name_idx" ON "practitioners" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "opd_appointments_org_practitioner_date_token_uq" ON "opd_appointments" USING btree ("org_id","practitioner_id","business_date","token_number") WHERE "opd_appointments"."token_number" is not null;--> statement-breakpoint
CREATE INDEX "opd_appointments_org_date_day_order_idx" ON "opd_appointments" USING btree ("org_id","business_date","day_order_at","id");--> statement-breakpoint
CREATE INDEX "opd_appointments_org_patient_date_idx" ON "opd_appointments" USING btree ("org_id","patient_id","business_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "opd_appointments_org_patient_arrived_idx" ON "opd_appointments" USING btree ("org_id","patient_id","practitioner_id","arrived_at") WHERE "opd_appointments"."status" = 'checked_in';--> statement-breakpoint
CREATE INDEX "opd_appointments_org_treatment_date_idx" ON "opd_appointments" USING btree ("org_id","treatment_plan_id","business_date") WHERE "opd_appointments"."treatment_plan_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("org_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_org_opd_appointment_idx" ON "invoices" USING btree ("org_id","opd_appointment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_pharmacy_sale_idx" ON "invoices" USING btree ("org_id","pharmacy_sale_id") WHERE "invoices"."pharmacy_sale_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_org_business_date_idx" ON "invoices" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_charge_idx" ON "invoice_lines" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_invoice_idx" ON "invoice_lines" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_receipt_number_idx" ON "payments" USING btree ("org_id","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_org_business_date_idx" ON "payments" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_org_number_idx" ON "refunds" USING btree ("org_id","refund_number");--> statement-breakpoint
CREATE INDEX "refunds_org_business_date_idx" ON "refunds" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "refunds_org_invoice_idx" ON "refunds" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_org_credit_note_idx" ON "refunds" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "refunds_org_advance_receipt_idx" ON "refunds" USING btree ("org_id","advance_receipt_id");--> statement-breakpoint
CREATE INDEX "treatment_plans_org_patient_status_idx" ON "treatment_plans" USING btree ("org_id","patient_id","status");--> statement-breakpoint
CREATE INDEX "treatment_plans_org_status_next_idx" ON "treatment_plans" USING btree ("org_id","status","next_sitting_on");--> statement-breakpoint
CREATE INDEX "treatment_plan_items_org_plan_idx" ON "treatment_plan_items" USING btree ("org_id","treatment_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_source_idx" ON "journal_entries" USING btree ("org_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("org_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_entry_idx" ON "journal_lines" USING btree ("org_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_catalog_item_idx" ON "products" USING btree ("org_id","catalog_item_id") WHERE "products"."catalog_item_id" is not null;--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("org_id","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_org_product_batch_idx" ON "stock_batches" USING btree ("org_id","product_id","batch_number");--> statement-breakpoint
CREATE INDEX "stock_batches_org_expiry_idx" ON "stock_batches" USING btree ("org_id","expiry_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_source_idx" ON "stock_movements" USING btree ("org_id","source_type","source_id","batch_id","bucket");--> statement-breakpoint
CREATE INDEX "stock_movements_org_batch_bucket_idx" ON "stock_movements" USING btree ("org_id","batch_id","bucket");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_org_created_idx" ON "pharmacy_sales" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "pharmacy_returns_org_sale_idx" ON "pharmacy_returns" USING btree ("org_id","pharmacy_sale_id");--> statement-breakpoint
CREATE INDEX "pharmacy_return_lines_org_invoice_line_idx" ON "pharmacy_return_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "pharmacy_return_lines_org_return_idx" ON "pharmacy_return_lines" USING btree ("org_id","return_id");