import { Button } from "@hms/ui/components/button";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const TICK_MS = 5_000;

// Starts at 0 so the server and the hydrating client render the same text.
function useNow(): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

/**
 * Reading `dataUpdatedAt` off a `useQuery` result marks it tracked, which
 * re-renders the whole page on every poll even when the data came back
 * identical. Subscribing to the cache keeps that churn inside this badge.
 */
function useDataUpdatedAt(queryKeys: readonly QueryKey[]): number {
  const queryCache = useQueryClient().getQueryCache();
  const subscribe = useCallback(
    (listener: () => void) => queryCache.subscribe(listener),
    [queryCache],
  );

  return useSyncExternalStore(
    subscribe,
    () => {
      const timestamps = queryKeys
        .map((queryKey) => queryCache.find({ queryKey, exact: true })?.state.dataUpdatedAt ?? 0)
        .filter((timestamp) => timestamp > 0);
      return timestamps.length === 0 ? 0 : Math.min(...timestamps);
    },
    () => 0,
  );
}

export function LastUpdated({ queryKeys }: { queryKeys: readonly QueryKey[] }) {
  const queryClient = useQueryClient();
  const dataUpdatedAt = useDataUpdatedAt(queryKeys);
  const now = useNow();

  const secondsAgo =
    dataUpdatedAt === 0 ? 0 : Math.max(0, Math.floor((now - dataUpdatedAt) / 1_000));

  return (
    <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="tabular-nums">updated {secondsAgo}s ago</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() =>
          void Promise.all(
            queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey, exact: true })),
          )
        }
      >
        Refresh
      </Button>
    </div>
  );
}
