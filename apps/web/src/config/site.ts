/* The site's identity and its public surface, in one place. `sitemap.xml`,
   `robots.txt`, the SEO head and the `X-Robots-Tag` middleware all read
   `PUBLIC_ROUTES`, so publishing a page is one edit here (D030).

   No environment access: `scripts/generate-og.ts` imports this from a plain Bun
   process. The origin is supplied by whoever calls. */

export const siteConfig = {
  name: "HMS",
  description:
    "Hospital management software for small and mid-sized Indian hospitals — outpatient queues, patient records and GST billing in one system.",
  /* The root route's <title>: what an unlisted or non-public route ships with,
     since every public page overrides it via `pageHead`. */
  fallbackTitle: "HMS — hospital management software for Indian hospitals",
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
    title: "HMS — the desk software your hospital actually runs on",
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
    description: "What changed in HMS, dated, in the order it shipped.",
    ogImage: "/og/changelog.png",
  },
  {
    path: "/about",
    title: "About",
    description:
      "Why HMS exists: hospital management software for small and mid-sized Indian hospitals, built with one hospital before it is sold to the next.",
    ogImage: "/og/about.png",
  },
  {
    path: "/contact",
    title: "Contact",
    description: "Reach the HMS team on WhatsApp or by email.",
    ogImage: "/og/contact.png",
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: "What HMS collects, what it does with it, and how to reach us about it.",
    ogImage: "/og/privacy.png",
  },
];
