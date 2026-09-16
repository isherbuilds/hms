export const BILLING_DOCUMENT_LAYOUTS = ["a4", "thermal"] as const;

export type BillingDocumentLayout = (typeof BILLING_DOCUMENT_LAYOUTS)[number];

export type BillingDocumentRequest =
  | { kind: "invoice"; documentId: null; layout: BillingDocumentLayout }
  | { kind: "receipt" | "credit-note" | "refund"; documentId: string; layout: "a4" };

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

/** The advance receipt, or with `refundId` a refund voucher issued against it. */
export function advancePdfUrl(orgSlug: string, advanceId: string, refundId?: string): string {
  const path = `/api/${encodeURIComponent(orgSlug)}/billing/advances/${encodeURIComponent(advanceId)}/pdf`;

  return refundId ? `${path}?${new URLSearchParams({ refund: refundId })}` : path;
}
