import { useEffect, useRef, useState } from "react";

// `useDeferredValue` is not a swap for this: it defers rendering, not the fetch
// the value triggers.
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);

    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

// The same pause for a value React never holds: an uncontrolled box keeps its text
// in the DOM and calls this once the typing stops. `now` applies at once and drops a
// pending pause, so an older value cannot land after Enter or Esc; `cancel` drops the
// pause without applying, for when the box's text is replaced from outside.
export function useDebouncedCallback<T>(callback: (value: T) => void, delay: number) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const schedule = (value: T) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => callback(value), delay);
  };

  schedule.now = (value: T) => {
    window.clearTimeout(timer.current);
    callback(value);
  };

  schedule.cancel = () => {
    window.clearTimeout(timer.current);
  };

  return schedule;
}
