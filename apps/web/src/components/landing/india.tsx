import { useState } from "react";

import { Accent, SectionHead, stagger, WRAP } from "./primitives";

/* `coming` marks a claim the product does not do yet, so the page never shows
   more than the software holds. */
const INDIA_FEATURES = [
  {
    glyph: "ABHA",
    title: "ABDM ready",
    description: "Create or link ABHA numbers at registration.",
    coming: true,
  },
  {
    glyph: "TPA",
    title: "Insurance and TPA",
    description: "Pre-auth, approvals and claims tracked per patient.",
    coming: true,
  },
  {
    glyph: "अ",
    title: "English and Hindi",
    description: "Each user picks a language.",
    coming: true,
  },
  {
    glyph: "NABH",
    title: "Audit-ready records",
    description: "Consent, nursing notes and discharge summaries, as inspectors ask.",
    coming: true,
  },
  {
    glyph: "4G",
    title: "Light on the internet",
    description: "Loads fast on ordinary broadband or a phone hotspot.",
    coming: false,
  },
  {
    glyph: "IN",
    title: "Your data stays in India",
    description: "Indian servers, encrypted, with daily backups.",
    coming: false,
  },
  {
    glyph: "+91",
    title: "A person to call",
    description: "Phone and WhatsApp support from people who know a billing counter.",
    coming: false,
  },
] as const;

type IndiaFeature = (typeof INDIA_FEATURES)[number];

const GROUPING = [
  {
    id: "in",
    label: "Indian",
    amount: "12,45,000",
    caption: "Twelve lakh forty-five thousand",
  },
  {
    id: "intl",
    label: "International",
    amount: "1,245,000",
    caption: "Same amount, harder to read at a counter",
  },
] as const;

/* The one live demo: the same amount in Indian and international grouping.
   The number remounts on change and enters through a short blur-fade, so old
   and new read as one value changing. The thumb slides on `transform`. */
function RupeeGrouping() {
  const [index, setIndex] = useState(0);
  const current = GROUPING[index]!;

  return (
    <div className="flex flex-col items-start gap-3">
      <div
        role="group"
        aria-label="Number grouping"
        className="relative grid w-fit auto-cols-fr grid-flow-col rounded-lg bg-muted p-0.5"
      >
        <span
          aria-hidden
          style={{
            width: `calc((100% - 4px) / ${GROUPING.length})`,
            transform: `translateX(${index * 100}%)`,
          }}
          className="absolute inset-y-0.5 left-0.5 rounded-md bg-card shadow-xs transition-transform duration-200 ease-out"
        />
        {GROUPING.map((option, optionIndex) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={index === optionIndex}
            onClick={() => setIndex(optionIndex)}
            className={`relative min-h-9 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-[color,transform] duration-150 ease-out active:scale-[0.97] ${index === optionIndex ? "text-foreground" : "text-muted-foreground pointer-fine:hover:text-foreground"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        key={current.id}
        className="flex flex-col gap-1 transition-[opacity,filter] duration-200 ease-out starting:opacity-0 starting:blur-[3px]"
      >
        <p className="text-4xl font-semibold tracking-tight tabular-nums">₹{current.amount}</p>
        <p className="text-sm text-muted-foreground">{current.caption}</p>
      </div>
    </div>
  );
}

function Cell({
  feature,
  index,
  className = "",
}: {
  feature: IndiaFeature;
  index: number;
  className?: string;
}) {
  return (
    <div
      data-reveal
      style={stagger(index)}
      className={`flex min-w-0 flex-col justify-between gap-3 p-4 md:px-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* The installed Devanagari face is only bundled for PDFs, so the
            browser uses its system Devanagari fallback if it is absent. */}
        <span
          aria-hidden
          className={`leading-10 font-semibold tracking-tighter ${feature.glyph.length <= 2 ? "text-4xl" : "text-3xl"} ${feature.glyph === "अ" ? "font-['Noto_Sans_Devanagari',system-ui,sans-serif]" : ""}`}
        >
          {feature.glyph}
        </span>
        {feature.coming && (
          <span className="rounded-md bg-muted px-2 text-xs leading-5 font-medium whitespace-nowrap text-muted-foreground">
            Coming
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{feature.title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{feature.description}</p>
      </div>
    </div>
  );
}

export function LandingIndia() {
  return (
    <section id="india" className="scroll-mt-20 py-20 md:py-32">
      <div className={WRAP}>
        <SectionHead
          title={
            <>
              Made for how Indian hospitals <Accent>actually work.</Accent>
            </>
          }
        />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-12">
          <div
            data-reveal
            className="col-span-2 flex flex-col justify-between gap-5 bg-brand-surface p-5 md:p-6 lg:col-span-6 lg:row-span-2"
          >
            <span
              aria-hidden
              className="text-[96px] leading-[88px] font-semibold tracking-tighter text-brand md:text-[112px] md:leading-[104px]"
            >
              ₹
            </span>
            <div className="flex flex-col gap-4">
              <RupeeGrouping />
              <div className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold">Rupees, lakhs and crores</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  Indian number grouping, GST invoices, UPI and cash.
                </p>
              </div>
            </div>
          </div>
          {INDIA_FEATURES.slice(0, 6).map((feature, index) => (
            <Cell
              key={feature.title}
              feature={feature}
              index={index % 3}
              className={`bg-card ${index < 4 ? "lg:col-span-3" : "lg:col-span-4"}`}
            />
          ))}
          <Cell
            feature={INDIA_FEATURES[6]}
            index={2}
            className="col-span-2 bg-foreground text-background lg:col-span-4 [&_p]:text-background/70"
          />
        </div>
      </div>
    </section>
  );
}
