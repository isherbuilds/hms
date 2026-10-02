import { History, Lock, TriangleAlert, Zap } from "lucide-react";

import { Accent, LEDE, SECTION_HEADING, stagger, WRAP } from "./primitives";

const FACTS = [
  {
    title: "Live, not end-of-day",
    description: "Every bill, payment and deposit shows the moment it’s made.",
    icon: Zap,
  },
  {
    title: "Leakage flagged",
    description: "Unbilled services are caught before the patient leaves.",
    icon: TriangleAlert,
  },
  {
    title: "Every change logged",
    description: "See who edited a bill or gave a discount, and when.",
    icon: History,
  },
  {
    title: "Money is never overwritten",
    description: "A bill is corrected with a credit note, so the original always stays.",
    icon: Lock,
  },
] as const;

function OwnerPhone() {
  return (
    <div
      data-reveal
      style={stagger(1)}
      className="w-[300px] max-w-full justify-self-center rounded-[48px] bg-band-raised p-3 shadow-[0_40px_80px_-20px_color-mix(in_oklch,var(--band)_60%,transparent)] ring-1 ring-band-line md:w-[340px]"
    >
      <div className="overflow-hidden rounded-[38px] bg-background">
        <img
          src="/landing/dashboard-phone-light.webp"
          alt="Edernal Care on mobile: today's collections, payment methods, weekly trend and arrivals."
          width={780}
          height={1688}
          loading="lazy"
          className="block h-auto w-full dark:hidden"
        />
        <img
          src="/landing/dashboard-phone-dark.webp"
          alt="Edernal Care on mobile: today's collections, payment methods, weekly trend and arrivals."
          width={780}
          height={1688}
          loading="lazy"
          className="hidden h-auto w-full dark:block"
        />
      </div>
    </div>
  );
}

export function LandingOwner() {
  return (
    <section id="owner" className="scroll-mt-20 bg-band py-20 text-band-foreground md:py-32">
      <div
        className={`${WRAP} grid grid-cols-1 items-center gap-9 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-24`}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <h2 data-reveal className={SECTION_HEADING}>
            Your whole hospital, <Accent onBand>in your pocket.</Accent>
          </h2>
          <p
            data-reveal
            style={stagger(1)}
            className={`${LEDE} hidden max-w-[460px] text-band-muted lg:block`}
          >
            Open one screen and know what came in, what is still open, and what was missed.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-band-line bg-band-line md:grid-cols-2 lg:mt-4 lg:flex lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
            {FACTS.map((fact, index) => (
              <li
                key={fact.title}
                data-reveal
                style={stagger(index + 2)}
                className="group flex flex-col bg-band px-5.5 pt-5.5 pb-6 lg:grid lg:grid-cols-[28px_1fr] lg:gap-x-4 lg:bg-transparent lg:p-0"
              >
                <fact.icon
                  aria-hidden
                  className="mt-6.5 hidden size-5.5 text-brand-bright lg:block lg:group-first:mt-4"
                  strokeWidth={1.75}
                />
                <div className="flex flex-col gap-1.5 lg:gap-1 lg:border-t lg:border-band-line lg:py-6 lg:group-first:border-t-0 lg:group-first:pt-3">
                  <h3 className="text-base font-semibold lg:text-lg lg:leading-6">{fact.title}</h3>
                  <p className="text-sm leading-6 text-band-muted lg:text-base">
                    {fact.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <OwnerPhone />
      </div>
    </section>
  );
}
