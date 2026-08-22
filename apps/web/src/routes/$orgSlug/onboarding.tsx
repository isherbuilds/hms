import { authorize } from "@hms/auth/access";
import { buttonVariants } from "@hms/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page";
import { SETUP_STEPS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/$orgSlug/onboarding")({
  head: () => ({ meta: [{ title: "Set up organization · HMS" }] }),
  component: OrganizationOnboardingRoute,
});

function OrganizationOnboardingRoute() {
  const { orgSlug } = Route.useParams();
  const { data } = useQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const visibleSetup = data
    ? SETUP_STEPS.filter(({ permission }) => authorize(data.roles, permission))
    : [];
  const organizationName =
    data?.organizations.find(({ slug }) => slug === orgSlug)?.name ?? orgSlug;

  return (
    <>
      <PageHeader
        title={`Set up ${organizationName}`}
        description="Start with the details that shape daily work"
      />
      <PageBody className="max-w-3xl">
        <section aria-labelledby="setup-path">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 id="setup-path" className="font-medium">
              Setup path
            </h2>
            <span className="font-mono text-muted-foreground">{visibleSetup.length} available</span>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {visibleSetup.map(({ label, description, to, icon: Icon }, index) => (
              <Link
                key={to}
                to={to}
                params={{ orgSlug }}
                className="group grid grid-cols-[2rem_1.25rem_minmax(0,1fr)_1rem] items-center gap-3 py-3"
              >
                <span className="font-mono text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{label}</span>
                  <span className="mt-0.5 block text-muted-foreground">{description}</span>
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
