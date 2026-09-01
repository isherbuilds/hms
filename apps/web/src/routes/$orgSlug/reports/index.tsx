import { authorize } from "@hms/auth/access";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { REPORT_LINKS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/reports/")({
  head: () => ({ meta: [{ title: "Reports · HMS" }] }),
  component: ReportsIndexRoute,
});

function ReportsIndexRoute() {
  const { orgSlug } = Route.useParams();
  // The sidebar and settings strip filter the same way; this hub was the one list
  // that offered destinations it could not open.
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = REPORT_LINKS.filter(({ permission }) => authorize(roles, permission));

  return (
    <>
      <PageHeader title="Reports" description="Billing ledger and statutory handover" />
      <PageBody>
        <p className="text-muted-foreground">
          These reports cover transactions recorded in this HMS. Opening balances, non-billing
          activity, and final accounts remain in the accountant's books.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {visible.map(({ to, label, description, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              params={{ orgSlug }}
              className="flex min-h-28 flex-col gap-2 p-3 ring-1 ring-border [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="size-3.5" />
                {label}
              </span>
              <span className="text-muted-foreground">{description}</span>
            </Link>
          ))}
        </div>
      </PageBody>
    </>
  );
}
