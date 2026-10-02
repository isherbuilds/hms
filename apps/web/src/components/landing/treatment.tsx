import { PlanItemRow } from "@/components/treatment-plan-item";

import { Accent, EYEBROW, Pill, SectionHead, stagger, WRAP } from "./primitives";

const STEPS = [
  {
    title: "Quote the whole course",
    description:
      "Set the work, its total price and the expected sittings. Keep the quote with the patient.",
  },
  {
    title: "Bill this sitting",
    description:
      "Link each OPD appointment to the plan and bill the work delivered. Track what is billed and what remains.",
  },
  {
    title: "Keep the advance with the plan",
    description:
      "Record an advance, apply available credit when collecting a bill, and refund unused credit when needed.",
  },
] as const;

export function LandingTreatment() {
  return (
    <section id="treatment" className="scroll-mt-20 py-20 md:py-32">
      <div className={WRAP}>
        <SectionHead
          title={
            <>
              One course. <Accent>Every sitting accounted for.</Accent>
            </>
          }
        />
        <div className="grid items-center gap-9 lg:grid-cols-2 lg:gap-16">
          <ol className="flex flex-col gap-7">
            {STEPS.map((step, index) => (
              <li key={step.title} data-reveal style={stagger(index)} className="flex gap-4">
                <span className={`${EYEBROW} pt-1 text-brand tabular-nums`}>0{index + 1}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="text-base leading-7 text-muted-foreground">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
          <div
            data-reveal
            style={stagger(1)}
            className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-5 md:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className={`${EYEBROW} text-muted-foreground`}>Illustrative treatment plan</p>
                <h3 className="text-lg font-semibold">Physiotherapy · Meena Joshi</h3>
              </div>
              <Pill>Active</Pill>
            </div>
            <PlanItemRow
              currency="INR"
              item={{
                description: "Physiotherapy course",
                note: null,
                status: "open",
                postedSittings: 3,
                postedAmount: BigInt(120000),
                sittingsPlanned: 10,
                quotedPrice: BigInt(400000),
                done: false,
              }}
            />
            <p className="text-sm leading-6 text-muted-foreground">
              The quote stays with the course. Charges and invoices stay with the sitting that
              delivered the work.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
