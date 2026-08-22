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
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_target_type_check" CHECK ("attachments"."target_type" in ('prescription'))
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
	"issuer" text DEFAULT 'local:credential' NOT NULL,
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
	"unit_price" numeric(12, 2) NOT NULL,
	"tax_rate_percent" numeric(4, 2) DEFAULT '0' NOT NULL,
	"tax_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_category_check" CHECK ("catalog_items"."category" in ('consultation', 'procedure', 'lab', 'radiology', 'other')),
	CONSTRAINT "catalog_items_unit_price_check" CHECK ("catalog_items"."unit_price" >= 0),
	CONSTRAINT "catalog_items_tax_rate_check" CHECK ("catalog_items"."tax_rate_percent" >= 0 and "catalog_items"."tax_rate_percent" <= 99.99)
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opd_appointment_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"description" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
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
	CONSTRAINT "charges_qty_check" CHECK ("charges"."qty" > 0),
	CONSTRAINT "charges_source_type_check" CHECK ("charges"."source_type" in ('consult_fee', 'catalog')),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" in ('pending', 'invoiced', 'voided')),
	CONSTRAINT "charges_revenue_category_check" CHECK ("charges"."revenue_category" in ('consultation', 'procedure', 'lab', 'radiology', 'other'))
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
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"default_consult_fee_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"receipt_prefix" text NOT NULL,
	"credit_note_prefix" text NOT NULL,
	"fiscal_year_start_month" integer NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"follow_up_validity_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_fiscal_month_check" CHECK ("organization_settings"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "organization_settings_follow_up_days_check" CHECK ("organization_settings"."follow_up_validity_days" between 1 and 365)
);
--> statement-breakpoint
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
	"email" text,
	"blood_group" text,
	"allergies" text,
	"medical_history" text,
	"uid" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_age_or_dob_check" CHECK ("patients"."date_of_birth" is not null or "patients"."age_years" is not null),
	CONSTRAINT "patients_sex_check" CHECK ("patients"."sex" in ('male', 'female', 'other', 'unknown')),
	CONSTRAINT "patients_age_range_check" CHECK ("patients"."age_years" is null or "patients"."age_years" between 0 and 150),
	CONSTRAINT "patients_blood_group_check" CHECK ("patients"."blood_group" is null or "patients"."blood_group" in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'))
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
	CONSTRAINT "practitioners_follow_up_days_check" CHECK ("practitioners"."follow_up_validity_days" is null or "practitioners"."follow_up_validity_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "opd_appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"patient_id" text,
	"caller_name" text,
	"caller_phone" text,
	"practitioner_id" text NOT NULL,
	"department_id" text NOT NULL,
	"arrival_mode" text NOT NULL,
	"kind" text DEFAULT 'consultation' NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"scheduled_for" timestamp with time zone,
	"token_number" integer,
	"arrived_at" timestamp with time zone,
	"consultation_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"left_unseen_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opd_appointments_token_positive_check" CHECK ("opd_appointments"."token_number" is null or "opd_appointments"."token_number" > 0),
	CONSTRAINT "opd_appointments_identity_check" CHECK ("opd_appointments"."patient_id" is not null or ("opd_appointments"."caller_name" is not null and "opd_appointments"."caller_phone" is not null)),
	CONSTRAINT "opd_appointments_scheduled_check" CHECK ("opd_appointments"."arrival_mode" <> 'scheduled' or "opd_appointments"."scheduled_for" is not null),
	CONSTRAINT "opd_appointments_arrived_check" CHECK ("opd_appointments"."status" not in ('waiting', 'in_consult', 'completed', 'left_unseen') or ("opd_appointments"."patient_id" is not null and "opd_appointments"."token_number" is not null and "opd_appointments"."arrived_at" is not null)),
	CONSTRAINT "opd_appointments_booked_check" CHECK ("opd_appointments"."status" <> 'booked' or ("opd_appointments"."arrival_mode" = 'scheduled' and "opd_appointments"."token_number" is null and "opd_appointments"."arrived_at" is null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opd_appointment_id" text NOT NULL,
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
	"tax_code" text,
	"revenue_category" text NOT NULL,
	CONSTRAINT "invoice_lines_revenue_category_check" CHECK ("invoice_lines"."revenue_category" in ('consultation', 'procedure', 'lab', 'radiology', 'other'))
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
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"narration" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"debit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "journal_lines_debit_check" CHECK ("journal_lines"."debit" >= 0),
	CONSTRAINT "journal_lines_credit_check" CHECK ("journal_lines"."credit" >= 0),
	CONSTRAINT "journal_lines_one_side_check" CHECK (("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_opd_appointment_id_opd_appointments_id_fk" FOREIGN KEY ("opd_appointment_id") REFERENCES "public"."opd_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter" ADD CONSTRAINT "counter_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_default_consult_fee_item_id_catalog_items_id_fk" FOREIGN KEY ("default_consult_fee_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_member_user_id_user_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_consult_fee_item_id_catalog_items_id_fk" FOREIGN KEY ("consult_fee_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_follow_up_fee_item_id_catalog_items_id_fk" FOREIGN KEY ("follow_up_fee_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_opd_appointment_id_opd_appointments_id_fk" FOREIGN KEY ("opd_appointment_id") REFERENCES "public"."opd_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_code_idx" ON "accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_system_key_idx" ON "accounts" USING btree ("org_id","system_key") WHERE "accounts"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_org_target_file_uq" ON "attachments" USING btree ("org_id","target_type","target_id","file_id");--> statement-breakpoint
CREATE INDEX "attachments_org_target_idx" ON "attachments" USING btree ("org_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_file_idx" ON "attachments" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_id_idx" ON "audit_log" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
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
CREATE INDEX "charges_org_status_created_idx" ON "charges" USING btree ("org_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_credit_note_idx" ON "credit_note_lines" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_invoice_line_idx" ON "credit_note_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_idx" ON "credit_notes" USING btree ("org_id","credit_note_number");--> statement-breakpoint
CREATE INDEX "credit_notes_org_invoice_idx" ON "credit_notes" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_idx" ON "departments" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "file_org_created_idx" ON "file" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_mrn_idx" ON "patients" USING btree ("org_id","mrn");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_uid_idx" ON "patients" USING btree ("org_id","uid") WHERE "patients"."uid" is not null;--> statement-breakpoint
CREATE INDEX "patients_org_created_idx" ON "patients" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "practitioners_org_name_idx" ON "practitioners" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "practitioners_org_department_idx" ON "practitioners" USING btree ("org_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opd_appointments_org_practitioner_date_token_uq" ON "opd_appointments" USING btree ("org_id","practitioner_id","business_date","token_number") WHERE "opd_appointments"."token_number" is not null;--> statement-breakpoint
CREATE INDEX "opd_appointments_org_date_status_idx" ON "opd_appointments" USING btree ("org_id","business_date","status","created_at","id");--> statement-breakpoint
CREATE INDEX "opd_appointments_org_practitioner_date_idx" ON "opd_appointments" USING btree ("org_id","practitioner_id","business_date","created_at","id");--> statement-breakpoint
CREATE INDEX "opd_appointments_org_patient_completed_idx" ON "opd_appointments" USING btree ("org_id","patient_id","practitioner_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("org_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_org_opd_appointment_idx" ON "invoices" USING btree ("org_id","opd_appointment_id");--> statement-breakpoint
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
CREATE UNIQUE INDEX "journal_entries_org_source_idx" ON "journal_entries" USING btree ("org_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("org_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_entry_idx" ON "journal_lines" USING btree ("org_id","entry_id");