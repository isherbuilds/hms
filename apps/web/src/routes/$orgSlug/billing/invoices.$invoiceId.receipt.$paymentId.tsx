import { createFileRoute } from "@tanstack/react-router";

import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId")({
  head: () => ({ meta: [{ title: "Receipt · HMS" }] }),
  component: ReceiptDocumentRoute,
});

function ReceiptDocumentRoute() {
  const { orgSlug, invoiceId, paymentId } = Route.useParams();
  return (
    <BillingDocumentRoute
      orgSlug={orgSlug}
      invoiceId={invoiceId}
      kind="receipt"
      paymentId={paymentId}
    />
  );
}
