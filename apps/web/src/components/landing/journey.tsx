import { ArrowRight } from "lucide-react";

import { useScrub, useTween } from "@/hooks/use-scrub";

import { Accent, buttonClass, EYEBROW, SectionHead, WRAP } from "./primitives";

const STEPS = [
  {
    desk: "Front desk",
    title: "Registration",
    description: "Find the patient by mobile number. Print the token.",
    charge: 0,
  },
  {
    desk: "Doctor",
    title: "Consultation",
    description: "Notes and prescription, on screen or on paper.",
    charge: 500,
  },
  {
    desk: "Lab",
    title: "Tests",
    description: "The lab gets the order. Results come back here.",
    charge: 1450,
  },
  {
    desk: "Pharmacy",
    title: "Medicines",
    description: "The prescription is already there. Stock updates itself.",
    charge: 620,
  },
  {
    desk: "Ward",
    title: "Admission",
    description: "Bed, deposit and nursing orders, all in one place.",
    charge: 6000,
  },
  {
    desk: "Billing",
    title: "Discharge",
    description: "The bill is ready. Take cash, UPI, card or TPA.",
    charge: 0,
  },
] as const;

const LAST = STEPS.length - 1;

const inr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

/* The pinned track scrolls the record from desk to desk. Progress comes from
   `useScrub` as `--p`; the chip and the line read it in CSS. While pinned it
   fills the screen below the nav, so the steps never sit in a thin band. Outside the `pin`
   variant (index.css) nothing pins: the same line runs down the page. */
export function LandingJourney() {
  const { outer, at } = useScrub(STEPS.length);
  const total = useTween(STEPS.slice(0, at + 1).reduce((sum, step) => sum + step.charge, 0));

  return (
    <section id="journey" className="scroll-mt-20 py-16 md:py-20">
      <div className={WRAP}>
        <div ref={outer}>
          <div className="pin:sticky pin:top-16 pin:flex pin:h-[calc(100svh-4rem)] pin:flex-col pin:justify-center">
            <SectionHead
              title={
                <>
                  One record, from <Accent>token to bill.</Accent>
                </>
              }
            />
            <div className="relative lg:pt-11">
              <div aria-hidden className="max-lg:hidden">
                <span
                  className="absolute top-0 flex items-center gap-2 rounded-full bg-foreground py-1.5 pr-3 pl-2 text-xs font-medium whitespace-nowrap text-background tabular-nums"
                  style={{ left: "calc(var(--p) * 100% * 5 / 6)" }}
                >
                  <span className="size-2 rounded-full bg-brand-bright" />
                  Meera N. · {inr(total)}
                </span>
                <span className="absolute top-[49px] left-[5px] h-px w-[calc(100%*5/6)] bg-border">
                  <span
                    className="block h-full origin-left bg-brand"
                    style={{ transform: "scaleX(var(--p))" }}
                  />
                </span>
              </div>
              <ol className="relative grid grid-cols-1 lg:grid-cols-6">
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 left-0 w-px bg-border lg:hidden"
                >
                  <span
                    className="block h-full origin-top bg-brand"
                    style={{ transform: "scaleY(var(--p))" }}
                  />
                </span>
                {STEPS.map((step, index) => {
                  const reached = index <= at;

                  return (
                    <li
                      key={step.desk}
                      className={`relative pr-6 transition-opacity duration-300 ease-out max-lg:pb-9 max-lg:pl-6 ${reached ? "opacity-100" : "opacity-40"}`}
                    >
                      <span
                        aria-hidden
                        className={`size-[11px] rounded-full border transition-colors duration-300 max-lg:absolute max-lg:top-1.5 max-lg:-left-[5px] lg:mb-5 lg:block ${reached ? "border-brand bg-brand" : "border-muted-foreground/50 bg-background"}`}
                      />
                      <p className={`${EYEBROW} text-muted-foreground tabular-nums`}>
                        {String(index + 1).padStart(2, "0")} · {step.desk}
                      </p>
                      <h3 className="mt-3 text-2xl font-semibold tracking-[0.01em]">
                        {step.title}
                      </h3>
                      <p className="mt-3 text-base leading-7 text-muted-foreground">
                        {step.description}
                      </p>
                      {index === LAST && (
                        <p
                          className={`mt-4 inline-block rounded-full bg-brand-surface px-3 py-1.5 text-sm font-medium text-brand tabular-nums transition-opacity duration-300 ${reached ? "opacity-100" : "opacity-0"}`}
                        >
                          Bill {inr(total)} · ready
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="mt-14 pin:mt-20 flex flex-col items-start justify-between gap-6 text-sm text-muted-foreground md:flex-row md:items-center">
              <span>
                <b className="font-semibold text-foreground">One login per person.</b> Each sees
                only their own desk.
              </span>
              <a href="#roles" className={buttonClass({ variant: "ghost", size: "sm" })}>
                See it desk by desk <ArrowRight aria-hidden />
              </a>
            </div>
          </div>
          <div aria-hidden className="hidden h-[90vh] pin:block" />
        </div>
      </div>
    </section>
  );
}
