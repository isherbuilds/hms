-- Until IPD, basis followed the stream: counter Pharmacy prices are MRP (GST inside),
-- everything else is tax-exclusive. Snapshot that onto every existing row (D025).
UPDATE charges SET price_basis = CASE WHEN source_type = 'pharmacy_batch' THEN 'inclusive' ELSE 'exclusive' END;--> statement-breakpoint
UPDATE invoice_lines l SET price_basis = CASE WHEN i.stream = 'pharmacy' THEN 'inclusive' ELSE 'exclusive' END FROM invoices i WHERE i.org_id = l.org_id AND i.id = l.invoice_id;--> statement-breakpoint
UPDATE invoices SET added_tax_total = CASE WHEN stream = 'pharmacy' THEN 0 ELSE tax_total END;
