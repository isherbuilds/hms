/**
 * Foreground polling keeps multi-terminal operational screens fresh. TanStack
 * suppresses intervals in background tabs by default.
 */
export const OPERATIONAL_REFETCH = {
  refetchInterval: 10_000,
  refetchOnWindowFocus: true,
  staleTime: 5_000,
} as const;
