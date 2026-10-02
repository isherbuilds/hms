import { Accent, Pill, SectionHead, stagger, WRAP } from "./primitives";

const GO_LIVE_STEPS = [
  {
    number: "01",
    label: "Setup",
    tone: "neutral",
    title: "Set up your hospital",
    description: "Your hospital, configured the way it runs.",
    items: ["Departments", "Services", "Staff logins"],
  },
  {
    number: "02",
    label: "Migration",
    tone: "neutral",
    title: "Plan your data move",
    description: "Review the records you need to bring across.",
    items: ["Patients", "Records"],
  },
  {
    number: "03",
    label: "Go live",
    tone: "ok",
    title: "Prepare your team",
    description: "Walk through each desk’s daily work.",
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
              Get your team <Accent>started.</Accent>
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
      </div>
    </section>
  );
}
