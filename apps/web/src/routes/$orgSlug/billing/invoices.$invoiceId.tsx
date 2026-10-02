import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appHead } from "@/config/site";
import { BillingDocumentRoute } from "@/components/billing-document-view";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId")({
  validateSearch: z.object({ layout: z.enum(["thermal"]).optional() }),
  head: () => appHead("Invoice"),
  component: InvoiceDocumentRoute,
});

function InvoiceDocumentRoute() {
  return (
    <BillingDocumentRoute
      {...Route.useParams()}
      kind="invoice"
      layout={Route.useSearch().layout ?? "a4"}
    />
  );
}
