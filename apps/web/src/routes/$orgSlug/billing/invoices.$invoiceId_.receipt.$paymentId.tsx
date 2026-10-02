import { createFileRoute } from "@tanstack/react-router";

import { appHead } from "@/config/site";
import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId_/receipt/$paymentId")({
  head: () => appHead("Receipt"),
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
