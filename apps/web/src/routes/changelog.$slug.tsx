import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CHANGELOG, formatDate } from "@/content/changelog";
import { changelogEntryHead } from "@/lib/seo";

export const Route = createFileRoute("/changelog/$slug")({
  loader: async ({ params }) => {
    const { CHANGELOG } = await import("@/content/changelog");
    const entry = CHANGELOG.find((candidate) => candidate.slug === params.slug);

    if (!entry) throw notFound();

    // Components do not serialize; the page re-resolves the entry by slug.
    return { slug: entry.slug, title: entry.title, summary: entry.summary, date: entry.date };
  },
  head: ({ loaderData }) => (loaderData ? changelogEntryHead(loaderData) : {}),
  component: ChangelogEntryRoute,
});

function ChangelogEntryRoute() {
  const { slug } = Route.useLoaderData();
  const entry = CHANGELOG.find((candidate) => candidate.slug === slug);

  if (!entry) throw notFound();

  return (
    <PublicPage
      eyebrow={`${formatDate(entry.date)} · Changelog`}
      title={entry.title}
      lead={entry.summary}
    >
      <div className={PROSE}>
        <entry.Content />
      </div>
      <Link to="/changelog" className="text-sm underline-offset-4 hover:underline">
        ← All changes
      </Link>
    </PublicPage>
  );
}
