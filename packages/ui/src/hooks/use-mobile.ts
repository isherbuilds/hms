import * as React from "react";

const MOBILE_BREAKPOINT = 1024;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// One MediaQueryList for the module: `getSnapshot` runs on every render and after
// every change event, so allocating a fresh one there is pure garbage.
let query: MediaQueryList | null = null;

function getQuery(): MediaQueryList {
  query ??= window.matchMedia(QUERY);
  return query;
}

// The media query, not `window.innerWidth`, which counts the scrollbar and flips a
// few pixels before the CSS does. First render gets the real value.
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => getQuery().matches,
    () => false,
  );
}

function subscribe(listener: () => void): () => void {
  const mql = getQuery();
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}
