import { authorize } from "@hms/auth/access";
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
  SidebarRail,
} from "@hms/ui/components/sidebar";
import { TooltipProvider } from "@hms/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { ClientOnly, Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon, LogInIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { type ReactNode } from "react";

import { Monogram } from "@/components/monogram";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import { useMembership } from "@/lib/membership";
import { NAV_GROUPS, PRIMARY_NAV, SETTINGS_PERMISSIONS } from "@/lib/navigation";

function OrgSwitcher({ activeOrgSlug }: { activeOrgSlug: string }) {
  const organizations = useMembership(activeOrgSlug, (membership) => membership.organizations);
  const name =
    organizations.find((org) => org.slug === activeOrgSlug)?.name ?? "Unknown organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" tooltip={name} />}
        className="justify-between gap-2"
      >
        <Monogram label={name} tone="accent" />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              render={<Link to="/$orgSlug/dashboard" params={{ orgSlug: org.slug }} />}
              disabled={org.slug === activeOrgSlug}
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.slug === activeOrgSlug && <CheckIcon className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/join" />} className="gap-2">
          <LogInIcon className="size-3.5" />
          Join organization
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/create" />} className="gap-2">
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserFooter({ orgSlug }: { orgSlug: string }) {
  const user = useMembership(orgSlug, (membership) => membership.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" tooltip={user.email} />}
        className="justify-start gap-2"
      >
        <Monogram label={user.name || user.email} />
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate font-medium">{user.name || user.email}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {user.email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onClick={() => {
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  // Query keys partition by org, not by user: without this the next account signed
                  // in on this tab reads the previous one's cached responses.
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
  // The `/$orgSlug` loader awaits `member.me` before this renders, so the roles are
  // already cached: no pending nav that shows every link and then removes some.
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = PRIMARY_NAV.filter(({ permission }) => authorize(roles, permission));
  const showSettings = SETTINGS_PERMISSIONS.some((permission) => authorize(roles, permission));

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrgSwitcher activeOrgSlug={orgSlug} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
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
                        className="[&_svg]:text-muted-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground data-[status=active]:[&_svg]:text-foreground"
                        render={
                          <Link to={to} params={{ orgSlug }} preload="intent" preloadDelay={0} />
                        }
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
                className="data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground data-[status=active]:[&_svg]:text-foreground"
                render={
                  <Link
                    to="/$orgSlug/settings"
                    params={{ orgSlug }}
                    preload="intent"
                    preloadDelay={0}
                  />
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
            <UserFooter orgSlug={orgSlug} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function AppShell({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden print:h-auto print:overflow-visible">
        <ClientOnly fallback={<div className="hidden w-64 shrink-0 bg-sidebar lg:block" />}>
          <OrgSidebar orgSlug={orgSlug} />
        </ClientOnly>
        <SidebarInset className="min-w-0 overflow-hidden print:overflow-visible">
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
