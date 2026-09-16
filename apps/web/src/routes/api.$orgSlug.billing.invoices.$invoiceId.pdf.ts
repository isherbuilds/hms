import { createFileRoute } from "@tanstack/react-router";

import { parseBillingDocumentRequest } from "@/lib/billing-document-request";
import { pdfResponse } from "@/lib/billing-pdf-response";

export const Route = createFileRoute("/api/$orgSlug/billing/invoices/$invoiceId/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const parsed = parseBillingDocumentRequest(new URL(request.url).searchParams);

        if (!parsed) return new Response("Unknown document", { status: 400 });

        return pdfResponse(request, parsed.download, async (client) => {
          const data = await client.billing.getInvoice({
            orgSlug: params.orgSlug,
            invoiceId: params.invoiceId,
          });

          const { renderBillingPdf } = await import("@/lib/billing-pdf");

          return renderBillingPdf({ ...parsed.document, data });
        });
      },
    },
  },
});
