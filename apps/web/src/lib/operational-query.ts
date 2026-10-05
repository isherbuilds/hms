// TanStack suppresses intervals in background tabs by default. No shared
// placeholder: it would bridge results across keys and show one appointment or
// organization under another during navigation.
export const OPERATIONAL_REFETCH = {
  // A refetch without data resets the query to pending and hides a failed first read's
  // error, so only loaded data polls; focus and reconnect still retry.
  refetchInterval: (query: { state: { data?: unknown } }) =>
    query.state.data === undefined ? false : 10_000,
  refetchOnWindowFocus: true,
  staleTime: 5_000,
} as const;

type InfiniteQueryLike = { state: { data?: { pages: unknown[] } | undefined } };

// TanStack refetches every loaded page of an infinite query, so keep the live poll
// to page one.
export const OPERATIONAL_INFINITE_REFETCH = {
  ...OPERATIONAL_REFETCH,
  refetchInterval: (query: InfiniteQueryLike) =>
    query.state.data?.pages.length === 1 ? 10_000 : false,
  refetchOnWindowFocus: (query: InfiniteQueryLike) => (query.state.data?.pages.length ?? 0) <= 1,
} as const;
