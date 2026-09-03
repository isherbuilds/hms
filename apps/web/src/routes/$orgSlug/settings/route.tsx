import { authorize } from "@hms/auth/access";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PageTab, PageTabs } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { SETTINGS_TABS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/settings")({
  component: Outlet,
});

export function SettingsTabs({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = SETTINGS_TABS.filter(({ permission }) => authorize(roles, permission));

  return (
    <PageTabs label="Settings sections">
      {visible.map(({ to, label }) => (
        <PageTab key={to} to={to} params={{ orgSlug }}>
          {label}
        </PageTab>
      ))}
    </PageTabs>
  );
}
