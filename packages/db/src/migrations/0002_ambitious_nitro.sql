ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;