import { createFileRoute } from "@tanstack/react-router";

import { BillingDocumentView } from "@/components/billing-document-view";
import { billingPdfUrl } from "@/lib/billing-document";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId")({
  head: () => ({ meta: [{ title: "Receipt · HMS" }] }),
  component: ReceiptDocumentRoute,
});

function ReceiptDocumentRoute() {
  const { orgSlug, invoiceId, paymentId } = Route.useParams();

  return (
    <BillingDocumentView
      title="Receipt"
      description="Payment receipt PDF"
      pdfUrl={billingPdfUrl({
        orgSlug,
        invoiceId,
        request: { kind: "receipt", documentId: paymentId, layout: "a4" },
      })}
    />
  );
}
