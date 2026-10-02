import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { WHATSAPP_URL } from "@/lib/contact";

import { Accent, buttonClass, LEDE, stagger, WRAP } from "./primitives";
import { ProductWindow } from "./product-window";

// First word renders on the server and without motion; the rest cycle in.
const PAIN_WORDS = ["paperwork.", "Excel sheets.", "registers."];

function PainWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = setInterval(() => setIndex((i) => (i + 1) % PAIN_WORDS.length), 2600);

    return () => clearInterval(timer);
  }, []);

  return (
    <Accent>
      <span className="sr-only">{PAIN_WORDS[0]}</span>
      <span aria-hidden className="inline-grid">
        {PAIN_WORDS.map((word, i) => (
          <span
            key={word}
            className={`col-start-1 row-start-1 transition-[opacity,translate] duration-300 ease-out ${i === index ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
          >
            {word}
          </span>
        ))}
      </span>
    </Accent>
  );
}

export function LandingHero() {
  return (
    <section className="relative overflow-hidden pt-12 md:pt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-size-[32px_32px] text-foreground"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in oklch, currentColor 10%, transparent) 1px, transparent 1.5px)",
          maskImage:
            "linear-gradient(to bottom, var(--foreground) 0%, var(--foreground) 40%, transparent 85%)",
        }}
      />
      <div className={WRAP}>
        <div className="relative flex flex-col gap-5 md:gap-6">
          <h1
            className="animate-landing-rise text-[42px] leading-[46px] font-semibold [word-spacing:0.02em] tracking-[0.01em] md:text-[60px] md:leading-[68px] lg:text-[84px] lg:leading-[92px]"
            style={stagger(0)}
          >
            <span className="block">Run your hospital,</span>
            <span className="block">
              not your <PainWord />
            </span>
          </h1>
          <div className="flex flex-col items-start gap-6">
            <p
              className={`${LEDE} max-w-[460px] animate-landing-rise text-muted-foreground`}
              style={stagger(1)}
            >
              OPD, billing, pharmacy and lab in one simple system for Indian hospitals.
            </p>
            <div
              className="flex w-full animate-landing-rise flex-col gap-3 md:w-auto md:flex-row md:flex-wrap"
              style={stagger(2)}
            >
              <a href="/#demo" className={buttonClass({ variant: "primary" })}>
                Book a free demo <ArrowRight aria-hidden />
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary" })}
              >
                <MessageCircle aria-hidden /> Talk on WhatsApp
              </a>
            </div>
            <div
              className="flex animate-landing-rise flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-muted-foreground"
              style={stagger(3)}
            >
              {["ABDM & ABHA ready", "GST invoices", "Data hosted in India"].map((claim) => (
                <span key={claim} className="inline-flex items-center gap-2">
                  <Check aria-hidden className="size-4 text-brand" />
                  {claim}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          className="relative mt-9 animate-landing-rise md:mt-11"
          style={{
            ...stagger(4),
            maskImage: "linear-gradient(to bottom, black 62%, transparent)",
          }}
        >
          <ProductWindow
            name="dashboard"
            region={{ x: 0, y: 0, w: 1440, h: 830 }}
            alt="The Edernal Care dashboard: collections today, who has checked in and who is still waiting."
            className="rounded-b-none rounded-t-2xl border-b-0 shadow-sm"
          />
        </div>
      </div>
    </section>
  );
}
