import { Button } from "@hms/ui/components/button";
import { env } from "@hms/env/web";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

const healthQuery = queryOptions({
  queryKey: ["server", "health"],
  queryFn: async () => {
    const response = await fetch(new URL("/", env.VITE_SERVER_URL));
    if (!response.ok) {
      throw new Error(`API health check failed (${response.status})`);
    }
    return await response.text();
  },
});

export const Route = createFileRoute("/")({
  component: HomeRoute,
  loader: ({ context }) =>
    context.queryClient.fetchQuery(healthQuery).then(
      () => {},
      () => {},
    ),
});

function HomeRoute() {
  const health = useQuery(healthQuery);
  const reachable = health.data === "OK";

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-4 p-4 text-xs">
      <div className="flex flex-col gap-1">
        <h1 className="text-sm font-medium">HMS</h1>
        <p className="text-muted-foreground">
          A multi-tenant base for data-intensive internal software. Every record belongs to exactly
          one organization, and every request proves membership.
        </p>
      </div>

      {/* One status line groups nothing, so it earns hairlines rather than a
          box or a tray: flat is the default (docs/design.md §1). */}
      <div className="flex min-h-9 items-center gap-2 border-y border-border">
        {/* Colour is reserved for tenant identity, so a healthy state is
            neutral — only a genuine fault earns the destructive tone. */}
        <span
          aria-hidden
          className={`size-1.5 shrink-0 ${
            health.isPending
              ? "bg-muted-foreground"
              : reachable
                ? "bg-foreground"
                : "bg-destructive"
          }`}
        />
        <span className="text-muted-foreground">
          {health.isPending ? "Checking API…" : reachable ? "API reachable" : "API unreachable"}
        </span>
      </div>

      <Button size="lg" nativeButton={false} render={<Link to="/join" />}>
        Open an organization
      </Button>
    </div>
  );
}
