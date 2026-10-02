import { createFileRoute } from "@tanstack/react-router";

import { appHead } from "@/config/site";
import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute(
  "/$orgSlug/billing/invoices/$invoiceId_/credit-note/$creditNoteId",
)({
  head: () => appHead("Credit note"),
  component: CreditNoteDocumentRoute,
});

function CreditNoteDocumentRoute() {
  const { orgSlug, invoiceId, creditNoteId } = Route.useParams();

  return (
    <BillingDocumentRoute
      orgSlug={orgSlug}
      invoiceId={invoiceId}
      kind="credit-note"
      creditNoteId={creditNoteId}
    />
  );
}
