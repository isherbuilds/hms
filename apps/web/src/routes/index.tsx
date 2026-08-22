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
  loader: ({ context }) => context.queryClient.prefetchQuery(healthQuery),
});

function HomeRoute() {
  const health = useQuery(healthQuery);
  const reachable = health.data === "OK";

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="text-sm font-medium">HMS</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A multi-tenant base for data-intensive internal software. Every record belongs to exactly
          one organization, and every request proves membership.
        </p>
      </div>

      <div className="flex items-center gap-2 p-3 text-xs ring-1 ring-border">
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

      <Button nativeButton={false} render={<Link to="/join" />}>
        Open an organization
      </Button>
    </div>
  );
}
