CREATE TABLE "goods_receipt_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"qty" integer NOT NULL,
	"free_qty" integer NOT NULL,
	"pack_size" integer NOT NULL,
	"rate" bigint NOT NULL,
	"discount_percent" numeric(4, 2) NOT NULL,
	"gst_percent" numeric(4, 2) NOT NULL,
	"hsn_code" text,
	CONSTRAINT "goods_receipt_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "goods_receipt_lines_qty_check" CHECK ("goods_receipt_lines"."qty" > 0 and "goods_receipt_lines"."free_qty" >= 0),
	CONSTRAINT "goods_receipt_lines_pack_size_check" CHECK ("goods_receipt_lines"."pack_size" > 0),
	CONSTRAINT "goods_receipt_lines_rate_check" CHECK ("goods_receipt_lines"."rate" >= 0),
	CONSTRAINT "goods_receipt_lines_discount_percent_check" CHECK ("goods_receipt_lines"."discount_percent" >= 0 and "goods_receipt_lines"."discount_percent" <= 99.99),
	CONSTRAINT "goods_receipt_lines_gst_percent_check" CHECK ("goods_receipt_lines"."gst_percent" >= 0 and "goods_receipt_lines"."gst_percent" <= 99.99)
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_math_check";--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "price_units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "round_off" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "bill_total" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "round_off" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "price_units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD COLUMN "mrp_units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_receipt_id_goods_receipts_org_id_id_fk" FOREIGN KEY ("org_id","receipt_id") REFERENCES "public"."goods_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_org_receipt_idx" ON "goods_receipt_lines" USING btree ("org_id","receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_org_batch_idx" ON "goods_receipt_lines" USING btree ("org_id","batch_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_price_units_check" CHECK ("charges"."price_units" > 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_round_off_range_check" CHECK ("invoices"."round_off" >= -49 and "invoices"."round_off" <= 50);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_round_off_stream_check" CHECK ("invoices"."stream" = 'pharmacy' or "invoices"."round_off" = 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_math_check" CHECK ("invoices"."grand_total" = "invoices"."subtotal" - "invoices"."discount_amount" + (case "invoices"."stream" when 'opd' then "invoices"."tax_total" else 0 end) + "invoices"."round_off");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_units_check" CHECK ("invoice_lines"."price_units" > 0);--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_mrp_units_check" CHECK ("stock_batches"."mrp_units" > 0);