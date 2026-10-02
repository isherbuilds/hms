import { ArrowRight } from "lucide-react";

import { Accent, buttonClass, Pill, SectionHead, stagger, WRAP } from "./primitives";

const GO_LIVE_STEPS = [
  {
    number: "01",
    label: "Setup",
    tone: "neutral",
    title: "We visit and set up",
    description: "Your hospital, configured the way it runs.",
    items: ["Departments", "Services", "Staff logins"],
  },
  {
    number: "02",
    label: "Migration",
    tone: "neutral",
    title: "We move your data",
    description: "Nothing retyped at the desk.",
    items: ["Patients", "Records"],
  },
  {
    number: "03",
    label: "Go live",
    tone: "ok",
    title: "We train every desk",
    description: "Every desk, on its own shift.",
    items: ["Reception", "Billing", "Pharmacy"],
  },
] as const;

export function LandingGoLive() {
  return (
    <section className="border-t border-border py-20 md:py-32">
      <div className={WRAP}>
        <SectionHead
          title={
            <>
              Live in days. <Accent>Not six months.</Accent>
            </>
          }
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {GO_LIVE_STEPS.map((step, index) => (
            <div
              key={step.number}
              data-reveal
              style={stagger(index)}
              className="flex min-w-0 flex-col gap-8 rounded-2xl bg-card p-6 ring-1 ring-border md:p-9 lg:min-h-[360px]"
            >
              <b className="text-[108px] leading-[102px] font-semibold tracking-tighter text-muted-foreground/50 tabular-nums">
                {step.number}
              </b>
              <div className="mt-auto flex flex-col items-start gap-4">
                <Pill tone={step.tone} size="lg">
                  {step.label}
                </Pill>
                <div className="flex flex-col gap-2">
                  <h3 className="text-3xl font-semibold tracking-[0.01em]">{step.title}</h3>
                  <p className="text-base text-muted-foreground">{step.description}</p>
                </div>
                <ul className="flex flex-wrap gap-2 border-t border-border pt-5">
                  {step.items.map((item) => (
                    <li key={item} className="rounded-md bg-muted px-2.5 py-1 text-sm font-medium">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col items-start justify-between gap-6 rounded-2xl bg-muted p-6 md:flex-row md:items-center md:px-8 md:py-7">
          <p className="max-w-[680px] text-xl font-semibold tracking-[0.01em] md:text-2xl">
            Want to hear from a hospital like yours? We’ll connect you with an owner.
          </p>
          <a href="/#demo" className={buttonClass({ variant: "primary", className: "shrink-0" })}>
            Talk to a customer <ArrowRight aria-hidden strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </section>
  );
}
