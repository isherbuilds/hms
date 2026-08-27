/**
 * Foreground polling keeps multi-terminal operational screens fresh. TanStack
 * suppresses intervals in background tabs by default. Same-key background
 * refetches retain their current result without placeholder data; omitting a
 * shared placeholder also prevents one appointment or organization from appearing
 * under another key during navigation.
 */
export const OPERATIONAL_REFETCH = {
  refetchInterval: 10_000,
  refetchOnWindowFocus: true,
  staleTime: 5_000,
} as const;

type InfiniteQueryLike = { state: { data?: { pages: unknown[] } | undefined } };

/**
 * TanStack refetches every loaded infinite-query page. Keep the live poll
 * cheap on page one; deeper browsing refreshes only when staff ask for it.
 */
export const OPERATIONAL_INFINITE_REFETCH = {
  ...OPERATIONAL_REFETCH,
  refetchInterval: (query: InfiniteQueryLike) =>
    (query.state.data?.pages.length ?? 0) <= 1 ? OPERATIONAL_REFETCH.refetchInterval : false,
  refetchOnWindowFocus: (query: InfiniteQueryLike) => (query.state.data?.pages.length ?? 0) <= 1,
} as const;
