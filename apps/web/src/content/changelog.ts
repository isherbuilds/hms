import type { ComponentType } from "react";

/* Changelog entries are `.mdx` files beside this module. Each exports `meta`
   and a default component; the filename is the slug. Vite compiles them at
   build time, so the list is static and the routes it feeds are known to the
   sitemap and the indexing middleware without a filesystem read at runtime. */

export type ChangelogMeta = {
  title: string;
  /* ISO date, `YYYY-MM-DD`. */
  date: string;
  summary: string;
};

export type ChangelogEntry = ChangelogMeta & {
  slug: string;
  Content: ComponentType;
};

const modules = import.meta.glob<{ meta: ChangelogMeta; default: ComponentType }>(
  "./changelog/*.mdx",
  { eager: true },
);

export const CHANGELOG: ChangelogEntry[] = Object.entries(modules)
  .map(([path, mod]) => ({
    ...mod.meta,
    slug: path.slice("./changelog/".length, -".mdx".length),
    Content: mod.default,
  }))
  .sort((a, b) => (a.date < b.date ? 1 : -1));

/* `2026-09-03` → `3 Sept 2026`, the form the product's own dates print in. */
export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
