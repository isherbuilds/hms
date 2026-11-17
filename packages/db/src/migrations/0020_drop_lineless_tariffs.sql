-- Migration 0016 moved a bed type's price onto `bed_tariff_lines` and dropped it from
-- `bed_tariffs` without converting existing rows (pre-production: no backfill). A tariff
-- left without a line can price nothing, yet would still count as the rate in force and let
-- an Admission start on it. Remove such tariffs, so their bed type reads as having no rate
-- until one is set again. No stay references one: 0014 and 0016 run only on a database that
-- holds no Admission.
DELETE FROM "bed_tariffs"
WHERE NOT EXISTS (
  SELECT 1 FROM "bed_tariff_lines"
  WHERE "bed_tariff_lines"."org_id" = "bed_tariffs"."org_id"
    AND "bed_tariff_lines"."tariff_id" = "bed_tariffs"."id"
);
