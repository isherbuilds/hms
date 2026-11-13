-- 0018 gave every organization the ipd prefix 'IP', which an existing OPD or pharmacy
-- prefix may already be; the streams share one invoice-number index, so pick another.
UPDATE organization_settings
SET ipd_invoice_prefix = CASE
  WHEN 'IPD' NOT IN (invoice_prefix, pharmacy_invoice_prefix) THEN 'IPD'
  ELSE 'ADM'
END
WHERE 'IP' IN (invoice_prefix, pharmacy_invoice_prefix);
