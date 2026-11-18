import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/billing-pdf-response";

export const Route = createFileRoute("/api/$orgSlug/ipd/admissions/$admissionId/interim-bill")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        pdfResponse(request, false, async (client) => {
          const input = { orgSlug: params.orgSlug, admissionId: params.admissionId };

          const [detail, bill, settings] = await Promise.all([
            client.ipd.get(input),
            client.ipd.previewInvoice(input),
            client.settings.get({ orgSlug: params.orgSlug }),
          ]);

          const { renderInterimBillPdf } = await import("@/lib/billing-pdf");

          return renderInterimBillPdf(detail, bill, settings);
        }),
    },
  },
});
