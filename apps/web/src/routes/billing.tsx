import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/billing")({
  head: () => pageHead({ path: "/billing" }),
  component: () => (
    <FeaturePage
      shot="billing"
      eyebrow="Billing, collections and GST"
      title="Know what you are owed"
      lead="Unbilled care, unpaid invoices and refunds due, on one screen."
      windowTitle="Billing · Mercy General"
      captureAlt="The billing worklist: today's collected, outstanding and over-30-day totals above the list of open invoices"
      crops={[
        {
          region: { x: 272, y: 64, w: 1144, h: 160 },
          claim: "Today, in four numbers.",
          body: "Waiting to be billed, collected, outstanding and over 30 days — the desk's whole day before anyone opens a report.",
        },
        {
          region: { x: 272, y: 210, w: 740, h: 330 },
          claim: "The open money, filtered in one click.",
          body: "To bill, unpaid, or over seven days. Search by patient, MRN or invoice number without leaving the list.",
        },
        {
          region: { x: 272, y: 640, w: 1144, h: 260 },
          claim: "Overdue is a colour, not a report.",
          body: "An invoice past seven days changes colour in the list. Refunds and credit notes correct an invoice without overwriting it, and the GST outward register is built from the same rows.",
        },
      ]}
    />
  ),
});
