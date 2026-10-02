import { useEffect, useRef, useState } from "react";

/* Scroll progress 0..1 for the element, eased toward its target so the motion
   has weight. Writes `--p` on the element (no re-render per frame) and returns
   the active step index, which changes rarely. While the element's first child
   is sticky (a pinned track with a spacer after it), progress spans the distance
   the child stays stuck, so the page moves on the moment the last step lands;
   otherwise it spans the element passing through the viewport. */
export function useScrub(steps: number) {
  const outer = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const el = outer.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let target = 0;
    let shown = 0;
    let last = -1;
    let raf = 0;

    const read = () => {
      const r = el.getBoundingClientRect();
      const child = el.firstElementChild!;
      const style = getComputedStyle(child);

      target =
        style.position === "sticky"
          ? ((parseFloat(style.top) || 0) - r.top) /
            (r.height - child.getBoundingClientRect().height)
          : (innerHeight * 0.75 - r.top) / r.height;
      target = Math.min(1, Math.max(0, target));
    };

    const tick = () => {
      raf = 0;
      read();
      shown = reduce ? target : shown + (target - shown) * 0.14;

      if (Math.abs(target - shown) < 0.0004) shown = target;
      el.style.setProperty("--p", shown.toFixed(4));
      const i = Math.min(steps - 1, Math.round(shown * (steps - 1)));

      if (i !== last) {
        last = i;
        setAt(i);
      }

      if (shown !== target) raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    wake();
    addEventListener("scroll", wake, { passive: true });
    addEventListener("resize", wake);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", wake);
      removeEventListener("resize", wake);
    };
  }, [steps]);

  return { outer, at };
}

/* Counts a number toward its new value over 450ms, ease-out. */
export function useTween(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;

    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      from.current = a + (value - a) * (1 - (1 - k) ** 3);
      setShown(Math.round(from.current));

      if (k < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [value]);

  return shown;
}
