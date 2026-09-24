-- Convert the former per-unit quote to the whole course price.
UPDATE "treatment_plan_items" SET "quoted_price" = "quoted_price" * "sittings_planned";
