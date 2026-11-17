import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/billing-pdf-response";

// `?kind=admission` or `?kind=discharge`; anything else is not a slip.
export const Route = createFileRoute("/api/$orgSlug/ipd/admissions/$admissionId/slip")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const kind = new URL(request.url).searchParams.get("kind");

        if (kind !== "admission" && kind !== "discharge") {
          return new Response("Unknown slip", { status: 400 });
        }

        return pdfResponse(request, false, async (client) => {
          const input = { orgSlug: params.orgSlug };

          const [detail, settings] = await Promise.all([
            client.ipd.get({ ...input, admissionId: params.admissionId }),
            client.settings.get(input),
          ]);

          const { renderSlipPdf } = await import("@/lib/billing-pdf");

          return renderSlipPdf(detail, settings, kind);
        });
      },
    },
  },
});
