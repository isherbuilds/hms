import { FAQS } from "@/content/faqs";

import type { ShotName } from "./product-window";

/* The FAQ the healthcare references all run and the design-led ones all skip
   (docs/research/landing-page-composition.md: Practo carries 11, Tebra 6, none
   of Cursor/Ramp/Slack/Midday carry one).

   The answers live in `content/faqs.ts`, which also feeds the homepage's
   FAQPage JSON-LD. One list of answers, two presentations: `/` renders all of
   them, a feature page renders the ones tagged for its module. */

export function LandingFaq({ feature }: { feature?: ShotName }) {
  const items = feature ? FAQS.filter((item) => item.features.includes(feature)) : FAQS;
  return (
    /* `scroll-mt` clears the sticky bar the header's "Questions" link lands under. */
    <section
      id="faq"
      className="mx-auto flex w-full max-w-3xl scroll-mt-16 flex-col gap-8 px-5 pt-20 sm:gap-10 sm:px-6 sm:pt-28"
    >
      <h2 className="text-3xl font-medium tracking-tight text-balance sm:text-center sm:text-4xl">
        The questions we actually get asked.
      </h2>

      {/* Native <details> rather than a scripted accordion: keyboard and
          screen-reader correct with no JavaScript, and every answer stays in the
          page for anyone who prints it, searches it, or crawls it.

          One column, not two: in a two-column grid an opened answer pushes only
          its own column, so the two sides drift apart and the section ends
          ragged. */}
      <div className="flex flex-col">
        {items.map((item) => (
          <details key={item.q} className="group border-b border-border py-3 sm:py-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 text-base font-medium marker:content-none">
              {item.q}
              <span
                aria-hidden
                className="text-lg leading-none text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm text-muted-foreground text-pretty">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
