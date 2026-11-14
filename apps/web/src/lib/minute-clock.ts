import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

// Ticks on the minute boundary, so the clock turns when a wall clock does.
function subscribeMinutes(tick: () => void) {
  let timer: ReturnType<typeof setInterval> | undefined;

  const first = setTimeout(
    () => {
      tick();
      timer = setInterval(tick, MINUTE_MS);
    },
    MINUTE_MS - (Date.now() % MINUTE_MS),
  );

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Now, rounded down to the minute. A loader returns it so server and client render agree. */
export const currentMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

/** Wall-clock time to the minute; the first render uses the loader's clock so hydration matches. */
export function useMinuteClock(initial: number) {
  return useSyncExternalStore(subscribeMinutes, currentMinute, () => initial);
}
