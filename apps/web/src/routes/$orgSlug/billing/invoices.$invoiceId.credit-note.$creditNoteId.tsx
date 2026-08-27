import { createFileRoute } from "@tanstack/react-router";

import { BillingDocumentView } from "@/components/billing-document-view";
import { billingPdfUrl } from "@/lib/billing-document";

export const Route = createFileRoute(
  "/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId",
)({
  head: () => ({ meta: [{ title: "Credit note · HMS" }] }),
  component: CreditNoteDocumentRoute,
});

function CreditNoteDocumentRoute() {
  const { orgSlug, invoiceId, creditNoteId } = Route.useParams();

  return (
    <BillingDocumentView
      title="Credit note"
      description="Credit note PDF"
      pdfUrl={billingPdfUrl({
        orgSlug,
        invoiceId,
        request: { kind: "credit-note", documentId: creditNoteId, layout: "a4" },
      })}
    />
  );
}
