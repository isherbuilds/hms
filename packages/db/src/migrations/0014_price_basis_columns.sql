ALTER TABLE "charges" ADD COLUMN "price_basis" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "added_tax_total" bigint;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "price_basis" text;