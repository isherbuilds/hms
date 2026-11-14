import { authorize } from "@hms/auth/access";
import { Outlet, createFileRoute, useMatch } from "@tanstack/react-router";

import { PageTab, PageTabs } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { IPD_TABS } from "@/lib/navigation";

// An admission's own page sits under the Admissions tab, which its URL does not share.
const SHOWN_ACTIVE = { "data-status": "active" } as const;

export const Route = createFileRoute("/$orgSlug/ipd")({
  component: Outlet,
});

export function IpdTabs({ orgSlug }: { orgSlug: string }) {
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = IPD_TABS.filter(({ permission }) => authorize(roles, permission));
  const onAdmission = useMatch({ from: "/$orgSlug/ipd/$admissionId", shouldThrow: false });

  return (
    <PageTabs label="IPD sections">
      {visible.map(({ to, label }) => (
        <PageTab
          key={to}
          to={to}
          params={{ orgSlug }}
          // The board owns every other tab's prefix, so it highlights only on itself.
          activeOptions={to === "/$orgSlug/ipd" ? { exact: true } : undefined}
          inactiveProps={
            onAdmission && to === "/$orgSlug/ipd/admissions" ? SHOWN_ACTIVE : undefined
          }
        >
          {label}
        </PageTab>
      ))}
    </PageTabs>
  );
}
