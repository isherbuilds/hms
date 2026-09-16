import { StandardRPCJsonSerializer } from "@orpc/client/standard";
import { MutationCache, QueryCache, QueryClient, environmentManager } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "./orpc-error";

// TanStack's default JSON.stringify hash throws on bigint query keys.
const keySerializer = new StandardRPCJsonSerializer();

function statusOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
}

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
  // The last pending write refreshes every mounted query, before its own callbacks (D036).
  const refreshAll = () => {
    if (queryClient.isMutating() === 1) void queryClient.invalidateQueries();
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: recoverFromExpiredSession }),
    mutationCache: new MutationCache({
      onSuccess: refreshAll,
      onError: (error) => {
        refreshAll();
        recoverFromExpiredSession(error);
        toast.error(errorMessage(error, "Could not save. Try again."));
      },
    }),
    defaultOptions: {
      queries: {
        queryKeyHashFn: (queryKey) => {
          const [json, meta] = keySerializer.serialize(queryKey);

          return JSON.stringify({ json, meta });
        },
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

  return queryClient;
}
