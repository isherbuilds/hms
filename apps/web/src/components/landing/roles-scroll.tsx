import { useEffect, useRef, useState } from "react";

import { Accent, EYEBROW, SECTION_HEADING, WRAP } from "./primitives";
import { ROLES, Ticks } from "./roles";

/* Scrolling pins the stage and steps through the roles; the visitor never
   presses anything. Scroll maps to a float `p` (0…N-1), and the stack paints from `p` straight onto the DOM, so scrolling
   never re-renders React. Narrow, short and reduced-motion viewports get the same cards as a
   plain, unpinned stack. */

const N = ROLES.length;

/* The `role-stack` variant in index.css; the two queries must match. */
const STACKED = "(max-width: 1023px), (max-height: 899px), (prefers-reduced-motion: reduce)";

const STEP_SVH = 85;

/* Height of each buried card's strip left showing above the next one. */
const PEEK = 22;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/* How far the track has scrolled, as a role index; outside 0…N-1 while the
   track is not pinned. */
function position(track: HTMLElement) {
  const rect = track.getBoundingClientRect();

  return (-rect.top / (rect.height - window.innerHeight)) * (N - 1);
}

function goTo(track: HTMLElement, index: number) {
  const span = track.offsetHeight - window.innerHeight;

  window.scrollBy({ top: ((index - position(track)) / (N - 1)) * span, behavior: "smooth" });
}

/* The heading stays pinned while full panels rise from the bottom of the
   viewport over each other like a deck of cards; the ones under it shrink and
   dim so the pile stays visible. The chapter bar fills as you scroll and jumps
   on click. */
export function LandingRoles() {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const veils = useRef<(HTMLDivElement | null)[]>([]);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const stacked = window.matchMedia(STACKED);

    const element = track.current!;
    let frame = 0;

    const paint = () => {
      frame = 0;

      if (stacked.matches) return;
      const p = clamp(position(element), 0, N - 1);
      const below = window.innerHeight - stage.current!.getBoundingClientRect().top;

      setActive(Math.round(p));
      cards.current.forEach((card, index) => {
        if (!card) return;
        const t = p - index;

        if (t <= 0) {
          // Arriving: rises from the bottom edge of the viewport.
          card.style.transform = `translate3d(0, ${clamp(-t) * below}px, 0)`;
          card.style.visibility = t < -1 ? "hidden" : "visible";
        } else {
          // Buried: sinks back, narrows, keeps its label strip showing above the next card.
          card.style.transform = `translate3d(0, ${-t * PEEK}px, 0) scale(${1 - t * 0.05})`;
          card.style.visibility = t > 2.2 ? "hidden" : "visible";
        }

        veils.current[index]!.style.opacity = String(clamp(t) * 0.4);
        fills.current[index]!.style.transform = `scaleX(${clamp(t + 1)})`;
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section id="roles" className="overflow-clip border-y border-border bg-card">
      <div
        ref={track}
        style={{ height: `${100 + (N - 1) * STEP_SVH}svh` }}
        className="role-stack:h-auto!"
      >
        <div
          className={`${WRAP} sticky top-16 flex h-[calc(100svh-4rem)] flex-col justify-center gap-3 py-6 md:py-10 role-stack:static role-stack:h-auto role-stack:py-20`}
        >
          <h2 className={`${SECTION_HEADING} mb-3 md:mb-6`}>
            Simple enough <Accent>without a manual.</Accent>
          </h2>
          <nav aria-label="Roles" className="grid grid-cols-5 gap-2 md:gap-3 role-stack:hidden">
            {ROLES.map((role, index) => (
              <button
                key={role.id}
                type="button"
                onClick={() => goTo(track.current!, index)}
                aria-current={active === index}
                className="group flex cursor-pointer flex-col gap-2 text-left"
              >
                <span className="relative h-[3px] overflow-hidden rounded-full bg-border">
                  <span
                    ref={(element) => {
                      fills.current[index] = element;
                    }}
                    className="absolute inset-0 origin-left bg-foreground"
                    style={{ transform: "scaleX(0)" }}
                  />
                </span>
                <span
                  className={`truncate text-xs font-medium transition-colors duration-200 md:text-sm ${active === index ? "text-foreground" : "text-muted-foreground pointer-fine:group-hover:text-foreground"}`}
                >
                  {role.label}
                </span>
              </button>
            ))}
          </nav>
          <div
            ref={stage}
            className="relative mt-11 max-h-[600px] min-h-0 flex-1 role-stack:flex role-stack:max-h-none role-stack:flex-col role-stack:gap-6"
          >
            {ROLES.map((role, index) => (
              <div
                key={role.id}
                ref={(element) => {
                  cards.current[index] = element;
                }}
                style={{ zIndex: index }}
                className="absolute inset-0 origin-top overflow-hidden rounded-[28px] border border-border bg-background will-change-transform role-stack:relative role-stack:transform-none! role-stack:visible! role-stack:will-change-auto"
              >
                <p
                  className={`${EYEBROW} absolute inset-x-0 top-0 px-5 pt-2 text-muted-foreground tabular-nums md:px-9`}
                >
                  {String(index + 1).padStart(2, "0")} · {role.label}
                </p>
                <div className="grid h-full grid-cols-1 items-center gap-6 p-5 pt-9 md:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14 role-stack:h-auto">
                  <div className="flex flex-col gap-4 md:gap-5.5">
                    <h3 className="text-2xl font-semibold tracking-[0.01em] md:text-3xl">
                      {role.title}
                    </h3>
                    <p className="hidden text-lg text-muted-foreground md:block">
                      {role.description}
                    </p>
                    <Ticks ticks={role.ticks} className="hidden lg:flex" />
                  </div>
                  <div className="min-w-0 [&>[data-role-visual]]:bg-card">{role.visual}</div>
                </div>
                <div
                  ref={(element) => {
                    veils.current[index] = element;
                  }}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-card opacity-0 role-stack:hidden"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
