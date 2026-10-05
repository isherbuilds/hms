import { expect, test } from "bun:test";

import {
  renderRobots,
  renderSitemap,
  shouldDenyIndexing,
} from "../../apps/web/src/lib/public-crawl";

const ORIGIN = "https://hms.example";

const PATHS = ["/", "/billing", "/changelog/opd-desk"];

test("robots.txt preserves search crawl rules and opts training/dataset agents out", () => {
  const [search, training] = renderRobots(ORIGIN).split("\n\n");
  expect(search).toBe(
    "User-agent: *\nDisallow: /login\nDisallow: /join\nDisallow: /create\nDisallow: /api/\nAllow: /",
  );
  expect(training).toBe(
    [
      "User-agent: GPTBot",
      "User-agent: CCBot",
      "User-agent: Google-Extended",
      "User-agent: ClaudeBot",
      "User-agent: anthropic-ai",
      "User-agent: Applebot-Extended",
      "User-agent: Bytespider",
      "User-agent: meta-externalagent",
      "Disallow: /",
    ].join("\n"),
  );
  expect(renderRobots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
});

test("sitemap.xml lists exactly the public paths as absolute URLs", () => {
  const locs = [...renderSitemap(PATHS, ORIGIN).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([`${ORIGIN}/`, `${ORIGIN}/billing`, `${ORIGIN}/changelog/opd-desk`]);
});

test("indexing is denied for every path outside the public list (D030)", () => {
  for (const path of ["/mercy-general", "/mercy-general/opd", "/login", "/changelog/unknown"]) {
    expect(shouldDenyIndexing(path, PATHS)).toBe(true);
  }

  for (const path of PATHS) {
    expect(shouldDenyIndexing(path, PATHS)).toBe(false);
  }
});
