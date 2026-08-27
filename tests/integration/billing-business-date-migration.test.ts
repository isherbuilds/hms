import { expect, test } from "bun:test";

import { withIsolatedMigrationDatabase } from "../support/migration-harness";

test("existing financial documents gain their organization-local Business Date", async () => {
  await withIsolatedMigrationDatabase(async (client, migrateThrough) => {
    await migrateThrough("square_magma");

    await client.query("set session_replication_role = replica");
    try {
      await client.query(`
        insert into organization_settings (
          org_id, legal_name, address, tax_id, currency, mrn_prefix,
          invoice_prefix, receipt_prefix, credit_note_prefix,
          fiscal_year_start_month, time_zone, follow_up_validity_days
        ) values (
          'org-kolkata', 'Hospital', '', '', 'INR', 'MRN',
          'INV', 'RCT', 'CN', 4, 'Asia/Kolkata', 14
        );

        insert into invoices (
          id, org_id, opd_appointment_id, patient_id, invoice_number, fiscal_year,
          subtotal, tax_total, grand_total, org_legal_name, org_address, org_tax_id,
          currency, patient_name, patient_mrn, patient_phone, issued_by, created_at
        ) values
          (
            'invoice-kolkata', 'org-kolkata', 'appointment-1', 'patient-1', 'INV/1',
            '2026-27', 100, 18, 118, 'Hospital', '', '', 'INR', 'Patient', 'MRN-1',
            '555', 'user-1', '2026-03-31T20:00:00Z'
          ),
          (
            'invoice-default', 'org-default', 'appointment-2', 'patient-2', 'INV/2',
            '2026-27', 100, 18, 118, 'Hospital', '', '', 'INR', 'Patient', 'MRN-2',
            '555', 'user-1', '2026-03-31T20:00:00Z'
          );

        insert into payments (
          id, org_id, invoice_id, method, amount, receipt_number, fiscal_year,
          received_by, created_at
        ) values (
          'payment-1', 'org-kolkata', 'invoice-kolkata', 'cash', 10, 'RCT/1',
          '2026-27', 'user-1', '2026-03-31T20:00:00Z'
        );

        insert into credit_notes (
          id, org_id, invoice_id, credit_note_number, fiscal_year, reason,
          subtotal, tax_total, total, issued_by, created_at
        ) values (
          'credit-1', 'org-kolkata', 'invoice-kolkata', 'CN/1', '2026-27', 'Correction',
          10, 1.8, 11.8, 'user-1', '2026-03-31T20:00:00Z'
        );

        insert into refunds (
          id, org_id, invoice_id, credit_note_id, method, amount, refund_number,
          fiscal_year, refunded_by, created_at
        ) values (
          'refund-1', 'org-kolkata', 'invoice-kolkata', 'credit-1', 'cash', 11.8,
          'REF/1', '2026-27', 'user-1', '2026-03-31T20:00:00Z'
        );
      `);
    } finally {
      await client.query("set session_replication_role = origin");
    }

    await migrateThrough("romantic_ares");
    await migrateThrough("billing-business-date-backfill");

    const dates = await client.query<{ business_date: string; table_name: string }>(`
      select business_date::text, 'invoice' as table_name from invoices
      union all select business_date::text, 'payment' from payments
      union all select business_date::text, 'credit_note' from credit_notes
      union all select business_date::text, 'refund' from refunds
      order by table_name, business_date
    `);
    expect(dates.rows).toHaveLength(5);
    expect(dates.rows.every((row) => row.business_date === "2026-04-01")).toBe(true);

    await migrateThrough("wet_centennial");
    const nullability = await client.query<{ is_nullable: string }>(`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('invoices', 'payments', 'credit_notes', 'refunds')
        and column_name = 'business_date'
    `);
    expect(nullability.rows).toHaveLength(4);
    expect(nullability.rows.every((row) => row.is_nullable === "NO")).toBe(true);
  });
});
