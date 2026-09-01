import { MutationCache, QueryCache, QueryClient, environmentManager } from "@tanstack/react-query";

function statusOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
}

// Pages render their own errors; only an expired session needs global recovery.
// Both caches call this, so a form-only screen does not toast forever.
function recoverFromExpiredSession(error: unknown): void {
  if (environmentManager.isServer() || statusOf(error) !== 401) {
    return;
  }
  if (window.location.pathname !== "/login") {
    const here = window.location.pathname + window.location.search;
    window.location.href = `/login?redirect=${encodeURIComponent(here)}`;
  }
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: recoverFromExpiredSession }),
    mutationCache: new MutationCache({ onError: recoverFromExpiredSession }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: (failureCount, error: unknown) => {
          if (environmentManager.isServer()) {
            return false;
          }

          const status = statusOf(error);
          if (status === 401 || status === 403) {
            return false;
          }

          return failureCount < 2;
        },
      },
    },
  });
}
