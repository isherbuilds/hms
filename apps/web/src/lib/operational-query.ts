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
