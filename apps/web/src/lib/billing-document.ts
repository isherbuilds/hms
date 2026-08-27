export const BILLING_DOCUMENT_KINDS = ["invoice", "receipt", "credit-note", "refund"] as const;
export const BILLING_DOCUMENT_LAYOUTS = ["a4", "thermal"] as const;

export type BillingDocumentKind = (typeof BILLING_DOCUMENT_KINDS)[number];
export type BillingDocumentLayout = (typeof BILLING_DOCUMENT_LAYOUTS)[number];

export type BillingDocumentRequest =
  | { kind: "invoice"; documentId: null; layout: BillingDocumentLayout }
  | { kind: Exclude<BillingDocumentKind, "invoice">; documentId: string; layout: "a4" };

export function billingPdfUrl({
  orgSlug,
  invoiceId,
  request,
}: {
  orgSlug: string;
  invoiceId: string;
  request: BillingDocumentRequest;
}): string {
  const search = new URLSearchParams({ kind: request.kind });
  if (request.kind === "invoice" && request.layout === "thermal") search.set("layout", "thermal");
  if (request.documentId) search.set("id", request.documentId);
  return `/api/${encodeURIComponent(orgSlug)}/billing/invoices/${encodeURIComponent(invoiceId)}/pdf?${search}`;
}
