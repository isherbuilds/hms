import { useEffect, useState } from "react";

/**
 * Holds a value back until it stops changing, so a search box costs one request
 * per pause instead of one per keystroke. `useDeferredValue` is not a swap for
 * this: it defers rendering, not the fetch the value triggers.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}
