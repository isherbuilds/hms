import { z } from "zod";

import { isGstStateCode } from "./gst-state";
import { documentPrefixSchema } from "./invoice-math";

// One schema for the settings form and the settings router.

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

export const settingsFields = z.object({
  legalName: z.string().trim().max(200, "Keep the legal name under 200 characters"),
  address: z.string().trim().max(500, "Keep the address under 500 characters"),
  taxId: z.string().trim().max(50, "Keep the tax id under 50 characters"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
      "Enter a valid 15-character GSTIN or leave it blank",
    )
    .refine((gstin) => !gstin || isGstStateCode(gstin.slice(0, 2)), "Unknown GST state code"),
  drugLicence20: z.string().trim().max(100, "Keep the drug licence under 100 characters"),
  drugLicence21: z.string().trim().max(100, "Keep the drug licence under 100 characters"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter code like INR"),
  timeZone: z.string().refine(isTimeZone, "Use a valid IANA time zone like Asia/Kolkata"),
  mrnPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
  invoicePrefix: documentPrefixSchema,
  receiptPrefix: documentPrefixSchema,
  advanceReceiptPrefix: documentPrefixSchema,
  creditNotePrefix: documentPrefixSchema,
  pharmacyInvoicePrefix: documentPrefixSchema,
  fiscalYearStartMonth: z.number().int().min(1, "Pick a month").max(12, "Pick a month"),
  followUpValidityDays: z
    .number()
    .int()
    .min(1, "Between 1 and 365 days")
    .max(365, "Between 1 and 365 days"),
  unbilledAlertHours: z
    .number()
    .int()
    .min(1, "Between 1 and 168 hours")
    .max(168, "Between 1 and 168 hours"),
});

export type SettingsFields = z.infer<typeof settingsFields>;

type RuleFields = Pick<
  SettingsFields,
  | "invoicePrefix"
  | "pharmacyInvoicePrefix"
  | "gstin"
  | "legalName"
  | "address"
  | "fiscalYearStartMonth"
>;

export function settingsRules(value: RuleFields, context: z.RefinementCtx): void {
  const issue = (path: keyof RuleFields, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });

  // OPD and pharmacy invoices count on separate counters but share one uniqueness
  // index on `(orgId, invoiceNumber)`, so equal prefixes would issue one number twice.
  if (value.invoicePrefix === value.pharmacyInvoicePrefix) {
    issue("pharmacyInvoicePrefix", "Use a different prefix from the OPD invoice prefix");
  }

  if (!value.gstin) return;

  if (!value.legalName)
    issue("legalName", "Enter the legal name for a GST-registered organization");

  if (!value.address) issue("address", "Enter the address for a GST-registered organization");

  if (value.fiscalYearStartMonth !== 4) {
    issue(
      "fiscalYearStartMonth",
      "GST-registered organizations must start the fiscal year in April",
    );
  }
}
