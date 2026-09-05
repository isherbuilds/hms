import { Button } from "@hms/ui/components/button";
import { Link } from "@tanstack/react-router";

import { WHATSAPP_URL } from "@/lib/contact";

import { FEATURES } from "./features";
import { ThemeSwitch } from "./nav";
import { ON_WASH, ON_WASH_BUTTON, ON_WASH_GHOST, ON_WASH_MUTED, Wash } from "./wash";

/* The page's ending: the final ask on the same washed stage the hero opens with,
   then the footer.

   The footer follows Midday's shape rather than the usual SaaS link dump: four
   link columns, a tagline, honest status badges, a theme control, and an
   oversized wordmark at the bottom. The part worth copying is the honesty —
   Midday ships a "SOC2 In progress" badge instead of hiding the gap, which is
   exactly how ABDM should read here. */

/* Every link here has a page behind it. Terms and a data-processing agreement
   return when they are written; Careers and Documentation when they exist. */
const COLUMNS: {
  heading: string;
  items: {
    label: string;
    to: "/about" | "/contact" | "/changelog" | "/privacy";
  }[];
}[] = [
  {
    heading: "Company",
    items: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  { heading: "Legal", items: [{ label: "Privacy", to: "/privacy" }] },
];

/* Stated, not implied. A badge that says "not yet" is worth more here than a row
   of marks we do not hold — and the ABDM answer in the FAQ says the same thing,
   so the page cannot contradict itself. */
const BADGES: { label: string; state: "held" | "pending" }[] = [
  { label: "Tenant-isolated by design", state: "held" },
  { label: "Private file storage", state: "held" },
  { label: "ABDM — not yet certified", state: "pending" },
];

export function LandingClosing() {
  return (
    <>
      {/* `scroll-mt` clears the sticky bar: without it an anchor lands with its
          heading hidden behind the header. */}
      <section
        id="contact"
        className="mx-auto w-full max-w-336 scroll-mt-16 px-5 pt-20 sm:px-6 sm:pt-28"
      >
        <div className="relative overflow-hidden rounded-2xl px-6 py-14 sm:px-16 sm:py-16">
          <Wash />
          {/* The wash never inverts, so everything drawn on it uses the pinned
              ink from `wash.tsx` rather than a theme token. */}
          <div className="relative flex flex-col items-center gap-5 text-center">
            <h2
              className={`max-w-2xl text-3xl font-medium tracking-tight text-balance sm:text-4xl ${ON_WASH}`}
            >
              Start with tomorrow morning.
            </h2>
            <p className={`max-w-md text-lg text-pretty ${ON_WASH_MUTED}`}>
              One hospital, one afternoon of setup, and the desk is on it the next day.
            </p>
            <div className="mt-1 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
              {/* Same pairing as the hero: the walkthrough is the primary ask,
                  because "Open your hospital" is a login wall to anyone
                  without an account. */}
              <Button
                size="lg"
                className={`h-11 w-full normal-case sm:h-9 sm:w-auto ${ON_WASH_BUTTON}`}
                nativeButton={false}
                render={<a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" />}
              >
                Book a walkthrough
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className={`h-11 w-full normal-case sm:h-9 sm:w-auto ${ON_WASH_GHOST}`}
                nativeButton={false}
                render={<Link to="/join" />}
              >
                Open your hospital
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-336 px-5 pt-20 sm:px-6 sm:pt-24">
        <div className="grid gap-10 border-t border-border pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-5">
            <p className="max-w-xs text-sm text-pretty">
              One system, from the first token of the morning to the last rupee of the day.
            </p>
            <div className="flex flex-col gap-2">
              {BADGES.map((badge) => (
                <span key={badge.label} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${
                      badge.state === "held" ? "bg-clinical-clear" : "bg-clinical-note"
                    }`}
                  />
                  <span className="text-muted-foreground">{badge.label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 lg:grid-cols-3 lg:justify-self-end lg:gap-16">
            <nav className="flex flex-col gap-2 text-xs">
              <span className="text-muted-foreground">Product</span>
              {FEATURES.map((feature) => (
                <Link key={feature.to} to={feature.to} className="py-1 hover:underline sm:py-0">
                  {feature.label}
                </Link>
              ))}
            </nav>
            {COLUMNS.map((column) => (
              <nav key={column.heading} className="flex flex-col gap-2 text-xs">
                <span className="text-muted-foreground">{column.heading}</span>
                {column.items.map((item) => (
                  <Link key={item.to} to={item.to} className="py-1 hover:underline sm:py-0">
                    {item.label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 pt-12 pb-8 sm:pt-16 sm:pb-10">
          <p className="text-xs text-muted-foreground">
            © 2026 HMS. Accounts are created by your administrator.
          </p>
          <ThemeSwitch />
        </div>

        {/* Midday's oversized wordmark: the last thing on the page is the name,
            at a size nothing else on the site uses. Clipped at the baseline so it
            reads as a mark rather than as a heading that ran away. */}
        <div aria-hidden className="-mb-2 overflow-hidden sm:-mb-6">
          <span className="block text-center text-[26vw] leading-[0.78] font-medium tracking-tighter text-muted select-none sm:text-[18vw]">
            HMS
          </span>
        </div>
      </footer>
    </>
  );
}
