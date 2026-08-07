import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FileIcon, UsersIcon, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/dashboard")({
  // Fire-and-forget: starts the fetch on link hover (`defaultPreload:
  // "intent"`) without blocking navigation on it.
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchQuery(orpc.dashboard.summary.queryOptions({ input: { orgSlug } }));
  },
  component: DashboardRoute,
});

/**
 * A count that is also the way in. Every tile states what it counts in words,
 * so the number is never the only thing carrying meaning.
 */
function Tile({
  to,
  orgSlug,
  label,
  icon: Icon,
  value,
  pending,
}: {
  to: "/org/$orgSlug/files" | "/org/$orgSlug/members";
  orgSlug: string;
  label: string;
  icon: LucideIcon;
  value: number | undefined;
  pending: boolean;
}) {
  return (
    <Link
      to={to}
      params={{ orgSlug }}
      className="flex flex-col gap-2 p-3 ring-1 ring-border [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="text-lg font-medium tabular-nums">{pending ? "—" : (value ?? "—")}</span>
    </Link>
  );
}

function DashboardRoute() {
  const session = authClient.useSession();
  const { orgSlug } = Route.useParams();
  const summary = useQuery(orpc.dashboard.summary.queryOptions({ input: { orgSlug } }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={session.data ? `Signed in as ${session.data.user.email}` : undefined}
      />

      {summary.isError && (
        <div role="alert" className="mx-4 mt-4 border-l-2 border-destructive pl-3 text-xs">
          <p className="font-medium">Could not load these counts</p>
          <p className="mt-0.5 text-muted-foreground">{summary.error.message}</p>
        </div>
      )}

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Tile
          to="/org/$orgSlug/files"
          orgSlug={orgSlug}
          label="Files"
          icon={FileIcon}
          value={summary.data?.files}
          pending={summary.isPending}
        />
        <Tile
          to="/org/$orgSlug/members"
          orgSlug={orgSlug}
          label="People"
          icon={UsersIcon}
          value={summary.data?.people}
          pending={summary.isPending}
        />
      </div>
    </>
  );
}
