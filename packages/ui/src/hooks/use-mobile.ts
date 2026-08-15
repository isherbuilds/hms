import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Reads the breakpoint from the media query rather than `window.innerWidth`,
 * which counts the scrollbar and so flips a few pixels before the CSS does.
 * The first render gets the real value instead of assuming desktop and
 * correcting in an effect, which used to flash the desktop layout on a phone.
 */
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
