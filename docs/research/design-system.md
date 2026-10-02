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
3. **Safety before polish.** Unrecorded allergies render as "No known
   allergies" in green; collection labels round ₹100 to "₹0k"; light status
   badges fail AA.
4. **The dashboard should answer "what needs doing now"** — queue first,
   three actionable counts second, collection trend last — on the existing
   `Panel`/`ListState` primitives, not its bespoke `Card` and larger scale.
5. **Performance is won in fonts**, not in visual austerity: `₹` forces
   Inter's 133 KB Latin-ext file.

One recommendation is genuinely contested and needs an owner test, not a
default: **12 px body text** (see [Open decision](#open-decision-body-size)).

## Evidence

The per-lens evidence (audience, peer systems, route drift, dashboard practice,
computed contrast, typography, public site, performance) is in Git history at
commit `64d0ee5`. The sources below remain the citations.

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
2. **`CollectionBars` labels exact enough to trust:** below ₹1,000 show rupees,
   keep sign, zero baseline for refunds; 7-day labels always visible.
3. **Contrast fixes (light):** `--brand` → `oklch(0.5 0.13 132)` (4.79:1 on
   tray); `--destructive` `oklch(0.48 0.18 27)`, `--pending`
   `oklch(0.47 0.12 250)`, `--overdue` `oklch(0.48 0.13 42)` (badge minima
   ≈4.6:1); dark destructive badge fill `/10`. Confirm in browser — gamut
   mapping can move near-threshold values.

### P1 — restore the system where routes drifted

4. Dashboard onto the scale: `PageBody` defaults, `text-3xl` stat ceiling,
   `Panel` trays, shared `Button` for the range selector, `text-pending` for
   unbilled money.
5. Billing Overview tray, Reports duplicate title, Settings `gap-6` back onto
   §1/§2/§8.
6. Reconcile D050's light brand value with `globals.css` (one owner, one value).
   Fix §13's `numeric`-string sentence to D031's `bigint` paise.

### P2 — system additions (each a design.md change)

7. **Radius, "not too round, not too sharp" (§4).** Change the derivation,
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

8. **Elevation and layers (§1).** Cards: border, no shadow. Popovers/menus:
   `shadow-md` + 1 px ring. Dialogs/sheets: `shadow-lg`. Named z-layers
   (sticky 20, backdrop 40, modal 50, nested popup 60, toast 80) instead of
   blanket `z-50`.
9. **Type tokens (§3)** with line-heights: 11/16 badge, 12/18 body, 14/20
   title, 16/24 task title, 24/28 and 30/36 stat. Public: 16/24 body, 20/32
   lede, 36→48 section, 48→72 hero at weight 600 with −0.015 to −0.02 em
   tracking — a named public exception to "no `font-bold`" and to §3's
   `text-5xl` cap. `font-variant-ligatures: none` on `.font-mono`.
10. **Fonts (§3).** Self-hosted Inter subset Latin + `₹` (≤80 KB) with the
    full Latin-ext only by `unicode-range`; one Inter preload; metric-matched
    fallback `@font-face` (`size-adjust`, ascent/descent overrides) to keep
    swap CLS ≤0.01; Noto Sans Devanagari after Inter in `--font-sans`, no
    preload, tested on real Hindi names before acceptance.
11. **Table density (§8).** Shared `Table` variants: compact 32 / default 40 /
    comfortable 48 px; worklists default, touch- or action-heavy rows
    comfortable.
12. **Touch targets (§7/§8).** Keep 32 px desktop controls; under
    `(pointer: coarse)` Buttons and inputs get `min-h-11`. Mobile inputs at
    16 px text (also avoids iOS focus zoom).
13. **Formatting (§13).** `en-IN` grouping, `2 Oct 2026` display,
    `DD/MM/YYYY` entry hint, org-timezone instants vs business dates, no
    lakh/crore abbreviation on transactions (only on chart labels).
14. **Forms and feedback (§10).** Validate on submit then per field, focus the
    first invalid field, errors say problem + next action, success toast 4 s,
    failures persist inline. Money overlays repeat name + MRN when they cover
    the identity strip — a deliberate safety exception to "Say it once"
    ([SAFER 1.3](https://www.healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf)).
15. **Freshness cue.** Dashboard regions show "Updated HH:mm" and "Updates
    delayed" after 30 s without success; keep 10 s polling
    (`apps/web/src/lib/operational-query.ts:4-8`). Call it auto-refresh.
16. **Charts (§11).** Document the static-overview exception the dashboard
    already is (all values labelled, no hover), and give `--brand-fill` bars a
    `--brand` edge where the bar boundary carries meaning.
17. **Performance budgets** (new design.md section; proposals to falsify, gzip):
    public route cold JS ≤200 KB, org route ≤300 KB, per-navigation ≤30 KB,
    shared CSS ≤25 KB, initial fonts ≤120 KB (≤175 KB with Devanagari);
    lab mid-Android + Slow 4G LCP ≤2.5 s, interaction ≤150 ms, CLS ≤0.05.
    Screenshots: `<img>` with AVIF/WebP `srcset` 480/960/1440/2880, explicit
    size, lazy below the fold. Profile lists at 200 accumulated rows before
    considering virtualization. No View Transitions on operational routes.
18. **Imagery.** Real product crops with synthetic patients, one workflow
    claim per crop, readable at 390 px; no stock doctor photography.

### P3 — product changes that need a role test first

19. **Search palette (`Ctrl/⌘K`)** for navigation and patient lookup only —
    never executes a money write. Candidate, not evidence-backed demand.
20. **Public home blueprint:** problem + audience + real screenshot + demo →
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
