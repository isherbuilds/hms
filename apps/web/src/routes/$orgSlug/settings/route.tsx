import { authorize } from "@hms/auth/access";
import { cn } from "@hms/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { SETTINGS_TABS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/$orgSlug/settings")({
  // Nothing but the outlet: the strip belongs to each tab, under its own
  // header band, the way the OPD record tabs do. See `SettingsTabs`.
  component: Outlet,
});

/**
 * The settings strip. Each tab renders it under its own `PageHeader` rather
 * than the layout rendering it above every header: a page owns its title band,
 * and what follows belongs under that band instead of floating above it
 * (docs/design.md §8).
 */
export function SettingsTabs({ orgSlug }: { orgSlug: string }) {
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data.roles;
  const visible = SETTINGS_TABS.filter(({ permission }) => authorize(roles, permission));

  return (
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
  );
}
