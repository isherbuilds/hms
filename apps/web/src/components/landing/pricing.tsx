import { CheckIcon, MessageCircle, PhoneIcon } from "lucide-react";

import { PHONE_DISPLAY, PHONE_TEL, WHATSAPP_URL } from "@/lib/contact";

import { Accent, buttonClass, Pill, SECTION_HEADING, stagger, WRAP } from "./primitives";

const EARLY_BIRD = [
  "A founding rate for the first hospitals on Edernal Care",
  "Set up by the team that built it, not a ticket queue",
  "Your desk's feedback decides what we build next",
];

export function LandingPricing() {
  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border bg-card py-20 md:py-32">
      <div className={WRAP}>
        <div
          data-reveal
          className="grid grid-cols-1 gap-10 rounded-2xl bg-band p-6 text-band-foreground md:p-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16"
        >
          <div className="flex min-w-0 flex-col items-start gap-5">
            <Pill tone="onBand">Pricing coming soon</Pill>
            <h2 className={SECTION_HEADING}>
              Early-bird hospitals get <Accent onBand>the best price.</Accent>
            </h2>
            <p className="text-lg text-band-muted md:text-xl md:leading-8">
              We are settling plans with our first hospitals, so there is no price list yet. Call or
              message us, tell us about your hospital, and we will agree a price with you directly.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-6" style={stagger(1)}>
            <ul className="flex flex-col gap-3.5 text-base">
              {EARLY_BIRD.map((line) => (
                <li key={line} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3">
                  <CheckIcon
                    aria-hidden
                    strokeWidth={1.75}
                    className="mt-0.5 size-5 text-brand-bright"
                  />
                  {line}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a href={PHONE_TEL} className={buttonClass({ variant: "light" })}>
                <PhoneIcon aria-hidden /> Call {PHONE_DISPLAY}
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "outline-light" })}
              >
                <MessageCircle aria-hidden /> WhatsApp us
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
