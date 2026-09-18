import { expect, test } from "bun:test";

import {
  renderRobots,
  renderSitemap,
  shouldDenyIndexing,
} from "../../apps/web/src/lib/public-crawl";

const ORIGIN = "https://hms.example";

const PATHS = ["/", "/billing", "/changelog/opd-desk"];

test("robots.txt disallows only the application prefixes and points at the sitemap", () => {
  const robots = renderRobots(ORIGIN);

  const disallowed = robots
    .split("\n")
    .filter((line) => line.startsWith("Disallow: "))
    .map((line) => line.slice("Disallow: ".length));

  expect(disallowed.sort()).toEqual(["/api/", "/create", "/join", "/login"]);
  expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
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
