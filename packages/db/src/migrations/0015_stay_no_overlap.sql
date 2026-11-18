-- Occupancy is a database rule (D066): no two stays of one bed, and no two stays of one
-- Admission, overlap in time, closed segments included. `[started_at, ended_at)` lets a
-- transfer close one stay and open the next at the same instant; an open stay runs to
-- infinity. A cancelled Admission's stay is closed at its start, an empty interval.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_bed_no_overlap" EXCLUDE USING gist ("org_id" WITH =, "bed_id" WITH =, tstzrange("started_at", "ended_at") WITH &&);--> statement-breakpoint
ALTER TABLE "admission_bed_stays" ADD CONSTRAINT "admission_bed_stays_admission_no_overlap" EXCLUDE USING gist ("org_id" WITH =, "admission_id" WITH =, tstzrange("started_at", "ended_at") WITH &&);
