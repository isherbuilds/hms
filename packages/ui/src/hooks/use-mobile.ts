import * as React from "react";

const MOBILE_BREAKPOINT = 1024;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// The media query, not `window.innerWidth`, which counts the scrollbar and flips a
// few pixels before the CSS does. First render gets the real value.
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
