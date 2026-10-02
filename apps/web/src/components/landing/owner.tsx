import { History, Lock, TriangleAlert, Zap } from "lucide-react";

import { Accent, EYEBROW, LEDE, Pill, SECTION_HEADING, stagger, WRAP } from "./primitives";

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

const SPARK_HEIGHTS = [30, 42, 38, 55, 48, 62, 58, 74, 66, 88] as const;

const MINI_STATS = [
  { label: "To bill", value: "₹5,550" },
  { label: "Open money", value: "₹42,696" },
  { label: "Over 30 days", value: "₹18,500" },
  { label: "Refunds due", value: "₹1,900" },
] as const;

function OwnerPhone() {
  return (
    <div
      data-reveal
      style={stagger(1)}
      aria-label="Owner app preview"
      className="w-[300px] max-w-full justify-self-center rounded-[48px] bg-band-raised p-3 shadow-[0_40px_80px_-20px_color-mix(in_oklch,var(--band)_60%,transparent)] ring-1 ring-band-line md:w-[340px]"
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-[38px] bg-background px-4.5 pt-4.5 pb-5.5 text-foreground md:min-h-[640px]">
        <div aria-hidden className="mx-auto mb-1.5 h-6.5 w-24 rounded-xl bg-band" />
        <div className="flex items-center justify-between gap-2">
          <div>
            <b className="text-lg leading-6 font-semibold">Navjeevan Hospital</b>
            <small className="block text-xs text-muted-foreground">Today · updated just now</small>
          </div>
          <Pill tone="ok" live>
            Live
          </Pill>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl bg-band p-4.5 text-band-foreground">
          <small className={`${EYEBROW} text-band-muted`}>Collections today</small>
          <strong className="text-4xl font-semibold tracking-tight tabular-nums">₹28,427</strong>
          <span className="text-sm text-band-muted">41 receipts · OPD and pharmacy</span>
          <div aria-hidden className="mt-2.5 flex h-13.5 items-end gap-[5px]">
            {SPARK_HEIGHTS.map((height, index) => (
              <i
                key={index}
                data-reveal-col
                style={stagger(index, { height: `${height}%` })}
                className={`flex-1 rounded-xs ${index === SPARK_HEIGHTS.length - 1 ? "bg-brand-bright" : "bg-band-line"}`}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {MINI_STATS.map((stat) => (
            <div
              key={stat.label}
              className="min-w-0 rounded-xl border border-border bg-card px-2 py-3 md:px-3.5"
            >
              <small className="block text-xs text-muted-foreground">{stat.label}</small>
              <b className="text-lg font-semibold tabular-nums md:text-xl">{stat.value}</b>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2.5 rounded-xl bg-clinical-note-surface px-3.5 py-3 text-sm text-clinical-note">
          <TriangleAlert aria-hidden className="mt-px size-4.5 shrink-0" strokeWidth={1.75} />
          <span>
            <b className="block font-semibold text-foreground">4 visits not billed</b>
            ₹5,550 · bill them before they leave
          </span>
        </div>
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
