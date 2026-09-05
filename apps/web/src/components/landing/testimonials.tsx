import { ON_WASH, ON_WASH_MUTED, Wash } from "./wash";

/* ⚠ THE QUOTES BELOW ARE PLACEHOLDER AND THIS SECTION IS LIVE ON `/`.
 *
 * Every quote is written, not collected. That is fine while the site is not
 * public and is a deliberate choice by the author; it is not fine the day this
 * domain is reachable, because an invented testimonial reads as a real
 * endorsement. Replace every entry in QUOTES with something a customer actually
 * said before launch, then delete this notice.
 *
 * The Ledger layout needs a `metric` on the lead quote to work as designed. If
 * the first real quote has no number attached, either find one or drop the
 * `metric` field and the layout falls back cleanly.
 *
 * Attribution is a role and a hospital shape rather than a person's name. The
 * healthcare references all pair a quote with a clinician's portrait
 * (docs/research/landing-page-composition.md); we have no photos and no
 * permission, so the attribution has to carry that weight on its own. */

type Quote = {
  key: string;
  quote: string;
  who: string;
  where: string;
  metric?: { value: string; label: string };
};

const QUOTES: Quote[] = [
  {
    key: "close",
    quote:
      "We used to reconcile the drawer at nine at night. Now the day-close report is done before the last patient leaves.",
    who: "Cashier",
    where: "40-bed hospital, Pune",
    metric: { value: "40 min", label: "saved at day close" },
  },
  {
    key: "queue",
    quote: "The front desk stopped asking me who was next. They can see it.",
    who: "Medical director",
    where: "Multispecialty clinic, Nashik",
  },
  {
    key: "audit",
    quote:
      "My auditor asked for the GST register and I sent it in about a minute. That has never happened before.",
    who: "Accountant",
    where: "Two-branch clinic, Pune",
  },
  {
    key: "records",
    quote:
      "Patients used to bring their file. Now we find them by phone number before they finish saying it.",
    who: "Reception lead",
    where: "60-bed hospital, Aurangabad",
  },
  {
    key: "switch",
    quote:
      "We moved off paper in a week. The staff who were most worried are the ones who use it most.",
    who: "Owner",
    where: "Day-care surgical centre, Mumbai",
  },
];

/* The lead quote sits on the wash with the number it is about; the rest run as a
   hairline list beside it. A quote next to nothing measurable is a compliment,
   not a claim. */
export function LandingTestimonials() {
  const [lead, ...rest] = QUOTES;
  if (!lead) return null;

  return (
    <section className="mx-auto flex w-full max-w-336 flex-col gap-8 px-5 pt-20 sm:gap-12 sm:px-6 sm:pt-28">
      <h2 className="max-w-2xl text-3xl font-medium tracking-tight text-balance sm:mx-auto sm:text-center sm:text-4xl">
        What changed at the desk.
      </h2>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <figure className="relative flex flex-col justify-between gap-8 overflow-hidden rounded-2xl p-6 sm:gap-10 sm:p-8 lg:p-12">
          <Wash />
          {/* The wash never inverts, so everything drawn on it uses the pinned
              ink from `wash.tsx` rather than a theme token. */}
          <blockquote
            className={`relative text-xl leading-[1.45] text-pretty sm:text-2xl ${ON_WASH}`}
          >
            “{lead.quote}”
          </blockquote>
          <figcaption className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-col gap-0.5">
              <span className={`text-sm font-medium ${ON_WASH}`}>{lead.who}</span>
              <span className={`text-xs ${ON_WASH_MUTED}`}>{lead.where}</span>
            </div>
            {lead.metric && (
              <div className="flex flex-col items-end">
                <span className={`text-3xl font-medium tabular-nums ${ON_WASH}`}>
                  {lead.metric.value}
                </span>
                <span className={`text-xs ${ON_WASH_MUTED}`}>{lead.metric.label}</span>
              </div>
            )}
          </figcaption>
        </figure>

        {/* The quote leads and the attribution follows it, so the attribution is
            set smaller than the quote rather than heavier than it. `leading-relaxed`
            because two- and three-line quotes at this size close up at the default
            1.45, and the gap inside a quote has to stay clearly tighter than the
            gap between one quote and the next. */}
        <div className="flex flex-col pt-2 lg:pt-0 lg:pl-2">
          {rest.map((q) => (
            <figure
              key={q.key}
              className="flex flex-col gap-4 border-b border-border py-7 first:pt-0 last:border-0"
            >
              <blockquote className="text-base leading-relaxed text-pretty">“{q.quote}”</blockquote>
              <figcaption className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{q.who}</span>
                <span className="text-xs text-muted-foreground">{q.where}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
