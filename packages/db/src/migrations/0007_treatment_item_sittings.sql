ALTER TABLE "treatment_plan_items" RENAME COLUMN "unit_price" TO "quoted_price";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" RENAME COLUMN "qty_planned" TO "sittings_planned";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" DROP CONSTRAINT "treatment_plan_items_unit_price_check";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" DROP CONSTRAINT "treatment_plan_items_qty_check";--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_quoted_price_check" CHECK ("treatment_plan_items"."quoted_price" >= 0);--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_sittings_check" CHECK ("treatment_plan_items"."sittings_planned" > 0);
