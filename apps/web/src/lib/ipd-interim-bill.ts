// The interim bill prints the running bill during a stay. It is not a tax document and
// takes no number, so its title says so.
export const INTERIM_BILL_TITLE = "Interim bill — not an Invoice or Receipt";

/** The interim bill as a PDF, opened in a new tab like every other printed document. */
export function interimBillPdfUrl(orgSlug: string, admissionId: string): string {
  return `/api/${encodeURIComponent(orgSlug)}/ipd/admissions/${encodeURIComponent(admissionId)}/interim-bill`;
}
