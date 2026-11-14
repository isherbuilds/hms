-- Until IPD, basis followed the stream: counter Pharmacy prices are MRP (GST inside),
-- everything else is tax-exclusive. Snapshot that onto every existing row (D025).
UPDATE charges SET price_basis = CASE WHEN source_type = 'pharmacy_batch' THEN 'inclusive' ELSE 'exclusive' END;--> statement-breakpoint
UPDATE invoice_lines l SET price_basis = CASE WHEN i.stream = 'pharmacy' THEN 'inclusive' ELSE 'exclusive' END FROM invoices i WHERE i.org_id = l.org_id AND i.id = l.invoice_id;--> statement-breakpoint
UPDATE invoices SET added_tax_total = CASE WHEN stream = 'pharmacy' THEN 0 ELSE tax_total END;--> statement-breakpoint
-- 0013 gives every organization the ipd prefix 'IP', which an existing OPD or pharmacy
-- prefix may already be; the streams share one invoice-number index, so pick another.
UPDATE organization_settings
SET ipd_invoice_prefix = CASE
  WHEN 'IPD' NOT IN (invoice_prefix, pharmacy_invoice_prefix) THEN 'IPD'
  ELSE 'ADM'
END
WHERE 'IP' IN (invoice_prefix, pharmacy_invoice_prefix);
