/* Crawl-budget rules only (D030). Indexing is denied by `X-Robots-Tag`, not
   here: a `Disallow` stops the fetch, so a crawler never reads a `noindex`, and a
   deny-all rule would keep social scrapers off `/og/`, `/hero/` and `/landing/`. */
export function renderRobots(origin: string): string {
  return [
    "User-agent: *",
    "Disallow: /login",
    "Disallow: /join",
    "Disallow: /create",
    "Disallow: /api/",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function renderSitemap(
  paths: string[],
  origin: string,
  lastmod?: (path: string) => string | undefined,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => {
      const modified = lastmod?.(path);

      return `  <url><loc>${origin}${path}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`;
    }),
    "</urlset>",
    "",
  ].join("\n");
}

export function shouldDenyIndexing(pathname: string, paths: string[]): boolean {
  return !paths.includes(pathname);
}
