import { authorize, type AppPermission } from "@hms/auth/access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@hms/ui/components/sidebar";
import { Skeleton } from "@hms/ui/components/skeleton";
import { TooltipProvider } from "@hms/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChartColumnIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  ClipboardPlusIcon,
  FileIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  LogOutIcon,
  ReceiptTextIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { PageHeaderSlot } from "@/components/page";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

/**
 * Sections, in the order a front desk works through them. The group is part of
 * the model rather than the markup so a new destination lands in the right
 * block by declaring one field.
 *
 * Everything an operator *configures* rather than *works in* lives behind
 * Settings, which owns its own sub-nav — see
 * `routes/org/$orgSlug/settings/route.tsx`. Adding a configuration page means
 * adding a tab there, not another line here.
 */
const GROUPS = ["Clinical", "Money", "Workspace"] as const;
type NavGroup = (typeof GROUPS)[number];

const NAV: readonly {
  to:
    | "/org/$orgSlug/dashboard"
    | "/org/$orgSlug/files"
    | "/org/$orgSlug/front-desk"
    | "/org/$orgSlug/front-desk/queue"
    | "/org/$orgSlug/billing"
    | "/org/$orgSlug/reports"
    | "/org/$orgSlug/ai";
  label: string;
  icon: typeof FileIcon;
  group: NavGroup;
  permission: AppPermission;
}[] = [
  {
    to: "/org/$orgSlug/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    group: "Clinical",
    permission: { member: ["read"] },
  },
  {
    to: "/org/$orgSlug/front-desk",
    label: "Front desk",
    icon: ClipboardPlusIcon,
    group: "Clinical",
    permission: { patient: ["read"] },
  },
  {
    to: "/org/$orgSlug/front-desk/queue",
    label: "Queue",
    icon: ListOrderedIcon,
    group: "Clinical",
    permission: { visit: ["read"] },
  },
  {
    to: "/org/$orgSlug/billing",
    label: "Billing",
    icon: ReceiptTextIcon,
    group: "Money",
    permission: { billing: ["read"] },
  },
  {
    to: "/org/$orgSlug/reports",
    label: "Reports",
    icon: ChartColumnIcon,
    group: "Money",
    permission: { report: ["read"] },
  },
  {
    to: "/org/$orgSlug/files",
    label: "Files",
    icon: FileIcon,
    group: "Workspace",
    permission: { storage: ["read"] },
  },
  {
    to: "/org/$orgSlug/ai",
    label: "AI",
    icon: SparklesIcon,
    group: "Workspace",
    permission: { ai: ["use"] },
  },
];

/**
 * Settings is reachable by anyone who can see at least one of its tabs, so the
 * entry does not vanish for a role that can read members but not save settings.
 */
const SETTINGS_PERMISSIONS: readonly AppPermission[] = [
  { settings: ["update"] },
  { member: ["read"] },
  { staff: ["update"] },
  { catalog: ["update"] },
  { audit: ["read"] },
];

function OrgSwitcher({ activeOrgSlug }: { activeOrgSlug: string }) {
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) {
    return <Skeleton className="h-8 w-full" />;
  }

  const active = organizations?.find((org) => org.slug === activeOrgSlug);
  const name = active?.name ?? "Unknown organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton tooltip={name} />}
        className="justify-between gap-2"
      >
        <span className="min-w-0 truncate font-medium">{name}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {organizations?.map((org) => (
            <DropdownMenuItem
              key={org.id}
              render={
                <Link
                  to="/org/$orgSlug/dashboard"
                  params={{ orgSlug: org.slug }}
                />
              }
              disabled={org.slug === activeOrgSlug}
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.slug === activeOrgSlug && (
                <CheckIcon className="size-3.5 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/onboarding" />} className="gap-2">
          <PlusIcon className="size-3.5" />
          New organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserFooter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  if (!session) {
    return <Skeleton className="h-8 w-full" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton tooltip={session.user.email} />}
        className="justify-start"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {session.user.email}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{session.user.name}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onClick={() => {
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  // Query keys partition by org, not by user. Without this the
                  // next account signed in on this tab reads the previous
                  // one's cached responses.
                  queryClient.clear();
                  navigate({ to: "/login" });
                },
              },
            });
          }}
        >
          <LogOutIcon className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrgSidebar({ orgSlug }: { orgSlug: string }) {
  const membership = useQuery(
    orpc.members.me.queryOptions({ input: { orgSlug } }),
  );
  const roles = membership.data?.roles;
  // Until the roles land, show only what every role can reach, so a link never
  // appears and then disappears.
  const visible = NAV.filter(({ permission }) =>
    roles ? authorize(roles, permission) : true,
  );
  const showSettings = roles
    ? SETTINGS_PERMISSIONS.some((permission) => authorize(roles, permission))
    : true;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrgSwitcher activeOrgSlug={orgSlug} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => {
          const items = visible.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      {/* The router already stamps `data-status="active"` on the
                          rendered link, so the active style keys off that rather
                          than a second source of truth. */}
                      <SidebarMenuButton
                        tooltip={label}
                        className="data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
                        render={<Link to={to} params={{ orgSlug }} />}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {showSettings && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Settings"
                className="data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
                render={
                  <Link to="/org/$orgSlug/settings" params={{ orgSlug }} />
                }
              >
                <SettingsIcon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserFooter />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppShell({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  // The page title portals into this node, so the app bar carries it instead of
  // the page paying for a second band of chrome underneath.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden print:h-auto print:overflow-visible">
        <OrgSidebar orgSlug={orgSlug} />
        <SidebarInset className="min-w-0 overflow-hidden print:overflow-visible">
          {/* One control, all breakpoints: it collapses the rail on desktop and
              opens the sheet on mobile, so there is never a second affordance
              to keep in sync. */}
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 print:hidden">
            <SidebarTrigger />
            <div
              ref={setHeaderSlot}
              className="flex min-w-0 flex-1 items-center"
            />
          </header>

          <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible">
            <PageHeaderSlot.Provider value={headerSlot}>
              {children}
            </PageHeaderSlot.Provider>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
