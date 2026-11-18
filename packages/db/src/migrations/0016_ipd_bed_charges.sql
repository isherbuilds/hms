CREATE TABLE "bed_tariff_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"tariff_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"daily_price" bigint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "bed_tariff_lines_daily_price_check" CHECK ("bed_tariff_lines"."daily_price" >= 0),
	CONSTRAINT "bed_tariff_lines_position_check" CHECK ("bed_tariff_lines"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admission_bed_stays" DROP CONSTRAINT "admission_bed_stays_daily_price_check";--> statement-breakpoint
ALTER TABLE "bed_tariffs" DROP CONSTRAINT "bed_tariffs_daily_price_check";--> statement-breakpoint
ALTER TABLE "bed_tariffs" DROP CONSTRAINT "bed_tariffs_org_id_catalog_item_id_catalog_items_org_id_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "ipd_checkout_minutes" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "checkout_minutes" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "bed_days_billed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bed_tariff_lines" ADD CONSTRAINT "bed_tariff_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariff_lines" ADD CONSTRAINT "bed_tariff_lines_org_id_tariff_id_bed_tariffs_org_id_id_fk" FOREIGN KEY ("org_id","tariff_id") REFERENCES "public"."bed_tariffs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bed_tariff_lines" ADD CONSTRAINT "bed_tariff_lines_org_id_catalog_item_id_catalog_items_org_id_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bed_tariff_lines_org_tariff_position_uq" ON "bed_tariff_lines" USING btree ("org_id","tariff_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "bed_tariff_lines_org_tariff_item_uq" ON "bed_tariff_lines" USING btree ("org_id","tariff_id","catalog_item_id");--> statement-breakpoint
ALTER TABLE "admission_bed_stays" DROP COLUMN "daily_price";--> statement-breakpoint
ALTER TABLE "bed_tariffs" DROP COLUMN "catalog_item_id";--> statement-breakpoint
ALTER TABLE "bed_tariffs" DROP COLUMN "daily_price";--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_ipd_checkout_minutes_check" CHECK ("organization_settings"."ipd_checkout_minutes" between 0 and 1439);--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_checkout_minutes_check" CHECK ("admissions"."checkout_minutes" between 0 and 1439);--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_bed_days_billed_check" CHECK ("admissions"."bed_days_billed" >= 0);