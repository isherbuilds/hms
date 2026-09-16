import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/billing-pdf-response";

// The receipt, or with `?refund=<id>` a refund voucher issued against it. A refund id
// not on this advance is a 404, from the renderer.
export const Route = createFileRoute("/api/$orgSlug/billing/advances/$advanceId/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, false, async (client) => {
          const data = await client.billing.getAdvanceReceipt({
            orgSlug: params.orgSlug,
            advanceId: params.advanceId,
          });

          const { renderAdvancePdf } = await import("@/lib/billing-pdf");

          return renderAdvancePdf(data, new URL(request.url).searchParams.get("refund"));
        }),
    },
  },
});
