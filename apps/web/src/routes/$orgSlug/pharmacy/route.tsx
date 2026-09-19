import { authorize } from "@hms/auth/access";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PageTab, PageTabs } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { PHARMACY_TABS } from "@/lib/navigation";

export const Route = createFileRoute("/$orgSlug/pharmacy")({
  component: Outlet,
});

export function PharmacyTabs({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = PHARMACY_TABS.filter(({ permission }) => authorize(roles, permission));

  return (
    <PageTabs label="Pharmacy sections">
      {visible.map(({ to, label }) => (
        <PageTab
          key={to}
          to={to}
          params={{ orgSlug }}
          // The sales list owns every other tab’s prefix, so it highlights only on itself.
          activeOptions={to === "/$orgSlug/pharmacy" ? { exact: true } : undefined}
        >
          {label}
        </PageTab>
      ))}
    </PageTabs>
  );
}
