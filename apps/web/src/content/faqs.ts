import type { ShotName } from "@/components/landing/product-window";

/* Feature-page answers stay separate from the homepage's mockup copy.
   Both lists live apart from JSX so `seo.ts` can read them in `head()`. */
export const FAQS: { q: string; a: string; features: ShotName[] }[] = [
  {
    q: "Can another hospital see our data?",
    a: "No. Every record carries exactly one organization, and every request proves your membership before it reads or writes anything, including the audit log and uploaded files. There is no shared-tenant path to switch off.",
    features: ["patients"],
  },
  {
    q: "How do staff get accounts?",
    a: "You create them. There is no public sign-up: an administrator creates each account and assigns one or more roles from owner, admin, reception, cashier and accountant. Nobody can register themselves into your hospital.",
    features: ["opd"],
  },
  {
    q: "Does it need the internet?",
    a: "It needs your server, not the public internet. Fonts, styles and scripts are served from the application itself, so a hospital LAN with no outbound connection renders the full interface.",
    features: ["opd"],
  },
  {
    q: "What does it cost?",
    a: "Pricing is coming soon, so there is no public price list yet. Early-bird hospitals agree a price with us directly: call or message us, and a walkthrough ends with a written quote; one afternoon of setup and the desk is on it the next day.",
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
    q: "Is our patient data safe?",
    a: "Encrypted and hosted in India. Every person has their own login and role. Every change to a record or bill is logged.",
  },
  {
    q: "What happens if the internet goes down?",
    a: "[Describe exactly what keeps working offline and how it syncs back when the connection returns.]",
  },
  {
    q: "Can you move our old data?",
    a: "Yes. Patients, doctors, rates, stock and pending bills import from Excel or your current software.",
  },
  {
    q: "Do we need to buy new computers?",
    a: "No. It runs in the browser on what you have, and prints on your existing printers.",
  },
  {
    q: "How long does training take?",
    a: "Each desk is trained on its own screens, at your hospital. Most staff work alone after one shift. We stay for the first busy day.",
  },
];
