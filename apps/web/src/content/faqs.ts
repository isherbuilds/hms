import type { ShotName } from "@/components/landing/product-window";

/* Feature-page answers stay separate from the homepage's mockup copy.
   Both lists live apart from JSX so `seo.ts` can read them in `head()`. */
export const FAQS: { q: string; a: string; features: ShotName[] }[] = [
  {
    q: "Can another hospital see our data?",
    a: "No. Staff can access only the hospitals they belong to. Patient records and uploaded files stay private.",
    features: ["patients"],
  },
  {
    q: "How do staff get accounts?",
    a: "Your hospital administrator invites staff and assigns their roles. There is no public sign-up.",
    features: ["opd"],
  },
  {
    q: "Does it need the internet?",
    a: "Yes. Your browser must stay connected to the hospital server. There is no offline mode.",
    features: ["opd"],
  },
  {
    q: "What does it cost?",
    a: "Access is by invitation only. Early-bird hospitals agree a price with us directly. Call or WhatsApp us to request an invitation, discuss pricing, or ask a question.",
    features: ["opd", "patients", "billing"],
  },
  {
    q: "Is it ready for GST?",
    a: "Invoices print your legal name, address and GSTIN, and there is a GST outward register report for any date range in Excel or PDF. It is a register your accountant works from, not a filing export. You or your CA still file the return.",
    features: ["billing"],
  },
  {
    q: "Are you ABDM certified?",
    a: "Not yet. ABDM needs facility and practitioner registration and a completed sandbox process, and we will not claim it before we hold it. The data model uses durable identifiers and everything is exportable, so the work is additive rather than a migration.",
    features: ["patients"],
  },
  {
    q: "What happens when we bill something wrong?",
    a: "It is corrected, never overwritten. An issued invoice is immutable; a refund or a credit note records the correction against it, so the trail shows what happened rather than only the final number.",
    features: ["billing"],
  },
  {
    q: "Can we get our data out?",
    a: "Yes. Every report exports to Excel or PDF over any date range, and invoices and receipts render as PDFs. Your records are yours.",
    features: ["patients", "billing"],
  },
];

/* HOME_FAQS feeds both the home page and its FAQPage JSON-LD, so crawlers
   receive exactly the questions and answers rendered on the page. */
export const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: "What can we manage?",
    a: "Patient records, OPD appointments and queues, billing, payments, pharmacy sales and stock.",
  },
  {
    q: "Can another hospital see our data?",
    a: "No. Staff can access only the hospitals they belong to. Patient records and uploaded files stay private.",
  },
  {
    q: "Does it work offline?",
    a: "No. Your browser must stay connected to the hospital server to view and save records.",
  },
  {
    q: "How do we get started?",
    a: "Contact us for a demo. We will discuss your hospital’s setup, data and training needs with you.",
  },
];
