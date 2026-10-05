CREATE TABLE "goods_receipt_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"amount" bigint NOT NULL,
	"gst_amount" bigint NOT NULL,
	CONSTRAINT "goods_receipt_adjustments_amount_check" CHECK ("goods_receipt_adjustments"."amount" > 0 and "goods_receipt_adjustments"."gst_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "advance_receipts" ADD COLUMN "org_gstin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "gstin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "drug_licence_20" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "drug_licence_21" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "org_gstin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "org_drug_licence_20" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "org_drug_licence_21" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_adjustments" ADD CONSTRAINT "goods_receipt_adjustments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_adjustments" ADD CONSTRAINT "goods_receipt_adjustments_org_id_receipt_id_goods_receipts_org_id_id_fk" FOREIGN KEY ("org_id","receipt_id") REFERENCES "public"."goods_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;