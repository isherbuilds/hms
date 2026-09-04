import { createFileRoute } from "@tanstack/react-router";

import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId_/refund/$refundId")({
  head: () => ({ meta: [{ title: "Refund voucher · HMS" }] }),
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
