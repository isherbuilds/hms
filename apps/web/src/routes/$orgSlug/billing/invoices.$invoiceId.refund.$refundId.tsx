import { createFileRoute } from "@tanstack/react-router";

import { BillingDocumentView } from "@/components/billing-document-view";
import { billingPdfUrl } from "@/lib/billing-document";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId/refund/$refundId")({
  head: () => ({ meta: [{ title: "Refund voucher · HMS" }] }),
  component: RefundDocumentRoute,
});

function RefundDocumentRoute() {
  const { orgSlug, invoiceId, refundId } = Route.useParams();

  return (
    <BillingDocumentView
      title="Refund voucher"
      description="Refund voucher PDF"
      pdfUrl={billingPdfUrl({
        orgSlug,
        invoiceId,
        request: { kind: "refund", documentId: refundId, layout: "a4" },
      })}
    />
  );
}
