CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_target_type_check" CHECK ("attachments"."target_type" in ('visit_prescription'))
);
--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_source_type_check";--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_org_target_file_uq" ON "attachments" USING btree ("org_id","target_type","target_id","file_id");--> statement-breakpoint
CREATE INDEX "attachments_org_target_idx" ON "attachments" USING btree ("org_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_file_idx" ON "attachments" USING btree ("org_id","file_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_source_type_check" CHECK ("charges"."source_type" in ('consult_fee', 'manual'));