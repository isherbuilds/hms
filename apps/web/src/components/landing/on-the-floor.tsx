import { Wash } from "./wash";

/* The phone band, after the three desktop panels.

   It is deliberately not a fourth capability panel: the section above promises
   "three screens", and the same product on a phone is a different claim, not a
   fourth screen. The captures are the real app at 390px — a designed mobile
   layout with its own card list and check-in buttons, not a squeezed table. */

const PHONES = [
  {
    key: "opd",
    alt: "The outpatient list on a phone: each patient as a card with a check-in button",
    className:
      "bg-[url('/landing/opd-phone-light.webp')] dark:bg-[url('/landing/opd-phone-dark.webp')]",
  },
  {
    key: "dashboard",
    alt: "The dashboard on a phone: today's counts and collections stacked as full-width cards",
    className:
      "bg-[url('/landing/dashboard-phone-light.webp')] dark:bg-[url('/landing/dashboard-phone-dark.webp')]",
  },
];

export function LandingOnTheFloor() {
  return (
    <section className="mx-auto w-full max-w-[84rem] px-5 pt-8 [contain-intrinsic-size:auto_700px] [content-visibility:auto] sm:px-6 sm:pt-16">
      <div className="grid items-center gap-6 rounded-xl bg-muted p-2 sm:p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-8">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 sm:py-6 lg:px-10">
          <span className="text-xs text-muted-foreground">On the floor</span>
          <h2 className="text-2xl font-medium tracking-tight text-balance">
            The queue fits in a pocket
          </h2>
          <p className="text-base text-muted-foreground text-pretty">
            Check a patient in from the ward, or see who is still waiting, without walking back to
            the desk.
          </p>
        </div>

        {/* Two phones, overlapped and clipped at the bottom by the stage — the
            same crop-don't-shrink rule the desktop shots follow. */}
        <div className="relative flex h-[22rem] justify-center overflow-hidden rounded-xl px-4 pt-8 sm:h-[26rem] lg:h-[30rem] lg:pt-12">
          <Wash />
          <div className="relative flex items-start gap-3 sm:gap-4">
            {PHONES.map((phone, i) => (
              <div
                key={phone.key}
                role="img"
                aria-label={phone.alt}
                /* 390×844 is the capture's own ratio. The second phone sits
                   slightly lower so the pair reads as a stack, not a diagram. */
                className={`aspect-[195/422] w-40 shrink-0 rounded-xl border border-border bg-cover bg-clip-padding bg-top bg-no-repeat shadow-2xl sm:w-48 lg:w-56 ${
                  i === 1 ? "mt-8 hidden sm:block" : ""
                } ${phone.className}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
