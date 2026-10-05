/* D030: indexing remains controlled by X-Robots-Tag, not crawl rules.
   D062: search/social discovery stays allowed; training/dataset use is opted out. */
export function renderRobots(origin: string): string {
  return [
    "User-agent: *",
    "Disallow: /login",
    "Disallow: /join",
    "Disallow: /create",
    "Disallow: /api/",
    "Allow: /",
    "",
    "User-agent: GPTBot",
    "User-agent: CCBot",
    "User-agent: Google-Extended",
    "User-agent: ClaudeBot",
    "User-agent: anthropic-ai",
    "User-agent: Applebot-Extended",
    "User-agent: Bytespider",
    "User-agent: meta-externalagent",
    "Disallow: /",
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
