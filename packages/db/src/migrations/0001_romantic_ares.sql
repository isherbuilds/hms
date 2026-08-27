ALTER TABLE "credit_notes" ADD COLUMN "business_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "business_date" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "business_date" date;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "business_date" date;