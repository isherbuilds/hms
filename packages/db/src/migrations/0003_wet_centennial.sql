ALTER TABLE "credit_notes" ALTER COLUMN "business_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "business_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "business_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "business_date" SET NOT NULL;