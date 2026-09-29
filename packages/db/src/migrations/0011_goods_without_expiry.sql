ALTER TABLE "stock_batches" ALTER COLUMN "expiry_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "expires" boolean NOT NULL;