CREATE TABLE "counter" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "counter_org_id_key_pk" PRIMARY KEY("org_id","key")
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_fiscal_month_check" CHECK ("organization_settings"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
DROP TABLE "todo" CASCADE;--> statement-breakpoint
ALTER TABLE "counter" ADD CONSTRAINT "counter_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;