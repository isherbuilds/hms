import { ArrowRight, MailIcon } from "lucide-react";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";

import { Accent, buttonClass, Pill, SECTION_HEADING, stagger, WRAP } from "./primitives";

const TIERS = [
  {
    name: "Clinics",
    audience: "For doctors and small care teams",
    description: "Let’s talk about making appointments, patient records and billing easier.",
    action: "Request an invitation",
  },
  {
    name: "Hospitals",
    audience: "For your everyday hospital work",
    description: "Find the right setup for your reception, billing and pharmacy teams.",
    action: "Contact us",
  },
  {
    name: "Large hospitals",
    audience: "For more departments and larger teams",
    description: "Talk through your departments, staff training and support needs with us.",
    action: "Talk to our team",
  },
];

export function LandingPricing() {
  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border bg-card py-16 md:py-24">
      <div className={`${WRAP} flex flex-col items-start gap-6`}>
        <h2 data-reveal className={SECTION_HEADING}>
          A plan for <Accent>your hospital.</Accent>
        </h2>
        <p data-reveal style={stagger(1)} className="max-w-xl text-lg text-muted-foreground">
          Access is by invitation only. Contact us to discuss early-bird pricing and find the right
          fit for your hospital.
        </p>
        <div className="mt-4 grid w-full grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          {TIERS.map((tier, index) => (
            <article
              key={tier.name}
              data-reveal
              style={stagger(index + 2)}
              className="flex min-w-0 flex-col items-start rounded-2xl border border-border bg-background p-6 lg:p-8"
            >
              <Pill>Invite only</Pill>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">{tier.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{tier.audience}</p>
              <p className="mt-8 text-2xl font-semibold tracking-tight">Contact for pricing</p>
              <p className="mt-3 mb-8 text-base leading-7 text-muted-foreground">
                {tier.description}
              </p>
              <a
                href={CONTACT_MAILTO}
                aria-label={`${tier.action} about ${tier.name} by email`}
                className={buttonClass({
                  variant: "secondary",
                  className: "mt-auto w-full",
                })}
              >
                {tier.action} <ArrowRight aria-hidden />
              </a>
            </article>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
          Have a question? Email us at
          <a
            href={CONTACT_MAILTO}
            className="inline-flex items-center gap-2 rounded-sm font-medium text-foreground underline underline-offset-4"
          >
            <MailIcon aria-hidden className="size-4" /> {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}
