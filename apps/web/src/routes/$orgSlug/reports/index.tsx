import { authorize } from "@hms/auth/access";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { PageBody, PageHeader, Panel } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { REPORT_LINKS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/reports/")({
  head: () => ({ meta: [{ title: "Reports · HMS" }] }),
  component: ReportsIndexRoute,
});

function ReportsIndexRoute() {
  const { orgSlug } = Route.useParams();
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = REPORT_LINKS.filter(({ permission }) => authorize(roles, permission));

  return (
    <>
      <PageHeader title="Reports" />
      <PageBody width="max-w-4xl">
        <Panel label="Available reports">
          <nav aria-label="Available reports">
            <ul className="divide-y divide-border">
              {visible.map(({ to, icon: Icon, label, description }) => (
                <li key={to}>
                  <Link
                    to={to}
                    params={{ orgSlug }}
                    data-focus-inset
                    className="flex items-start gap-3 px-3 py-4 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-medium">{label}</span>
                      <span className="text-pretty leading-relaxed text-muted-foreground">
                        {description}
                      </span>
                    </span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 self-center text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Panel>
        <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
          These reports cover transactions recorded in this HMS. Opening balances, non-billing
          activity, and final accounts remain in the accountant's books.
        </p>
      </PageBody>
    </>
  );
}
