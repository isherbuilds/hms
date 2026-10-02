import { createFileRoute } from "@tanstack/react-router";

import { appHead } from "@/config/site";
import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId_/refund/$refundId")({
  head: () => appHead("Refund voucher"),
  component: RefundDocumentRoute,
});

function RefundDocumentRoute() {
  const { orgSlug, invoiceId, refundId } = Route.useParams();

  return (
    <BillingDocumentRoute
      orgSlug={orgSlug}
      invoiceId={invoiceId}
      kind="refund"
      refundId={refundId}
    />
  );
}
