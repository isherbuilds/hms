import { authorize, type AppPermission } from "@better-stack/auth/access";
import { Button } from "@better-stack/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-stack/ui/components/dropdown-menu";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { cn } from "@better-stack/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  ClipboardPlusIcon,
  FileIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  SparklesIcon,
  StethoscopeIcon,
  TagsIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

const NAV: readonly {
  to:
    | "/org/$orgSlug/dashboard"
    | "/org/$orgSlug/admin/settings"
    | "/org/$orgSlug/admin/catalog"
    | "/org/$orgSlug/admin/staff"
    | "/org/$orgSlug/files"
    | "/org/$orgSlug/front-desk"
    | "/org/$orgSlug/ai"
    | "/org/$orgSlug/members"
    | "/org/$orgSlug/audit";
  label: string;
  icon: typeof FileIcon;
  permission: AppPermission;
}[] = [
  {
    to: "/org/$orgSlug/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    permission: { member: ["read"] },
  },
  {
    to: "/org/$orgSlug/front-desk",
    label: "Front desk",
    icon: ClipboardPlusIcon,
    permission: { patient: ["read"] },
  },
  {
    to: "/org/$orgSlug/files",
    label: "Files",
    icon: FileIcon,
    permission: { storage: ["read"] },
  },
  {
    to: "/org/$orgSlug/ai",
    label: "AI",
    icon: SparklesIcon,
    permission: { ai: ["use"] },
  },
  {
    to: "/org/$orgSlug/members",
    label: "Members",
    icon: UsersIcon,
    permission: { member: ["read"] },
  },
  {
    to: "/org/$orgSlug/audit",
    label: "Audit",
    icon: ScrollTextIcon,
    permission: { audit: ["read"] },
  },
  {
    to: "/org/$orgSlug/admin/catalog",
    label: "Catalog",
    icon: TagsIcon,
    // Read is org-wide, but this page is admin CRUD — surface it only to
    // the roles that can actually change the catalog.
    permission: { catalog: ["update"] },
  },
  {
    to: "/org/$orgSlug/admin/staff",
    label: "Staff",
    icon: StethoscopeIcon,
    permission: { staff: ["update"] },
  },
  {
    to: "/org/$orgSlug/admin/settings",
    label: "Settings",
    icon: SettingsIcon,
    // Read is org-wide, but the page is a save form — surface it only to
    // the roles that can actually save.
    permission: { settings: ["update"] },
  },
];

function OrgSwitcher({
  activeOrgSlug,
  onNavigate,
}: {
  activeOrgSlug: string;
  onNavigate?: () => void;
}) {
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) {
    return <Skeleton className="h-10 w-full" />;
  }

  const active = organizations?.find((org) => org.slug === activeOrgSlug);
  const name = active?.name ?? "Unknown organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="lg" />}
        className="h-10 w-full justify-between gap-2 px-2"
      >
        <span className="min-w-0 truncate text-xs font-medium">{name}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {organizations?.map((org) => (
            <DropdownMenuItem
              key={org.id}
              render={<Link to="/org/$orgSlug/dashboard" params={{ orgSlug: org.slug }} />}
              disabled={org.slug === activeOrgSlug}
              onClick={onNavigate}
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.slug === activeOrgSlug && <CheckIcon className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/onboarding" />} onClick={onNavigate} className="gap-2">
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
    return <Skeleton className="h-10 w-full" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="lg" />}
        className="h-10 w-full justify-start gap-2 px-2"
      >
        <span className="min-w-0 flex-1 truncate text-left text-xs">{session.user.email}</span>
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

function SidebarBody({
  activeOrgSlug,
  onNavigate,
}: {
  activeOrgSlug: string;
  onNavigate?: () => void;
}) {
  const membership = useQuery(orpc.members.me.queryOptions({ input: { orgSlug: activeOrgSlug } }));
  const roles = membership.data?.roles;
  // Until the roles land, show only what every role can reach, so a link never
  // appears and then disappears.
  const visible = NAV.filter(({ permission }) => (roles ? authorize(roles, permission) : true));

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar p-2">
      <OrgSwitcher activeOrgSlug={activeOrgSlug} onNavigate={onNavigate} />
      <nav className="mt-2 flex flex-1 flex-col gap-0.5">
        {visible.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            params={{ orgSlug: activeOrgSlug }}
            onClick={onNavigate}
            className={cn(
              "flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground transition-colors",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <UserFooter />
    </div>
  );
}

export function AppShell({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  return (
    <div className="flex h-svh overflow-hidden">
      {/* One sidebar instance: a drawer below md, a static rail from md up.
          The drawer stays translated off-screen until opened; the backdrop is
          rendered only while it is open. */}
      <aside
        id="mobile-nav"
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] border-r border-border",
          "md:static md:z-auto md:w-56 md:max-w-none md:shrink-0",
          mobileNavOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full max-md:invisible",
        )}
      >
        <SidebarBody activeOrgSlug={orgSlug} onNavigate={() => setMobileNavOpen(false)} />
      </aside>

      {mobileNavOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The one control both opens and closes the drawer, and stays above it
            so it never doubles up with a second close affordance. */}
        <header className="sticky top-0 z-50 flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav"
          >
            {mobileNavOpen ? <XIcon /> : <MenuIcon />}
          </Button>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/** Consistent page chrome: title, optional count line, optional action. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h1 className="cn-font-heading text-sm font-medium">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
