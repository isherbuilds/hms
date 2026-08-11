import { authorize, type AppPermission } from "@hms/auth/access";
import { cn } from "@hms/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/lib/orpc";

/**
 * Settings is one destination in the sidebar, not five. Everything an operator
 * configures rather than works in lives behind this layout, and the sub-nav
 * below is the only place those pages are reachable from.
 */
export const SETTINGS_TABS: readonly {
  to:
    | "/org/$orgSlug/settings/organization"
    | "/org/$orgSlug/settings/members"
    | "/org/$orgSlug/settings/staff"
    | "/org/$orgSlug/settings/catalog"
    | "/org/$orgSlug/settings/audit";
  label: string;
  permission: AppPermission;
}[] = [
  {
    to: "/org/$orgSlug/settings/organization",
    label: "Organization",
    // Read is org-wide, but the page is a save form — surface it only to
    // the roles that can actually save.
    permission: { settings: ["update"] },
  },
  {
    to: "/org/$orgSlug/settings/members",
    label: "Members",
    permission: { member: ["read"] },
  },
  {
    to: "/org/$orgSlug/settings/staff",
    label: "Staff",
    permission: { staff: ["update"] },
  },
  {
    to: "/org/$orgSlug/settings/catalog",
    label: "Catalog",
    permission: { catalog: ["update"] },
  },
  {
    to: "/org/$orgSlug/settings/audit",
    label: "Audit",
    permission: { audit: ["read"] },
  },
];

export const Route = createFileRoute("/org/$orgSlug/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { orgSlug } = Route.useParams();
  const membership = useQuery(orpc.members.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data?.roles;
  // Until the roles land, show only what every role can reach, so a tab never
  // appears and then disappears.
  const visible = SETTINGS_TABS.filter(({ permission }) =>
    roles ? authorize(roles, permission) : true,
  );

  return (
    <>
      <nav
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-border px-4 print:hidden"
      >
        {visible.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            params={{ orgSlug }}
            className={cn(
              "-mb-px shrink-0 border-b-2 border-transparent px-2 py-2 text-xs text-muted-foreground transition-colors",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "data-[status=active]:border-foreground data-[status=active]:font-medium data-[status=active]:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
