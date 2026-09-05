import { Link, createFileRoute } from "@tanstack/react-router";

import { PublicPage } from "@/components/landing/public-page";
import { CHANGELOG, formatDate } from "@/content/changelog";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/changelog/")({
  head: () => pageHead({ path: "/changelog" }),
  component: () => (
    <PublicPage title="Changelog" lead="What changed, dated, in the order it shipped.">
      <ol className="flex flex-col divide-y divide-border">
        {CHANGELOG.map((entry) => (
          <li key={entry.slug} className="py-6">
            <Link
              to="/changelog/$slug"
              params={{ slug: entry.slug }}
              className="group flex flex-col gap-2"
            >
              <time dateTime={entry.date} className="text-xs text-muted-foreground">
                {formatDate(entry.date)}
              </time>
              <h2 className="text-xl font-medium tracking-tight text-balance group-hover:underline group-hover:underline-offset-4">
                {entry.title}
              </h2>
              <p className="text-base text-muted-foreground text-pretty">{entry.summary}</p>
            </Link>
          </li>
        ))}
      </ol>
    </PublicPage>
  ),
});
