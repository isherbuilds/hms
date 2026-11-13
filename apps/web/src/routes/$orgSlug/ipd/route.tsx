import { authorize } from "@hms/auth/access";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PageTab, PageTabs } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { IPD_TABS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/ipd")({
  component: Outlet,
});

export function IpdTabs({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = IPD_TABS.filter(({ permission }) => authorize(roles, permission));

  return (
    <PageTabs label="IPD sections">
      {visible.map(({ to, label }) => (
        <PageTab
          key={to}
          to={to}
          params={{ orgSlug }}
          // The board owns every other tab's prefix, so it highlights only on itself.
          activeOptions={to === "/$orgSlug/ipd" ? { exact: true } : undefined}
        >
          {label}
        </PageTab>
      ))}
    </PageTabs>
  );
}
