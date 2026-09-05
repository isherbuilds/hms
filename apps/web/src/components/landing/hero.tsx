import { Button } from "@hms/ui/components/button";
import { Link } from "@tanstack/react-router";

import { WHATSAPP_URL } from "@/lib/contact";

import { Wash } from "./wash";

/* The landing page's opening screen. The bar above it lives in `nav.tsx`. */

/* The action pair every public hero ends with. Stacked and full-bleed under
   `sm`. A 36px control is below the 44px touch minimum, so the actions take a
   taller box on a phone.

   The walkthrough is the primary action: "Open your hospital" lands on `/join`,
   which is a login wall to anyone without an account — a dead end for the new
   visitor a hero exists for. */
export function HeroActions() {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      <Button
        size="lg"
        className="h-11 w-full normal-case sm:h-9 sm:w-auto"
        nativeButton={false}
        render={<a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" />}
      >
        Book a walkthrough
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-11 w-full normal-case sm:h-9 sm:w-auto sm:border-transparent sm:bg-transparent sm:hover:bg-muted"
        nativeButton={false}
        render={<Link to="/join" />}
      >
        Open your hospital
      </Button>
    </div>
  );
}

export function LandingHero() {
  return (
    <section className="relative mx-auto flex w-full max-w-336 flex-col items-center gap-6 px-6 pt-20">
      {/* The same wash the capability stages carry, so the top of the page reads
          as one ground rather than as a white hero above a coloured section. It
          runs past the section's own bounds and fades out at the bottom, which is
          what stops it ending on a visible edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 bottom-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden"
      >
        <Wash className="opacity-70" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-linear-to-b from-transparent to-background" />
      </div>
      <h1 className="max-w-3xl text-4xl leading-[1.05] font-medium tracking-tight text-balance sm:text-center sm:text-5xl">
        The desk software your hospital actually runs on.
      </h1>

      {/* The definition sentence: the one line a search or answer engine can
          lift verbatim, and the line that tells a first-time visitor whether
          this page is for them. */}
      <p className="max-w-lg text-lg text-muted-foreground text-pretty sm:text-center">
        Hospital management software for small and mid-sized Indian hospitals — outpatient queues,
        records and billing in one system.
      </p>

      <HeroActions />

      {/* One capture at every width: the desktop screen, whole. Below `md` it is
          small, and that is the honest trade — HMS is desk software, so a phone
          visitor is evaluating something they will run on a counter machine. The
          alternatives were both worse: cropping puts an arbitrary edge through
          half a table row, and swapping in a phone capture tells a phone visitor
          this is a phone app.

          The frame is an even band on all four sides and the window carries a
          full border, so the screen reads as one complete object rather than as
          something running off the bottom of the page.

          The wash never goes behind type: it is pinned to its light values in
          both themes, and pale type on a pale wash fails in dark.

          `100% auto` rather than `cover`: the capture's ratio and the frame's are
          the same, so sizing to width makes a mismatch show as a sliver of gap
          instead of a silent zoom. The filename carries the capture height —
          830px, where the dashboard's last panel ends — so a recapture at a new
          ratio can never be served from cache against the old frame. */}
      <div className="relative mt-8 w-full overflow-hidden rounded-xl p-4 sm:p-5 lg:p-8">
        <Wash />
        <div
          role="img"
          aria-label="The HMS dashboard: today's counts, collections over 14 days, and the waiting queue"
          className="relative aspect-144/83 w-full rounded-lg border border-border bg-size-[100%_auto] bg-clip-padding bg-top bg-no-repeat shadow-2xl bg-[url('/hero/dashboard-830-light.webp')] dark:bg-[url('/hero/dashboard-830-dark.webp')]"
        />
      </div>
    </section>
  );
}
