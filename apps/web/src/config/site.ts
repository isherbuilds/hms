/* The site's identity and its public surface, in one place. `sitemap.xml`,
   `robots.txt`, the SEO head and the `X-Robots-Tag` middleware all read
   `PUBLIC_ROUTES`, so publishing a page is one edit here (D030).

   No environment access: `scripts/generate-og.ts` imports this from a plain Bun
   process. The origin is supplied by whoever calls. */

export const siteConfig = {
  name: "Edernal Care",
  description:
    "Patient records, OPD, billing and pharmacy in one system for Indian hospitals and clinics.",
  /* The root route's <title>: what an unlisted or non-public route ships with,
     since every public page overrides it via `pageHead`. */
  fallbackTitle: "Edernal Care — hospital management software for Indian hospitals",
} as const;

/* An app page's <title>: the page, then the product. */
export const appHead = (title: string) => ({ meta: [{ title: `${title} · ${siteConfig.name}` }] });

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
    ogImage: "/og/home.png",
  },
  {
    path: "/opd",
    title: "OPD queue management",
    description:
      "OPD queue and outpatient management: token numbers, waiting times and no-shows on one screen — the whole morning at a glance.",
    ogImage: "/og/opd.png",
  },
  {
    path: "/patients",
    title: "Patient records",
    description:
      "Hospital patient records: one MRN per patient, every visit in one place, allergies on top of the record.",
    ogImage: "/og/patients.png",
  },
  {
    path: "/billing",
    title: "Hospital billing, collections and GST",
    description:
      "Hospital billing software with invoices, refunds, cash and bank transfers, and a GST outward register your accountant can work from.",
    ogImage: "/og/billing.png",
  },
  {
    path: "/changelog",
    title: "Changelog",
    description: "What changed in Edernal Care, dated, in the order it shipped.",
    ogImage: "/og/changelog.png",
  },
  {
    path: "/about",
    title: "About",
    description:
      "Edernal Care brings patient records, OPD, billing and pharmacy together for hospitals and clinics.",
    ogImage: "/og/about.png",
  },
  {
    path: "/contact",
    title: "Contact",
    description:
      "Reach the founder at support@edernal.com for Edernal Care demos, support and grievances.",
    ogImage: "/og/contact.png",
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: "What Edernal Care collects, what it does with it, and how to reach us about it.",
    ogImage: "/og/privacy.png",
  },
  {
    path: "/security",
    title: "Data security",
    description:
      "How Edernal Care keeps each hospital's data apart and private: tenancy, roles, audit trail and private files.",
    ogImage: "/og/security.png",
  },
  {
    path: "/terms",
    title: "Terms",
    description: "The terms of use for Edernal Care, in plain language.",
    ogImage: "/og/terms.png",
  },
];
