import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { BillingDocumentView } from "@/components/billing-document-view";
import { billingPdfUrl } from "@/lib/billing-document";

export const Route = createFileRoute("/$orgSlug/billing/invoices/$invoiceId")({
  validateSearch: z.object({ layout: z.enum(["thermal"]).optional() }),
  head: () => ({ meta: [{ title: "Invoice · HMS" }] }),
  component: InvoiceDocumentRoute,
});

function InvoiceDocumentRoute() {
  const { orgSlug, invoiceId } = Route.useParams();
  const { layout } = Route.useSearch();
  const resolvedLayout = layout ?? "a4";

  return (
    <BillingDocumentView
      title="Invoice"
      description={resolvedLayout === "thermal" ? "80 mm till roll" : "A4 document"}
      pdfUrl={billingPdfUrl({
        orgSlug,
        invoiceId,
        request: { kind: "invoice", documentId: null, layout: resolvedLayout },
      })}
    />
  );
}
