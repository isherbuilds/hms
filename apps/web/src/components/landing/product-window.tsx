import type { CSSProperties } from "react";

/* A zoomed crop of a real screen, framed as an app window. The crop keeps the
   pixels native — the captures are a 1440-wide viewport at 2×, so a region of
   that viewport is shown at its own scale rather than as a whole screen shrunk
   until the tables are unreadable. Percentages do the framing, so a crop holds
   at any container width. */

const VIEW_W = 1440;

/* Written out in full rather than built from `name`: Tailwind only generates a
   class it can see literally in the source. The filenames carry the capture
   height so a recapture at a new ratio can never be served from cache against
   the old frame.

   Each shot carries its own viewport height: the landing captures are 1440×900
   where the hero's is 1440×830, and a crop's vertical offset is a fraction of
   the height it was taken from. */
const SHOTS = {
  opd: {
    viewH: 900,
    className:
      "bg-[url('/landing/opd-830-light.webp')] dark:bg-[url('/landing/opd-830-dark.webp')]",
  },
  patients: {
    viewH: 900,
    className:
      "bg-[url('/landing/patients-830-light.webp')] dark:bg-[url('/landing/patients-830-dark.webp')]",
  },
  billing: {
    viewH: 900,
    className:
      "bg-[url('/landing/billing-830-light.webp')] dark:bg-[url('/landing/billing-830-dark.webp')]",
  },
} as const;

export type ShotName = keyof typeof SHOTS;
export type Region = { x: number; y: number; w: number; h: number };

/* `background-position: P%` aligns point P of the image with point P of the box,
   so the offset is a fraction of the slack, not of the image. A region as wide
   as the viewport has no slack and sits at 0. */
function cropStyle(region: Region, viewH: number): CSSProperties {
  return {
    backgroundSize: `${(VIEW_W / region.w) * 100}% auto`,
    backgroundPositionX: `${region.w === VIEW_W ? 0 : (region.x / (VIEW_W - region.w)) * 100}%`,
    backgroundPositionY: `${region.h === viewH ? 0 : (region.y / (viewH - region.h)) * 100}%`,
    aspectRatio: `${region.w} / ${region.h}`,
  };
}

/* The titlebar is what makes a cropped table read as software rather than as a
   picture of a table — the cheapest signal on the page.

   `alt` is empty for a crop that repeats the claim printed beside it, and the
   whole window is then dropped from the accessibility tree instead of announced
   as an unnamed graphic under a titlebar. */
export function ProductWindow({
  name,
  region,
  alt,
  title,
  className = "",
}: {
  name: ShotName;
  region: Region;
  alt: string;
  title: string;
  className?: string;
}) {
  const shot = SHOTS[name];
  return (
    <div
      aria-hidden={alt ? undefined : true}
      className={`overflow-hidden rounded-lg border border-border bg-card shadow-2xl ${className}`}
    >
      <div className="flex h-8 items-center gap-2 border-b border-border px-3">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/35" />
          <span className="size-2 rounded-full bg-muted-foreground/35" />
          <span className="size-2 rounded-full bg-muted-foreground/35" />
        </span>
        <span className="flex-1 truncate text-center text-xs whitespace-nowrap text-muted-foreground">
          {title}
        </span>
        <span aria-hidden className="w-10" />
      </div>
      <div
        {...(alt ? { role: "img", "aria-label": alt } : {})}
        style={cropStyle(region, shot.viewH)}
        className={`w-full bg-no-repeat ${shot.className}`}
      />
    </div>
  );
}
