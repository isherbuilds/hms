/* The public page's one decorative surface: a soft wash of the clinical surface
   hues, used behind the hero and behind each capability panel's stage so the top
   of the site reads as one continuous ground.

   It is deliberately identical in both themes. Every other surface in this
   product inverts, but a wash that flips becomes a different object — light and
   airy in one theme, murky in the other. Holding it still makes the dark page
   read the way Cursor's does: a bright stage carrying a dark app window. The
   values are the light-theme clinical surfaces, written out rather than read
   from the tokens precisely so the dark theme cannot move them.

   This is a documented deviation from docs/design.md §5 and lives on `/` only. */

const LIGHT_NOTE = "oklch(0.965 0.03 80)";
const LIGHT_INFO = "oklch(0.962 0.025 253)";
const LIGHT_CLEAR = "oklch(0.958 0.03 155)";

export const WASH_BACKGROUND = [
  `radial-gradient(90% 70% at 12% 8%, ${LIGHT_NOTE}, transparent 62%)`,
  `radial-gradient(80% 65% at 88% 92%, ${LIGHT_INFO}, transparent 60%)`,
  `radial-gradient(70% 60% at 55% 45%, ${LIGHT_CLEAR}, transparent 70%)`,
  `linear-gradient(155deg, ${LIGHT_NOTE}, ${LIGHT_INFO})`,
].join(", ");

export function Wash({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{ background: WASH_BACKGROUND }}
    />
  );
}

/* Ink for anything that sits ON the wash.

   The wash is pinned to its light values in both themes, so `text-foreground`
   over it goes near-white in dark mode and disappears. Anything drawn on the
   wash has to be pinned the same way the wash is — these are the light theme's
   `--foreground` and `--primary`, written out so no theme can move them.

   If you are adding an element on top of `<Wash />`, it uses one of these. */
export const ON_WASH = "text-[oklch(0.145_0_0)]";
export const ON_WASH_MUTED = "text-[oklch(0.145_0_0)]/65";
export const ON_WASH_BUTTON =
  "bg-[oklch(0.205_0_0)] text-[oklch(0.985_0_0)] hover:bg-[oklch(0.205_0_0)]/85";
export const ON_WASH_GHOST =
  "text-[oklch(0.145_0_0)] hover:bg-[oklch(0.145_0_0)]/8 hover:text-[oklch(0.145_0_0)]";
