import { env } from "@hms/env/web";

import { OG_IMAGE, PUBLIC_ROUTES, siteConfig } from "@/config/site";
import { FAQS } from "@/content/faqs";

type JsonLd = Record<string, unknown>;

function jsonLdScript(json: JsonLd) {
  // JSON.stringify output contains no `<` unless a value does; escaping it
  // keeps the script element unbreakable by any future copy.
  return {
    type: "application/ld+json",
    children: JSON.stringify(json).replace(/</g, "\\u003c"),
  };
}

function head(
  path: string,
  page: {
    title: string;
    description: string;
    ogImage: string;
    type: "website" | "article";
    jsonLd?: JsonLd[];
  },
) {
  const origin = env.VITE_WEB_URL;
  const url = `${origin}${path}`;
  const title = path === "/" ? page.title : `${page.title} | ${siteConfig.name}`;

  return {
    meta: [
      { title },
      { name: "description", content: page.description },
      { property: "og:type", content: page.type },
      { property: "og:site_name", content: siteConfig.name },
      { property: "og:title", content: title },
      { property: "og:description", content: page.description },
      { property: "og:url", content: url },
      { property: "og:image", content: `${origin}${page.ogImage}` },
      { property: "og:image:width", content: String(OG_IMAGE.width) },
      { property: "og:image:height", content: String(OG_IMAGE.height) },
      { property: "og:image:alt", content: title },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts: (page.jsonLd ?? []).map(jsonLdScript),
  };
}

/* The site-wide entity graph, carried by the homepage: Organization so answer
   engines can resolve what "HMS" is (the name alone collides with the
   category's own acronym), WebSite naming the site. No `sameAs` until a social
   profile actually exists. */
function siteGraph(): JsonLd[] {
  const origin = env.VITE_WEB_URL;

  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: siteConfig.name,
      url: origin,
      description: siteConfig.description,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.name,
      url: origin,
      publisher: { "@id": `${origin}/#organization` },
    },
  ];
}

/* The homepage's machine-readable claims: what the software is, who it is for,
   and the FAQ — serialized from the same `FAQS` list the page renders, so an
   answer engine can never quote an answer the page does not carry. No price is
   stated because none is public; `offers` stays out until one is. */
function homeGraph(): JsonLd[] {
  const origin = env.VITE_WEB_URL;

  return [
    ...siteGraph(),
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: siteConfig.name,
      applicationCategory: "HealthApplication",
      applicationSubCategory: "Hospital management software",
      operatingSystem: "Web",
      url: origin,
      description: siteConfig.description,
      inLanguage: "en-IN",
      audience: {
        "@type": "BusinessAudience",
        audienceType: "Small and mid-sized hospitals in India",
      },
      provider: { "@id": `${origin}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

/* The `head()` of every static public page. Reads the page's entry from
   `PUBLIC_ROUTES` and throws for an unlisted path, so a page cannot ship with
   silently missing meta. The title is bare on `/` and templated everywhere else. */
export function pageHead({ path }: { path: string }) {
  const route = PUBLIC_ROUTES.find((entry) => entry.path === path);

  if (!route) throw new Error(`${path} is not in PUBLIC_ROUTES`);

  return head(path, { ...route, type: "website", jsonLd: path === "/" ? homeGraph() : undefined });
}

/* The `head()` of one changelog entry. Entries share the changelog's card: four
   static cards did not justify a request-time renderer, and a dated post does not
   change that arithmetic. The Article schema makes each entry a dated, authored
   page to crawlers and answer engines. */
export function changelogEntryHead(entry: {
  slug: string;
  title: string;
  summary: string;
  date: string;
}) {
  const changelog = PUBLIC_ROUTES.find((route) => route.path === "/changelog");

  if (!changelog) throw new Error("/changelog is not in PUBLIC_ROUTES");
  const origin = env.VITE_WEB_URL;

  return head(`/changelog/${entry.slug}`, {
    title: entry.title,
    description: entry.summary,
    ogImage: changelog.ogImage,
    type: "article",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: entry.title,
        description: entry.summary,
        datePublished: entry.date,
        dateModified: entry.date,
        inLanguage: "en-IN",
        author: { "@id": `${origin}/#organization` },
        publisher: { "@id": `${origin}/#organization` },
        mainEntityOfPage: `${origin}/changelog/${entry.slug}`,
      },
    ],
  });
}
