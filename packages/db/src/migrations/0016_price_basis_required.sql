ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_math_check";--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "price_basis" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "added_tax_total" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ALTER COLUMN "price_basis" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_added_tax_total_check" CHECK ("invoices"."added_tax_total" >= 0 and "invoices"."added_tax_total" <= "invoices"."tax_total");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_math_check" CHECK ("invoices"."grand_total" = "invoices"."subtotal" - "invoices"."discount_amount" + "invoices"."added_tax_total" + "invoices"."round_off");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_basis_math_check" CHECK ("invoice_lines"."gross" = "invoice_lines"."taxable_value" + "invoice_lines"."tax_amount" and "invoice_lines"."line_subtotal" - "invoice_lines"."allocated_discount" = case "invoice_lines"."price_basis" when 'inclusive' then "invoice_lines"."gross" else "invoice_lines"."taxable_value" end);