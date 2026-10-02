import { ArrowRightIcon } from "lucide-react";

import { PHONE_DISPLAY, PHONE_TEL, WHATSAPP_URL } from "@/lib/contact";

import { Accent, buttonClass, LEDE, stagger, WRAP } from "./primitives";

export function LandingFinal() {
  return (
    <section
      id="demo"
      aria-labelledby="demo-heading"
      className="relative scroll-mt-20 overflow-hidden bg-band py-20 text-band-foreground md:pt-30 md:pb-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--color-band-foreground)_1px,transparent_1.5px)] bg-size-[32px_32px] opacity-12 [mask-image:radial-gradient(ellipse_at_50%_50%,black_0%,transparent_70%)]"
      />
      <div className={`${WRAP} relative flex flex-col items-center gap-6 text-center`}>
        <h2
          id="demo-heading"
          data-reveal
          className="max-w-[820px] text-[40px] leading-[46px] font-semibold tracking-[0.01em] [word-spacing:0.02em] text-balance md:text-[64px] md:leading-[68px]"
        >
          See how it fits <Accent onBand>your hospital.</Accent>
        </h2>
        <div data-reveal style={stagger(1)} className="flex flex-col items-center gap-4.5">
          <p className={`${LEDE} max-w-[560px] text-band-muted`}>
            Access is by invitation only. Contact us for an invitation, a free demo, or any
            questions.
          </p>
          <div className="flex flex-wrap justify-center gap-3 max-md:w-full">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "light", className: "max-md:w-full" })}
            >
              Book a free demo <ArrowRightIcon aria-hidden strokeWidth={1.75} />
            </a>
          </div>
          <a href={PHONE_TEL} className="text-base text-band-muted underline underline-offset-4">
            Call {PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </section>
  );
}
