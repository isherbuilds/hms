import { env } from "@hms/env/web";
import { createFileRoute } from "@tanstack/react-router";

import { PUBLIC_PATHS } from "@/config/public-paths";
import { CHANGELOG } from "@/content/changelog";
import { renderSitemap } from "@/lib/public-crawl";

/* Changelog entries carry their own publication date; static pages omit
   `lastmod` rather than claim a build time that means nothing. */
function lastmod(path: string): string | undefined {
  const slug = path.startsWith("/changelog/") ? path.slice("/changelog/".length) : undefined;

  return slug ? CHANGELOG.find((entry) => entry.slug === slug)?.date : undefined;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(renderSitemap(PUBLIC_PATHS, env.VITE_WEB_URL, lastmod), {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        }),
    },
  },
});
