import { createRequestContext } from "@hms/api/lib/context";
import { appRouter } from "@hms/api/routers/index";
import { ORPCError, createRouterClient } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

import { parseBillingDocumentRequest } from "@/lib/billing-document-request";
import { pdfContentDisposition } from "@/lib/content-disposition";

/**
 * The guarded billing query is the route's sole source of tenant data. The
 * renderer is lazy so its WASM and fonts stay out of browser and route chunks.
 */
export const Route = createFileRoute("/api/$orgSlug/billing/invoices/$invoiceId/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const parsed = parseBillingDocumentRequest(new URL(request.url).searchParams);
        if (!parsed) return new Response("Unknown document", { status: 400 });

        const client = createRouterClient(appRouter, {
          context: () => createRequestContext(new Headers(request.headers)),
        });

        try {
          const data = await client.billing.getInvoice({
            orgSlug: params.orgSlug,
            invoiceId: params.invoiceId,
          });
          const { renderBillingPdf } = await import("@/lib/billing-pdf");
          const { bytes, fileName } = await renderBillingPdf({ ...parsed.document, data });

          return new Response(bytes.slice().buffer as ArrayBuffer, {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Disposition": pdfContentDisposition(fileName, parsed.download),
              "Content-Type": "application/pdf",
            },
          });
        } catch (error) {
          if (error instanceof ORPCError) {
            return new Response(error.message, { status: error.status });
          }
          console.error(error);
          return new Response("Could not render the document", { status: 500 });
        }
      },
    },
  },
});
