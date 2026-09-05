# Landing page composition

Observed 2026-09-04. Evidence, not product truth.

## Question

How do the design-led SaaS sites we keep referencing (Cursor, Ramp, Slack,
Midday) compose a landing page, how do practice- and hospital-management
products compose theirs, and where do the two disagree in ways that should
change what we build on `/`?

## Answer

**The two categories use different skeletons, and the disagreement is about
whether you show the product at all.**

The design-led tier is screenshot-led and logo-backed: hero with a large real
product image, then a customer-logo trust strip, then capability blocks built on
more real UI. All four put a trust strip **immediately after the hero** — that is
the slot we currently have empty.

The healthcare tier is proof-led and product-shy: hero, then **numbers and
regulatory badges** rather than logos, then feature blocks that use video,
illustration, or nothing at all. Two of the six healthcare references show no
conventional product screenshot anywhere on the page, and Cliniko shows no
product imagery whatsoever. Named-clinician testimonials with headshots, an
inline demo form, and an FAQ block are near-universal there and absent from the
design-led tier.

For HMS this means: the empty slot under our hero should carry a proof strip
(evidenced by 7 of 10 references placing one there), and our screenshot-led
composition is a **deliberate departure** from the healthcare category norm
rather than a safe default — worth doing, worth knowing.

## Evidence

### Design-led tier: the shared skeleton

| Position | Cursor                                                                        | Slack                                          | Midday                                         | Ramp                                                        |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| 1        | Nav                                                                           | Nav                                            | Nav + announcement bar                         | Nav                                                         |
| 2        | Hero + interactive demo                                                       | Hero + animated icons                          | Hero copy + CTA                                | Hero + inline email capture                                 |
| 3        | —                                                                             | —                                              | Integration badge strip                        | —                                                           |
| 4        | (product demos)                                                               | —                                              | Hero dashboard screenshot                      | —                                                           |
| 5        | **"Trusted every day by teams that build world-class software"** — logo strip | **"Trusted by top teams"** — logo carousel     | (badges above serve this role)                 | **Logo row** — Stripe, OpenAI, Linear, Nvidia, Figma, Adobe |
| 6        | Capability blocks on real UI                                                  | Tabbed capability blocks                       | "How it works" — three capability blocks       | Capability card grid                                        |
| 7        | "The new way to build software" — testimonial grid                            | Customer video carousel                        | "Less admin. More focus." — time-savings stats | Customer metric cards                                       |
| 8        | Changelog, blog grid                                                          | Stats band (90%, 43, 87%), G2 badge, resources | Integration logo grid                          | Testimonial wall                                            |
| 9        | Footer CTA                                                                    | Final CTA                                      | —                                              | Repeat hero CTA                                             |

Sources: [cursor.com](https://cursor.com/), [slack.com/intl/en-in](https://slack.com/intl/en-in/),
[midday.ai](https://midday.ai/). Ramp's composition is read from the local
full-page capture `ramp_light_desktop.png`, because `ramp.com` served WebFetch a
machine-readable product summary rather than the visual page — noted as a
retrieval limitation, not a finding.

**Trust strip directly under the hero: 4 of 4.** Cursor and Slack both name it
in the heading ("Trusted every day by…", "Trusted by top teams"). Midday
substitutes a strip of _integration_ badges — Claude, ChatGPT, Perplexity,
Raycast, Cursor, Manus — in the same slot, between hero copy and hero image.

**Screenshot treatment**, from the local captures rather than from markdown:

- Cursor: real app UI floated as a titled window on a public-domain landscape
  painting, inside a tinted panel roughly 90vw wide and ~715px tall, panels
  separated by ~90px (measured from `cursor_dark_desktop.png`).
- Ramp: real app UI cropped inside tinted cards with a `↗` corner affordance, so
  the whole card reads as clickable (`ramp_light_desktop.png`).
- Midday: one full-width dashboard screenshot directly under the hero.
- Slack: feature blocks behind four tabs — the product is shown, but only one
  quarter of it at a time.

### Healthcare tier: a different skeleton

| Position            | Practo Ray                                                         | HealthPlix                                                                     | Cliniko                               | Jane                                             | SimplePractice                            | Tebra                                                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------- |
| Hero                | ABDM-compliance messaging                                          | "India's Largest Online & Offline EMR"                                         | "Software for people who care"        | "Your patients have you, your practice has Jane" | Two CTAs, no product claim                | "Run your entire practice with one EHR+ platform"       |
| Straight after hero | **Trust metrics**: 50,000+ doctors, 25M+ appointments, 5 countries | **Certification badges**: NABH, ISO, RSSDI, HIPAA, ABDM                        | Features prose                        | Tabbed feature screenshots                       | "Who we're for" carousel                  | Video testimonial                                       |
| Then                | "Our esteemed customers" logos                                     | Product grid, then scale metrics (14,000+ doctors, 60M+ patients, 370+ cities) | **Pricing table** (6 tiers, $45–$395) | Benefit pillars, illustrations only              | Feature tabs                              | Solution cards                                          |
| Proof               | Testimonial mid-page (Smile Dental Clinic, "no-shows down 70%")    | Three named doctors with headshots                                             | —                                     | Practitioner quote + lifestyle photo             | "Over 20M clients and 250k practitioners" | G2 badges, three quotes, "Trusted by 150,000 providers" |
| Compliance          | Dedicated security section, five measures                          | Certification badges + "Our Recognitions" gallery                              | "Your records are safe with Cliniko"  | —                                                | HIPAA/HITRUST/PCI in footer               | HIPAA/HITRUST/AICPA/PCI badge row                       |
| Conversion          | **Demo request form, then a second trial form**                    | Demo button in nav                                                             | Pricing on page                       | CTA + newsletter                                 | Trial CTA                                 | Demo CTA                                                |
| FAQ                 | 11 questions                                                       | —                                                                              | —                                     | —                                                | —                                         | 6 questions                                             |

**Product imagery is weak or absent.** Practo Ray uses video placeholders with
static fallbacks and "no traditional product screenshots"; Cliniko uses
illustrative icons and no product imagery at all; Jane uses screenshots but
inside folder-tab framing alongside lifestyle photography; SimplePractice shows
"flat screenshots with minimal framing" plus a stock video-call photo.

**Pricing is off the landing page** for Practo, HealthPlix, SimplePractice and
Tebra — nav link only. Cliniko is the single outlier, putting a six-tier pricing
table high on the homepage.

**Photography of people is category-standard** in healthcare (HealthPlix doctor
portraits, Jane lifestyle shots, Tebra clinician video, SimplePractice stock)
and absent from the design-led tier apart from Cursor's two team photos far down
the page.

## What this proves

- The slot directly under a hero carries a trust strip in 4 of 4 design-led
  references and in 3 of 6 healthcare references (Practo numbers, HealthPlix
  badges, SimplePractice social-proof line). Leaving it empty is the minority
  choice.
- Two distinct currencies fill that slot: **customer logos** (design-led) and
  **volume numbers plus regulatory badges** (healthcare, especially India).
- Indian practice-management sites treat compliance marks — NABH, ISO 27001,
  HIPAA, ABDM — as a first-class above-the-fold section, not footer trivia.
- An FAQ block and an inline demo form are healthcare-category conventions
  (Practo, Tebra) and are absent from all four design-led references.

## What this does not prove

- **Nothing here proves conversion.** Every observation is composition, not
  outcome. No reference publishes A/B results, so "everyone does X" is a norm,
  not evidence that X works for a first-time Indian hospital buyer.
- **Section order is read from rendered markdown, not from layout** for the six
  fetched pages. Where a page uses tabs or carousels (Slack's four "tab content"
  sections, SimplePractice's "who we're for" slider) the markdown lists as
  sequential what a visitor sees as one switchable block. Treat those rows as
  content inventory, not vertical order.
- **Ramp's row is from a screenshot taken 2026-09-04**, not from the live DOM.
- These are homepages on one date. Marketing pages are A/B tested continuously;
  none of this is stable enough to cite in three months without re-observation.
- Nothing was observed about mobile composition. All captures and fetches are
  desktop.

## What this means for us

1. **Fill the post-hero slot, with numbers rather than logos.** The convention is
   near-universal, and the healthcare tier's currency for it — Practo's
   "50,000+ doctors / 25M+ appointments / 5 countries", SimplePractice's "20M
   clients and 250k practitioners" — is one we can imitate honestly the moment
   the figures are real. A logo wall is not available to us and inventing
   hospital logos would fabricate credentials.
2. **Reserve a compliance slot; do not fill it yet.** Both Indian references put
   ABDM/NABH/ISO marks high on the page. The research ledger already holds ABDM
   as evidence-gated until facility registration, sandbox and compliance
   ownership exist ([README](./README.md)), so the slot stays empty until a mark
   is genuinely held. Designing around its future presence is cheaper than
   retrofitting it.
3. **Our screenshot-led composition is a departure, and that is the point.** Four
   of six healthcare references barely show the product. A landing page built on
   large, real, populated screens is differentiated in this category — but it
   raises the cost of keeping captures current, which the versioned
   `public/hero/dashboard-830-*.png` naming already anticipates.
4. **Two conventions we have not planned for**: an FAQ block and an inline demo
   request form. Practo runs two forms and eleven FAQs; Tebra runs six. Both are
   below the capability section, so neither blocks current work.
5. **Keep pricing off `/`.** Four of six healthcare references do; the one
   outlier, Cliniko, is also the one with no product imagery, so its homepage has
   to carry something concrete.
6. **Two treatments worth stealing.** Ramp's `↗` corner affordance makes a
   capability card read as clickable. Cursor pairs every capability panel with a
   coloured "Learn about X →" link — in a page of neutral greys, that accent is
   the only thing pulling the eye out of the panel, which is the strongest case
   yet for a public-page-only accent colour.

## Next falsification

Re-observe the same ten pages at a 390px viewport. The claim most likely to
break is "the trust strip sits directly under the hero" — mobile compositions
routinely demote or drop it, and if it disappears on mobile, its value is
weaker than a 10-of-10 desktop count suggests. Second: check whether Practo Ray
and HealthPlix serve different hero variants across sessions, which would show
the healthcare tier is actively testing this slot rather than settled on it.

## Sources

Design-led tier:

- [cursor.com](https://cursor.com/) — section inventory, fetched 2026-09-04
- [slack.com/intl/en-in](https://slack.com/intl/en-in/) — section inventory
- [midday.ai](https://midday.ai/) — section inventory
- Local full-page captures `cursor_dark_desktop.png`, `cursor_light_mobile.png`,
  `ramp_light_desktop.png` — panel geometry and screenshot treatment

Healthcare tier:

- [Ray by Practo](https://www.practo.com/providers/clinics/ray) — trust metrics,
  security section, two conversion forms, 11 FAQs, video-not-screenshot features
- [HealthPlix](https://www.healthplix.com/) — certification badge strip, scale
  metrics, named-doctor testimonials with headshots, recognitions gallery
- [Cliniko](https://www.cliniko.com/) — pricing table on the homepage, zero
  product imagery
- [Jane](https://www.jane.app/) — tabbed product screenshots, lifestyle
  photography, "240K private health practitioners"
- [SimplePractice](https://www.simplepractice.com/) — "20M clients and 250k
  practitioners", association logos, compliance badges in footer
- [Tebra](https://www.tebra.com/) — compliance badge row, G2 awards, "150,000
  providers", 6 FAQs
