ALTER TABLE "charges" DROP CONSTRAINT "charges_price_units_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_price_units_check";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP CONSTRAINT "goods_receipts_org_id_file_id_file_org_id_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_org_id_catalog_item_id_catalog_items_org_id_id_fk";
--> statement-breakpoint
DROP INDEX "goods_receipts_org_file_idx";--> statement-breakpoint
DROP INDEX "products_org_catalog_item_idx";--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "catalog_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_batches" ALTER COLUMN "mrp_units" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "stock_batch_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pack" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sold" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_rate_percent" numeric(4, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_stock_batch_id_stock_batches_org_id_id_fk" FOREIGN KEY ("org_id","stock_batch_id") REFERENCES "public"."stock_batches"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_org_stock_batch_idx" ON "charges" USING btree ("org_id","stock_batch_id") WHERE "charges"."stock_batch_id" is not null;--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "file_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "catalog_item_id";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_check" CHECK ("catalog_items"."category" <> 'pharmacy');--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_catalog_item_source_check" CHECK (("charges"."catalog_item_id" is null) = ("charges"."source_type" = 'pharmacy_batch') and ("charges"."stock_batch_id" is not null) = ("charges"."source_type" = 'pharmacy_batch') and ("charges"."source_type" <> 'pharmacy_batch' or ("charges"."pharmacy_sale_id" is not null and "charges"."source_id" is null)));--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_price_units_check" CHECK ("charges"."price_units" >= 1);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_units_check" CHECK ("invoice_lines"."price_units" >= 1);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_check" CHECK ("products"."tax_rate_percent" >= 0 and "products"."tax_rate_percent" <= 99.99);