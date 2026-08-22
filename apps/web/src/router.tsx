import { Button, buttonVariants } from "@hms/ui/components/button";
import {
  Link,
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";
import { routeErrorMessage } from "./lib/orpc-error";
import { createQueryClient } from "./lib/query-client";

export const getRouter = () => {
  const queryClient = createQueryClient();

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Query owns caching. Leaving the router's own preload cache on would give
    // the same data two owners with two different ideas of when it went stale.
    defaultPreloadStaleTime: 0,
    context: { queryClient },
    // Loaders await their data; without a pending floor a slow loader leaves
    // the previous page up with nothing to say it is working. The delay is the
    // point: under 800ms TanStack keeps the current route visible, so every
    // hover-preloaded navigation swaps straight across and never sees this.
    defaultPendingMs: 800,
    defaultPendingMinMs: 400,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: DefaultRouteError,
    defaultNotFoundComponent: NotFound,
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

/** Mirrors the page rhythm — header line, then blocks — so that when the real
 *  content lands it replaces this in place instead of reflowing the screen. */
function RoutePending() {
  return (
    <div className="flex flex-col gap-4 p-4" role="status" aria-label="Loading page">
      <div className="h-4 w-40 bg-muted" />
      <div className="h-28 bg-muted" />
      <div className="h-28 bg-muted" />
    </div>
  );
}

function DefaultRouteError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-4 p-4 text-xs">
      <div role="alert" className="flex flex-col gap-1 border-l-2 border-destructive pl-3">
        <p className="font-mono text-xs tracking-widest text-destructive">REQUEST FAILED</p>
        <h1 className="text-sm font-medium">This page could not be loaded</h1>
        <p className="text-muted-foreground">{routeErrorMessage(error, import.meta.env.DEV)}</p>
      </div>

      <Button className="w-fit" variant="outline" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-4 p-4 text-xs">
      <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">404 · ROUTE</p>
        <h1 className="text-sm font-medium">Page not found</h1>
        <p className="text-muted-foreground">The address does not match an HMS page.</p>
      </div>

      <Link className={buttonVariants({ variant: "outline", className: "w-fit" })} to="/">
        Return home
      </Link>
    </main>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
