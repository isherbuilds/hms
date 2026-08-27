UPDATE "invoices"
SET "business_date" = (
  "created_at" AT TIME ZONE COALESCE(
    (SELECT "time_zone" FROM "organization_settings" WHERE "org_id" = "invoices"."org_id"),
    'Asia/Kolkata'
  )
)::date
WHERE "business_date" IS NULL;
--> statement-breakpoint
UPDATE "payments"
SET "business_date" = (
  "created_at" AT TIME ZONE COALESCE(
    (SELECT "time_zone" FROM "organization_settings" WHERE "org_id" = "payments"."org_id"),
    'Asia/Kolkata'
  )
)::date
WHERE "business_date" IS NULL;
--> statement-breakpoint
UPDATE "credit_notes"
SET "business_date" = (
  "created_at" AT TIME ZONE COALESCE(
    (SELECT "time_zone" FROM "organization_settings" WHERE "org_id" = "credit_notes"."org_id"),
    'Asia/Kolkata'
  )
)::date
WHERE "business_date" IS NULL;
--> statement-breakpoint
UPDATE "refunds"
SET "business_date" = (
  "created_at" AT TIME ZONE COALESCE(
    (SELECT "time_zone" FROM "organization_settings" WHERE "org_id" = "refunds"."org_id"),
    'Asia/Kolkata'
  )
)::date
WHERE "business_date" IS NULL;
