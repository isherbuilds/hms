CREATE TABLE "admission_pharmacy_return_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"return_id" text NOT NULL,
	"issue_line_id" text NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "admission_pharmacy_return_lines_qty_check" CHECK ("admission_pharmacy_return_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "admission_pharmacy_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"reason" text NOT NULL,
	"credit_note_id" text,
	"returned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_pharmacy_returns_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "admission_pharmacy_return_lines" ADD CONSTRAINT "admission_pharmacy_return_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_return_lines" ADD CONSTRAINT "admission_pharmacy_return_lines_org_id_return_id_admission_pharmacy_returns_org_id_id_fk" FOREIGN KEY ("org_id","return_id") REFERENCES "public"."admission_pharmacy_returns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_return_lines" ADD CONSTRAINT "admission_pharmacy_return_lines_org_id_issue_line_id_admission_pharmacy_issue_lines_org_id_id_fk" FOREIGN KEY ("org_id","issue_line_id") REFERENCES "public"."admission_pharmacy_issue_lines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_returns" ADD CONSTRAINT "admission_pharmacy_returns_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_returns" ADD CONSTRAINT "admission_pharmacy_returns_returned_by_user_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_returns" ADD CONSTRAINT "admission_pharmacy_returns_org_id_admission_id_admissions_org_id_id_fk" FOREIGN KEY ("org_id","admission_id") REFERENCES "public"."admissions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_pharmacy_returns" ADD CONSTRAINT "admission_pharmacy_returns_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_pharmacy_return_lines_org_issue_line_idx" ON "admission_pharmacy_return_lines" USING btree ("org_id","issue_line_id");--> statement-breakpoint
CREATE INDEX "admission_pharmacy_returns_org_admission_idx" ON "admission_pharmacy_returns" USING btree ("org_id","admission_id");