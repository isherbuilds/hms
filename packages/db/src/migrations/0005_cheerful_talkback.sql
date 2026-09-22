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
	"gross" bigint NOT NULL,
	"discount" bigint NOT NULL,
	"taxable" bigint NOT NULL,
	"gst" bigint NOT NULL,
	"net" bigint NOT NULL,
	"unit_cost" bigint NOT NULL,
	CONSTRAINT "goods_receipt_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "goods_receipt_lines_qty_check" CHECK ("goods_receipt_lines"."qty" > 0 and "goods_receipt_lines"."free_qty" >= 0),
	CONSTRAINT "goods_receipt_lines_pack_size_check" CHECK ("goods_receipt_lines"."pack_size" > 0),
	CONSTRAINT "goods_receipt_lines_rate_check" CHECK ("goods_receipt_lines"."rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "bill_total" bigint;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_receipt_id_goods_receipts_org_id_id_fk" FOREIGN KEY ("org_id","receipt_id") REFERENCES "public"."goods_receipts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_org_id_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_org_receipt_idx" ON "goods_receipt_lines" USING btree ("org_id","receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_org_batch_idx" ON "goods_receipt_lines" USING btree ("org_id","batch_id");