import { authorize } from "@hms/auth/access";
import { buttonVariants } from "@hms/ui/components/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { SETUP_STEPS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/onboarding")({
  head: () => ({ meta: [{ title: "Set up organization · HMS" }] }),
  component: OrganizationOnboardingRoute,
});

function OrganizationOnboardingRoute() {
  const { orgSlug } = Route.useParams();
  const membership = useMembership(orgSlug);

  const visibleSetup = SETUP_STEPS.filter(({ permission }) =>
    authorize(membership.roles, permission),
  );

  return (
    <>
      <PageHeader title="Setup" />
      <PageBody width="max-w-3xl">
        <section aria-label="Setup steps" className="flex flex-col gap-2">
          <span className="text-muted-foreground tabular-nums">
            {visibleSetup.length} available
          </span>
          <div className="divide-y divide-border border-y border-border">
            {visibleSetup.map(({ label, description, to, icon: Icon }, index) => (
              <Link
                key={to}
                to={to}
                params={{ orgSlug }}
                data-focus-inset
                className="group grid grid-cols-[2rem_1.25rem_minmax(0,1fr)_1rem] items-center gap-3 py-3"
              >
                <span className="font-mono tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground">{description}</span>
                </span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>

        <Link
          to="/$orgSlug/dashboard"
          params={{ orgSlug }}
          className={buttonVariants({ className: "w-fit" })}
        >
          Open dashboard
          <ArrowRightIcon />
        </Link>
      </PageBody>
    </>
  );
}
