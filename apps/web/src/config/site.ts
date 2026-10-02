/* The site's identity and its public surface, in one place. `sitemap.xml`,
   `robots.txt`, the SEO head and the `X-Robots-Tag` middleware all read
   `PUBLIC_ROUTES`, so publishing a page is one edit here (D030).

   No environment access: `scripts/generate-og.ts` imports this from a plain Bun
   process. The origin is supplied by whoever calls. */

export const siteConfig = {
  name: "Edernal Care",
  description:
    "OPD, IPD, billing, pharmacy and lab on one simple system, built for Indian hospitals and clinics.",
  /* The root route's <title>: what an unlisted or non-public route ships with,
     since every public page overrides it via `pageHead`. */
  fallbackTitle: "Edernal Care — hospital management software for Indian hospitals",
} as const;

export const OG_IMAGE = { width: 1200, height: 630 } as const;

export type PublicRoute = {
  path: string;
  title: string;
  description: string;
  ogImage: string;
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: "/",
    title: "Edernal Care — hospital management software for Indian hospitals",
    description: siteConfig.description,
    ogImage: "/og/home.webp",
  },
  {
    path: "/opd",
    title: "OPD queue management",
    description:
      "OPD queue and outpatient management: token numbers, waiting times and no-shows on one screen — the whole morning at a glance.",
    ogImage: "/og/opd.webp",
  },
  {
    path: "/patients",
    title: "Patient records",
    description:
      "Hospital patient records: one MRN per patient, every visit in one place, allergies on top of the record.",
    ogImage: "/og/patients.webp",
  },
  {
    path: "/billing",
    title: "Hospital billing, collections and GST",
    description:
      "Hospital billing software with invoices, refunds, cash and bank transfers, and a GST outward register your accountant can work from.",
    ogImage: "/og/billing.webp",
  },
  {
    path: "/changelog",
    title: "Changelog",
    description: "What changed in Edernal Care, dated, in the order it shipped.",
    ogImage: "/og/changelog.webp",
  },
  {
    path: "/about",
    title: "About",
    description:
      "Why Edernal Care exists: hospital management software for small and mid-sized Indian hospitals, built with one hospital before it is sold to the next.",
    ogImage: "/og/about.webp",
  },
  {
    path: "/contact",
    title: "Contact",
    description: "Reach the Edernal Care team on WhatsApp or by email.",
    ogImage: "/og/contact.webp",
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: "What Edernal Care collects, what it does with it, and how to reach us about it.",
    ogImage: "/og/privacy.webp",
  },
  {
    path: "/security",
    title: "Data security",
    description:
      "How Edernal Care keeps each hospital's data apart and private: tenancy, roles, audit trail and private files.",
    ogImage: "/og/security.webp",
  },
  {
    path: "/terms",
    title: "Terms",
    description: "The terms of use for Edernal Care, in plain language.",
    ogImage: "/og/terms.webp",
  },
  {
    path: "/customers",
    title: "Customers",
    description: "Where Edernal Care is used today, and how to become the next hospital.",
    ogImage: "/og/customers.webp",
  },
  {
    path: "/careers",
    title: "Careers",
    description: "Working on Edernal Care: how the team works and how to get in touch.",
    ogImage: "/og/careers.webp",
  },
  {
    path: "/status",
    title: "Status",
    description: "How Edernal Care tells hospitals about outages and planned downtime.",
    ogImage: "/og/status.webp",
  },
];
