import { QueryCache, QueryClient, environmentManager } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    // No global query-error toast: every consumer renders its own inline error
    // state, and two competing recovery affordances for one failure is worse
    // than one.
    queryCache: new QueryCache(),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: (failureCount, error: unknown) => {
          if (environmentManager.isServer()) {
            return false;
          }

          const status =
            typeof error === "object" && error !== null && "status" in error
              ? (error as { status?: unknown }).status
              : undefined;

          if (status === 401 || status === 403) {
            return false;
          }

          return failureCount < 2;
        },
      },
    },
  });
}
