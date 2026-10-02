import { useEffect, useRef, type ReactNode } from "react";

/* Marks each `[data-reveal]` inside it with `data-inview` the first time it
   enters the viewport, then stops watching it. The motion itself lives in
   `index.css`; this only flips the attribute, so a component opts in by adding
   `data-reveal` (and `--i` to stagger) with no hook of its own. */
export function RevealRoot({ className, children }: { className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-inview", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    for (const element of root.current!.querySelectorAll("[data-reveal]")) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
