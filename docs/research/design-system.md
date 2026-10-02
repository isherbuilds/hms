# Design system: audience, shape, dashboard, public site, performance

Observed 2026-10-02. Evidence, not product truth. [Design](../design.md) and
[decisions](../decisions.md) stay authoritative until a conclusion below is
accepted and promoted.

## Question

What design system should Edernal Care's signed-in console (dashboard and org
routes) and public site follow, given who uses and buys it, so it looks calm and
premium, stays fast, and uses a shape language that is neither pill-round nor
square?

## Answer

**Keep the system's core; fix drift, safety and contrast; spend new design
effort on content, not a new skin.** Evidence does not justify a new font,
palette or layout model. It does justify:

1. **Direction — "daylight clinical workspace."** Neutral grey surfaces, ink
   actions, deep-green signposts, real product screens as the one memorable
   element. This avoids the three generated-design clusters (cream + serif +
   terracotta; near-black + acid accent; zero-radius broadsheet) and matches
   what buyers and staff need: proof of the actual OPD → bill workflow.
2. **Shape — restrained rounded rectangles that scale with size.** Small
   things get small radii, containers get larger ones, nested corners stay
   concentric. Proposed console scale **2 / 4 / 6 / 10 / 14 px** (detail /
   checkbox and row buttons / controls / cards, menus, dialogs / shells,
   sheets), down from today's 6/8/10/14. Public site uses the same tokens one
   step up (cards 14, screenshot stages 18) instead of today's off-scale 16–28 px.
3. **Safety and truth before polish.** Unrecorded allergies render as "No known
   allergies" in green; dashboard read failures render as "Nobody is waiting" /
   "Every visit is billed"; collection labels round ₹100 to "₹0k"; light status
   badges fail AA; the public site claims "ABDM & ABHA ready" beside "Coming".
4. **The dashboard should answer "what needs doing now"** — queue first,
   three actionable counts second, collection trend last — on the existing
   `Panel`/`ListState` primitives, not its bespoke `Card` and larger scale.
5. **Performance is won in fonts and landing scroll code**, not in visual
   austerity: `₹` forces Inter's 133 KB Latin-ext file; landing scroll effects
   read layout every frame and loop JS under reduced motion.

One recommendation is genuinely contested and needs an owner test, not a
default: **12 px body text** (see [Open decision](#open-decision-body-size)).

## Evidence

### Audience

- Users are non-technical, high-frequency desk staff (reception, billing,
  pharmacy) and owners; the buyer is the owner ([product](../product.md),
  AGENTS.md "UI"). Administrative workflows are explicitly in scope for
  usability evaluation ([AHRQ workflow toolkit](https://digital.ahrq.gov/health-it-tools-and-resources/evaluation-resources/workflow-assessment-health-it-toolkit));
  [NISTIR 7804](https://www.nist.gov/system/files/documents/2017/05/09/NISTIR-7804.pdf)
  §§3–5 requires representative users and realistic tasks, measuring errors and
  recovery, not expert opinion.
- Patient identity is persistent safety context: two or more identifiers in
  lists, full name, DOB/age, sex, MRN, consistent prominent placement
  ([SAFER Guide 6, 2025](https://www.healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf),
  practices 1.2–1.3); paediatric age needs units
  ([NISTIR 7865](https://nvlpubs.nist.gov/nistpubs/ir/2012/NIST.IR.7865.pdf) I-C).
- Allergy status has three values — recorded, none known, unable to ascertain
  ([NICE CG183 §1.2.1](https://www.nice.org.uk/guidance/cg183/chapter/Recommendations)).
  HMS collapses unknown into "No known allergies" on the clear token
  (`apps/web/src/routes/$orgSlug/patients/$patientId/route.tsx:82-91`, verified).
- Indian formatting: CLDR `en_IN` supplies `#,##,##0.00` grouping and day-first
  dates ([CLDR en_IN](https://raw.githubusercontent.com/unicode-org/cldr/main/common/main/en_IN.xml));
  `lib/money.ts` already formats `₹12,34,567.89`. Transaction amounts must not
  be abbreviated to lakh/crore. ABDM's HMIS guidance asks only for
  "user-friendly" navigation; no UI token standard exists
  ([ABDM HMIS guidance](https://abdm.gov.in/strapicms/uploads/Guidance_Document_for_ABDM_Compliant_HMIS_LMIS_d066e52a6d.pdf)).
- Body size: WCAG sets no minimum font size, only 200% resize
  ([1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)).
  USWDS recommends ≥16 px for most text, smaller sparingly for tables
  ([USWDS](https://designsystem.digital.gov/components/typography/)); NHS uses
  19/16 px body and 16/14 px small copy
  ([NHS](https://service-manual.nhs.uk/design-system/styles/typography)); older
  users struggle with small/light text and small targets
  ([NN/g, 123 participants](https://www.nngroup.com/articles/usability-for-senior-citizens/)).
  No source establishes a safe minimum for dense desktop tables.

### Shape: what peer systems actually ship

| System                                                                                                                                               | Radii (px)                                    | Note                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| [GitHub Primer](https://primer.style/product/primitives/size/#border-radius)                                                                         | 3 / **6** / 12 / full                         | default 6                                  |
| [Atlassian (2025 refresh)](https://atlassian.design/foundations/radius)                                                                              | 2 / 4 / **6** / 8 / 12 / 16                   | controls 6                                 |
| [Vercel Geist](https://vercel.com/geist/materials)                                                                                                   | **6** base / 12 menus, modals / 16 fullscreen | radius paired with stroke/shadow           |
| [Fluent 2](https://fluent2.microsoft.design/shapes)                                                                                                  | 0 / 2 / **4** / 8 / 12                        | under-32 px shapes get 2                   |
| [Ant Design 5](https://raw.githubusercontent.com/ant-design/ant-design/5.27.6/components/theme/themes/seed.ts)                                       | 2 / 4 / **6** / 8                             |                                            |
| [Polaris](https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src/themes/base/border.ts)                                           | 0–30, full                                    |                                            |
| [Radix Themes](https://www.radix-ui.com/themes/docs/theme/radius)                                                                                    | 3 / 4 / 6 / 8 / 12 / 16 × factor              | radius depends on component size           |
| [Material 3](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Shape.md)                         | 4 / 8 / 12 / 16 / 28 …                        | expressive, rounder                        |
| [Carbon](https://raw.githubusercontent.com/carbon-design-system/carbon/main/packages/styles/scss/__tests__/__snapshots__/border-radius-test.js.snap) | 0 / 2 / 4 / 8 / 16                            | v12 flag rounds buttons fully              |
| [shadcn base-lyra](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/styles/style-lyra.css)                                       | 0                                             | HMS deliberately rounded its vendored copy |
| [shadcn Vega / Mira](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/styles/style-vega.css)                                     | button 8, card 14 / 8, 10                     |                                            |

- Dense productivity systems cluster at **6 px controls** and **8–12 px
  containers**; consumer/expressive systems (Material, Maia) go rounder. HMS
  today: `sm 6 / md 8 / lg 10 / xl 14` (`packages/ui/src/styles/globals.css:68,168-172`),
  so a 32 px button is 8 px (25% of height) and a 16 px checkbox is 6 px — the
  "reads as a circle" risk design.md §4 already names.
- Nested corners: outer = inner + inset
  ([CSS Backgrounds 3](https://www.w3.org/TR/css-backgrounds-3/#corner-shaping)).
  `Panel` (14 = 10 + 4) and Sheet (16 = 8 + 8 px border,
  `packages/ui/src/components/sheet.tsx:13-14`) are both concentric. §10's
  "2 px boundary" is stale: the Sheet border is 8 px.
- `corner-shape: squircle` is Chrome/Edge 139+ only, not Baseline
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/corner-shape)).
  Optional enhancement at most.
- Public site drift: `rounded-2xl` pricing cards, 28 px role cards
  (`apps/web/src/components/landing/pricing.tsx:73`, `roles-scroll.tsx:156`).

### Signed-in app drift (source audit)

- Dashboard breaks §2/§3/§4/§8: `p-5`, `gap-5`, `lg:p-6`, `text-sm` body,
  `text-4xl` headline, `rounded-xl` cards, a 28 px hand-built selector
  (`apps/web/src/routes/$orgSlug/dashboard.tsx:69,224-255`). Unbilled money uses
  `text-overdue`, which §5 reserves for invoices older than seven days.
- Failed reads become confident empty states: `const open = visits.data?.items ?? []`
  (`dashboard.tsx:200`, verified) feeds "Nobody is waiting".
- The visits query is a 200-row newest-first slice sorted client-side, so busy
  days can omit the oldest waiters (`dashboard.tsx:200-203`;
  `packages/api/src/routers/opd.ts:733-759`).
- `CollectionBars.short()` rounds to thousands: ₹100 → "₹0k"; negative net days
  produce a negative height (`apps/web/src/components/collection-bars.tsx:9-15,46`,
  verified). 14-day labels hide below `sm` (`:38`).
- Elsewhere: Billing stacks an Overview tray above its worklist; Reports repeats
  its title; Settings uses public-only 24 px spacing
  (`billing/index.tsx:187-215`, `reports/daily-collections.tsx:79,98-103`,
  `settings/organization.tsx:178,243`). No route-level `rounded-[…]`, `text-[…]`
  or palette utilities outside the documented print exception.
- D050 records light brand `oklch(0.469 0.095 165)`
  (`docs/decisions.md:701`); live CSS is lime `oklch(0.532 0.141 132)`
  (`globals.css:58`). §13 says money crosses the wire as `numeric` strings; D031
  says `bigint` paise.

### Dashboard practice

- Operational monitoring differs from analysis; lead with exceptions and the
  next action ([NN/g preattentive](https://www.nngroup.com/articles/dashboards-preattentive/),
  [Few](https://www.perceptualedge.com/articles/misc/WhyMostDashboardsFail.pdf)).
- Reference homes lead with work, not KPI tiles: Linear's My Issues
  ([docs](https://linear.app/docs/my-issues)); Practo Ray lands on Calendar
  ([help](https://help.practo.com/practo-ray/getting-started/getting-started-with-ray/));
  Jane on the schedule ([guide](https://jane.app/guide/working-with-the-schedule));
  Stripe pairs metrics with unresolved disputes
  ([docs](https://docs.stripe.com/dashboard/basics)).
- Row density: Carbon defines 32 / 40 / 48 px rows, 40 default
  ([Carbon data table](https://carbondesignsystem.com/components/data-table/usage/)).
  HMS body rows are min 44 px, headers 32 (`packages/ui/src/components/table.tsx:50-63`).
- Feedback after ~1 s ([NN/g response times](https://www.nngroup.com/articles/response-times-3-important-limits/));
  status changes announced politely
  ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).

### Colour and accessibility (computed from tokens)

WCAG 2.2 ratio, light theme, on background / card / muted tray
(OKLCH → sRGB, [WCAG luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance)):

| Token                                    | Ratio                  | Verdict             |
| ---------------------------------------- | ---------------------- | ------------------- |
| `--muted-foreground`                     | 5.63 / 6.00 / 5.00     | pass                |
| `--brand` text                           | 4.69 / 5.00 / **4.16** | fails on muted tray |
| destructive badge (15% fill)             | **3.56 / 3.77 / 3.19** | fails               |
| pending badge                            | **3.75 / 3.97 / 3.36** | fails               |
| overdue badge                            | **3.29 / 3.48 / 2.95** | fails               |
| clinical alert/note/clear on own surface | 5.36 / 5.56 / 5.78     | pass                |

Dark theme passes except destructive badge on muted (4.22). Light
`--brand-fill` is 2.0–2.4:1 and fails the 3:1 non-text rule
([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html))
where a bar edge carries meaning. Focus ring: 9–11:1 light, 5–7:1 dark — keep.
Brand, alert and note share OKLCH lightness ≈0.5 (light) and ≈0.78 (dark), so
hue alone does not separate them under red–green deficiency
([NEI](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/color-blindness/types-color-vision-deficiency));
the existing "word always present" rule is what protects meaning. Positive
polarity (dark on light) reads better as text gets smaller
([PubMed 25141597](https://pubmed.ncbi.nlm.nih.gov/25141597/)) — a reason to
keep light as the default for a 12 px console, not to drop dark.
Targets: `xs`/`icon-xs` buttons are 24 px, the WCAG 2.5.8 AA floor
([2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).

### Typography

- Inter's text optical size has a tall x-height and supports `tnum`, `zero`,
  `ss02`, `cv11` ([rsms.me/inter](https://rsms.me/inter/)); JetBrains Mono
  distinguishes `1/l/I` and `0/O` ([JetBrains](https://www.jetbrains.com/lp/mono/)).
  Alternatives (Geist, IBM Plex, Source Sans 3) carry no evidence of better
  operator outcomes; Plex is the only one with first-party Devanagari.
- Inter has no Devanagari subset
  (`apps/web/node_modules/@fontsource-variable/inter/metadata.json:4-12`); the
  UI has no Devanagari fallback while billing PDFs already ship Noto Sans
  Devanagari (`apps/web/src/lib/billing-pdf.tsx:1-3`).

### Public site

- Home: hero with HTML dashboard illustration → six-stage journey → five-role
  scroll stack → owner phone → India grid → go-live → pricing → FAQ → demo
  (`apps/web/src/routes/index.tsx:33-46`). Feature pages are screenshot-led
  (`components/landing/feature-page.tsx`). Nav exposes anchors, not the three
  product pages (`landing/nav.tsx:8-13`).
- B2B buyers ranked pricing highest of 28 information types; registration
  walls and vague descriptions created distrust
  ([NN/g B2B, 179 sites](https://www.nngroup.com/articles/b2b-usability/));
  scenario prices help when quotes vary
  ([NN/g](https://www.nngroup.com/articles/show-prices-for-common-scenarios/));
  B2B buyers look for local contact and regional expertise
  ([NN/g international B2B](https://www.nngroup.com/articles/international-b2b/)).
- Truth gaps: hero "ABDM & ABHA ready" vs India "Coming" vs FAQ "Not yet"
  (`landing/hero.tsx:187`, `landing/india.tsx:9-12`, `content/faqs.ts:32-34`);
  About says pharmacy does not run while home promotes it
  (`routes/about.tsx:56-58`); `₹[price]` placeholders and `href="#"` footer
  items. D050 records the owner's approval of that copy verbatim.
- Peers (observed 2026-10-02): Practo Ray ties ABDM to concrete record-sharing
  actions; Cliniko and Eka publish prices; CareStack discloses that its ROI
  study is commissioned; Jane leads with a product screenshot and pricing CTA;
  Linear frames a large restrained-radius app window. Full prior inventory:
  [landing page composition](./landing-page-composition.md).
- Landing motion: looping hero word every 2.6 s and live dot without a pause
  control ([WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html));
  360–900 ms entrances against §12's <200 ms; roles track is 440 svh with
  global scroll listeners, permanent `will-change`, per-frame layout reads;
  `useTween` runs JS under reduced motion (`apps/web/src/hooks/use-scrub.ts:21-48,69-89`,
  `landing/roles-scroll.tsx:13-33,89-118,156`). No animation library is a
  dependency.

### Performance

- Thresholds: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 at field p75
  ([web.dev](https://web.dev/articles/vitals)); a visually identical page with
  31% better LCP sold 8% more ([Vodafone](https://web.dev/case-studies/vodafone)).
- Fonts (measured on disk): Inter opsz Latin 72.9 KB, Latin-ext 133.3 KB,
  JetBrains Mono Latin 40.4 KB. `₹` (U+20B9) is in Latin-ext, so every money
  screen pays ~247 KB of fonts; no font preload in `routes/__root.tsx`.
- Existing (possibly stale) build: shared CSS 21 KB gzip, entry JS 169 KB gzip
  (`apps/web/.output/public/assets/`); chunk sizes, not route totals.
- Feature screenshots are 2880×1800 WebP CSS backgrounds, 97–129 KB each, no
  responsive sizes or lazy loading (`landing/product-window.tsx:19-49`);
  CSS backgrounds are also unindexable ([ledger](./README.md#public-site)).

## What this proves / does not prove

**Proves:** the token values, contrast ratios, code drift, truth gaps and font
weights above (source-read or computed); what peer systems ship; what
standards require.

**Does not prove:** that any radius, font or density improves outcomes for
Indian desk staff; that 12 px is unsafe or safe; that queue-first beats
collection-first; that green signals trust (the evidence is weak,
[PubMed 23808916](https://pubmed.ncbi.nlm.nih.gov/23808916/)); any conversion
effect for this site. No signed-in browser pass, mobile trace or usability
session was run for this note.

## What this means for us

Ordered by consequence. Each item names its owner file; nothing here is
scheduled until it enters the [work registry](../README.md#work-lifecycle).

### P0 — safety and truth

1. **Allergy status has three states.** Unknown → "Allergy status not
   recorded" on neutral tokens; verified none → "No known allergies" on
   `--clinical-clear`; recorded → `--clinical-alert`, wrapping, not `truncate`.
   Needs a stored status (schema + `patient-form.tsx`), not only copy.
2. **Dashboard never states zero on a failed read.** Route each region through
   `ListState`/`ErrorNote`; empty copy only after success. Fix the 200-row
   oldest-waiter gap server-side (oldest first) rather than sorting a slice.
3. **`CollectionBars` labels exact enough to trust:** below ₹1,000 show rupees,
   keep sign, zero baseline for refunds; 7-day labels always visible.
4. **Contrast fixes (light):** `--brand` → `oklch(0.5 0.13 132)` (4.79:1 on
   tray); `--destructive` `oklch(0.48 0.18 27)`, `--pending`
   `oklch(0.47 0.12 250)`, `--overdue` `oklch(0.48 0.13 42)` (badge minima
   ≈4.6:1); dark destructive badge fill `/10`. Confirm in browser — gamut
   mapping can move near-threshold values.
5. **Public claims match the product** (needs the owner to revisit D050's
   verbatim-copy approval): one ABDM status everywhere, About agrees with home
   on pharmacy, pricing either real INR + GST + setup or "Written quote after
   demo", no `href="#"`.

### P1 — restore the system where routes drifted

6. Dashboard onto the scale: `PageBody` defaults, `text-3xl` stat ceiling,
   `Panel` trays, shared `Button` for the range selector, `text-pending` for
   unbilled money.
7. Billing Overview tray, Reports duplicate title, Settings `gap-6` back onto
   §1/§2/§8.
8. Reconcile D050's light brand value with `globals.css` (one owner, one value).
   Fix §13's `numeric`-string sentence to D031's `bigint` paise.
9. Landing motion: static hero word and dot (or a pause control), entrances
   ≤200 ms or none on the hero heading, `will-change: auto`, `useTween`
   returns the final value under reduced motion, roles stack becomes tabs
   below `lg` (also fixes the recorded mobile clipping in the registry's
   "Landing page code reduction" item).

### P2 — system additions (each a design.md change)

10. **Radius, "not too round, not too sharp" (§4).** Change the derivation,
    not call sites:

    | Token          | Now  | Proposed                 | Used by                                                                  |
    | -------------- | ---- | ------------------------ | ------------------------------------------------------------------------ |
    | `--radius-xs`  | 2    | 2                        | badge-in-row details, kbd                                                |
    | `--radius-sm`  | 6    | **4** (`--radius - 6px`) | checkbox, `xs` row buttons                                               |
    | `--radius-md`  | 8    | **6** (`--radius - 4px`) | buttons, inputs, menu items, tooltips, badges                            |
    | `--radius-lg`  | 10   | 10                       | page cards, popovers, menus, dialogs                                     |
    | `--radius-xl`  | 14   | 14                       | `Panel` shell; Sheet outer edge follows `md` + 8 automatically (16 → 14) |
    | `--radius-2xl` | 18   | 18                       | public screenshot stage only                                             |
    | full           | pill | pill                     | sign-in CTA only                                                         |

    Rule: a control's radius ≤ ~20% of its height; a container's radius =
    inner radius + inset. Public site uses the same tokens: controls `md`,
    cards `xl` (14), stages `2xl` (18); delete the 16/28 px one-offs. No
    second public token set; no squircle dependency.

11. **Elevation and layers (§1).** Cards: border, no shadow. Popovers/menus:
    `shadow-md` + 1 px ring. Dialogs/sheets: `shadow-lg`. Named z-layers
    (sticky 20, backdrop 40, modal 50, nested popup 60, toast 80) instead of
    blanket `z-50`.
12. **Type tokens (§3)** with line-heights: 11/16 badge, 12/18 body, 14/20
    title, 16/24 task title, 24/28 and 30/36 stat. Public: 16/24 body, 20/32
    lede, 36→48 section, 48→72 hero at weight 600 with −0.015 to −0.02 em
    tracking — a named public exception to "no `font-bold`" and to §3's
    `text-5xl` cap. `font-variant-ligatures: none` on `.font-mono`.
13. **Fonts (§3).** Self-hosted Inter subset Latin + `₹` (≤80 KB) with the
    full Latin-ext only by `unicode-range`; one Inter preload; metric-matched
    fallback `@font-face` (`size-adjust`, ascent/descent overrides) to keep
    swap CLS ≤0.01; Noto Sans Devanagari after Inter in `--font-sans`, no
    preload, tested on real Hindi names before acceptance.
14. **Table density (§8).** Shared `Table` variants: compact 32 / default 40 /
    comfortable 48 px; worklists default, touch- or action-heavy rows
    comfortable.
15. **Touch targets (§7/§8).** Keep 32 px desktop controls; under
    `(pointer: coarse)` Buttons and inputs get `min-h-11`. Mobile inputs at
    16 px text (also avoids iOS focus zoom).
16. **Formatting (§13).** `en-IN` grouping, `2 Oct 2026` display,
    `DD/MM/YYYY` entry hint, org-timezone instants vs business dates, no
    lakh/crore abbreviation on transactions (only on chart labels).
17. **Forms and feedback (§10).** Validate on submit then per field, focus the
    first invalid field, errors say problem + next action, success toast 4 s,
    failures persist inline. Money overlays repeat name + MRN when they cover
    the identity strip — a deliberate safety exception to "Say it once"
    ([SAFER 1.3](https://www.healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf)).
18. **Freshness cue.** Dashboard regions show "Updated HH:mm" and "Updates
    delayed" after 30 s without success; keep 10 s polling
    (`apps/web/src/lib/operational-query.ts:4-8`). Call it auto-refresh.
19. **Charts (§11).** Document the static-overview exception the dashboard
    already is (all values labelled, no hover), and give `--brand-fill` bars a
    `--brand` edge where the bar boundary carries meaning.
20. **Performance budgets** (new design.md section; proposals to falsify, gzip):
    public route cold JS ≤200 KB, org route ≤300 KB, per-navigation ≤30 KB,
    shared CSS ≤25 KB, initial fonts ≤120 KB (≤175 KB with Devanagari);
    lab mid-Android + Slow 4G LCP ≤2.5 s, interaction ≤150 ms, CLS ≤0.05.
    Screenshots: `<img>` with AVIF/WebP `srcset` 480/960/1440/2880, explicit
    size, lazy below the fold. Profile lists at 200 accumulated rows before
    considering virtualization. No View Transitions on operational routes.
21. **Imagery.** Real product crops with synthetic patients, one workflow
    claim per crop, readable at 390 px; no stock doctor photography; mark the
    HTML hero mock "Illustrative preview" or replace it with a real capture.

### P3 — product changes that need a role test first

22. **Dashboard for the owner; work stats on each route.** _Superseded the
    role-aware dashboard on 2026-10-02 on the owner's instruction:_ the
    Dashboard is owner-only (money today and this month, owed, not billed,
    sources and methods, patient flow, owed longest). Each route gets its own
    stat cards instead: OPD — waiting now, longest wait, next booking; Billing —
    to bill, refunds due, unpaid over 7 days; Pharmacy — expiring ≤30 days
    (needs an aggregate procedure), out of stock, quarantined. Comparison copy
    states its baseline ("vs 2 earlier Tuesdays"). _Outcome 2026-10-02:_ one
    dashboard for owner and desk shipped in `routes/$orgSlug/dashboard.tsx`; the
    prototypes were deleted.
23. **Search palette (`Ctrl/⌘K`)** for navigation and patient lookup only —
    never executes a money write. Candidate, not evidence-backed demand.
24. **Public home blueprint:** problem + audience + real screenshot + demo →
    verified proof (one attributable quote, no invented numbers) → OPD →
    patient → bill journey → role outcomes → go-live and support → data and
    security facts (hosting region, backups, export, DPDP contact; no
    decorative badges) → pricing → decision FAQ → demo with phone/email
    fallback. Nav links the three product pages. Feature pages: task hero →
    real screen → three action crops → limits → implementation and price →
    FAQ → next workflow → demo.

### Open decision: body size

The audience lens recommends 14 px body for tables and 16 px for forms and
mobile; the internal, dashboard, typography and accessibility lenses find no
evidence to leave 12 px. Both positions agree on: 16 px mobile inputs, larger
patient identity (name 16 px medium, MRN 14 px mono), and testing older staff.
**Recommendation: keep 12 px for desktop tables and metadata until the test
below; adopt the agreed enlargements now.** Changing §3 globally is a
reversible-but-wide migration and should follow evidence, not precede it.

## Next falsification

1. **Density test:** 5–8 desk staff including over-45s, Windows 1366×768 at
   100% and 125% scaling plus one mid-range Android, clinic lighting. Tasks:
   find the oldest waiter, transcribe an MRN, read a balance, spot an allergy,
   pick between two same-name patients. Compare 12/18 vs 14/20 body and 32 vs
   40 px rows; measure errors and time. Reject 12 px if errors rise or any
   participant zooms.
2. **Radius A/B** on populated OPD and Billing screens and a checkbox group
   (current 8/6 vs proposed 6/4). Reject if checkboxes read as radios or nested
   gaps look uneven.
3. **Dashboard order:** queue-first vs collection-first per role; each must
   name the next action, oldest waiter and unbilled money within 5 s.
4. **Performance:** production cold-cache trace on a real mid-range Android
   with recorded Slow 4G for `/`, `/opd` (public) and org Dashboard/OPD;
   font waterfall before and after the Latin + `₹` subset.
5. **Public site:** five owners and two billing managers explain fit, price,
   readiness and how to get a demo unaided; measure qualified demos, not clicks.
6. **Contrast:** browser-computed colours for the proposed tokens in both
   themes; Windows High Contrast keyboard walkthrough (badges need a
   `forced-colors` outline).

## Sources

Standards: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [CSS Backgrounds 3](https://www.w3.org/TR/css-backgrounds-3/#corner-shaping),
[web.dev Core Web Vitals](https://web.dev/articles/vitals),
[font best practices](https://web.dev/articles/font-best-practices),
[size-adjust](https://web.dev/articles/css-size-adjust),
[content-visibility](https://web.dev/articles/content-visibility),
[CLDR en_IN](https://raw.githubusercontent.com/unicode-org/cldr/main/common/main/en_IN.xml).
Healthcare: [SAFER Guide 6](https://www.healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf),
[NISTIR 7804](https://www.nist.gov/system/files/documents/2017/05/09/NISTIR-7804.pdf),
[NISTIR 7865](https://nvlpubs.nist.gov/nistpubs/ir/2012/NIST.IR.7865.pdf),
[NICE CG183](https://www.nice.org.uk/guidance/cg183/chapter/Recommendations),
[NHS typography](https://service-manual.nhs.uk/design-system/styles/typography),
[USWDS typography](https://designsystem.digital.gov/components/typography/),
[ABDM HMIS guidance](https://abdm.gov.in/strapicms/uploads/Guidance_Document_for_ABDM_Compliant_HMIS_LMIS_d066e52a6d.pdf).
Design systems: the radius table above;
[Carbon data table](https://carbondesignsystem.com/components/data-table/usage/),
[Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview).
UX research: [NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/),
[NN/g data tables](https://www.nngroup.com/articles/data-tables/),
[NN/g B2B](https://www.nngroup.com/articles/b2b-usability/),
[NN/g older users](https://www.nngroup.com/articles/usability-for-senior-citizens/),
[NN/g photos](https://www.nngroup.com/articles/photos-as-web-content/),
[Few](https://www.perceptualedge.com/articles/misc/WhyMostDashboardsFail.pdf).
Type: [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/),
[IBM Plex](https://www.ibm.com/design/language/typography/typeface/),
[Noto Sans Devanagari](https://notofonts.github.io/noto-docs/specimen/NotoSansDevanagari/).
Peers observed 2026-10-02: [Practo Ray](https://www.practo.com/providers/clinics/ray),
[Eka pricing](https://info.eka.care/ekadoc/pricing), [HealthPlix](https://www.healthplix.com/),
[Halemind](https://www.halemind.com/), [KareXpert](https://www.karexpert.com/),
[Cliniko](https://www.cliniko.com/), [Jane](https://jane.app/),
[CareStack](https://carestack.com/), [Linear](https://linear.app/),
[Midday](https://midday.ai/), [Vercel](https://vercel.com/), [Stripe India](https://stripe.com/in).
