import { authorize } from "@hms/auth/access";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PageTab, PageTabs } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { THEATRE_TABS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/theatre")({
  component: Outlet,
});

export function TheatreTabs({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = THEATRE_TABS.filter(({ permission }) => authorize(roles, permission));

  // One tab is no choice.
  if (visible.length < 2) return null;

  return (
    <PageTabs label="Theatre sections">
      {visible.map(({ to, label }) => (
        <PageTab
          key={to}
          to={to}
          params={{ orgSlug }}
          // The schedule owns the other tab's prefix, so it highlights only on itself.
          activeOptions={to === "/$orgSlug/theatre" ? { exact: true } : undefined}
        >
          {label}
        </PageTab>
      ))}
    </PageTabs>
  );
}
