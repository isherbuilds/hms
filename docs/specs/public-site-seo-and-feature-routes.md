# Spec: Public site — indexing policy, SEO head, and per-feature marketing routes

Status: shipped 2026-09-05
Authority: Product request of 2026-09-04 (header prototype round → brainstorm session), governed by [D030](../decisions.md#d030--indexing-is-denied-by-response-header-the-sitemap-is-the-allowlist)
Supersedes: none

## Problem

The public site is one page with almost no machinery behind it.

- **Nothing is findable or shareable.** The root route sets `title: "HMS"` and a
  favicon. There is no canonical URL, no Open Graph image, no sitemap, and
  `public/robots.txt` is a stub with no `Sitemap:` line. A link to the site
  shared in a WhatsApp group — how a hospital administrator actually receives a
  recommendation — renders as a bare URL.
- **The product has nowhere to argue itself.** Every module competes for space in
  three panels on `/`. The header's Product menu points at page anchors, so
  modules without a panel (files, day-close reports) have nowhere to link, and
  the page does not survive the modules already scheduled — inpatient,
  emergency, GST.
- **Tenant URLs are discoverable.** Nothing tells a crawler to keep organization
  slugs and page titles out of search results. Authentication already protects
  the data; what is unprotected is the URL and the title.
- **The Product panel reads mushy.** Its item titles and blurbs are both `text-xs`
  because the panel inherited the bar's density; only weight separates them.
- **`ProductWindow` crops the wrong part of the screen.** It hardcodes a
  1440×830 viewport, which is true of the hero capture (2880×1660) but not of the
  three landing captures (2880×1800 — 1440×900 CSS). Every landing crop resolves
  its vertical offset to 62.1% where the region asks for 45.4%, so each crop shows
  a lower slice of the screen than intended.

## Solution

Public pages get a real publishing surface, and each shipped module gets its own
page to make its own argument.

- Visitors reach `/opd`, `/patients` and `/billing` from the header, from the
  landing page, and from each other. Each page shows one real screen, zooms into
  three parts of it, answers the questions that module actually attracts, and
  points at its siblings.
- The landing page stops being the only place a module can appear: its three
  capability panels become a card grid that indexes the feature pages and holds
  its shape as modules are added.
- Every public page carries a canonical URL, a title, a description and its own
  Open Graph image; `sitemap.xml` lists exactly those pages.
- Every response outside that list carries `X-Robots-Tag: noindex, nofollow`, so
  a new private route is non-indexable without anyone remembering to act.

## Validation / Evidence

Owner-funded work on a settled direction; no market validation was sought and
none is claimed. The composition and header decisions rest on two observation
memos — [landing page composition](../research/landing-page-composition.md) and
[landing header anatomy](../research/landing-header-anatomy.md) — which record
norms across ten reference sites, not conversion evidence. The unproved risk is
stated here so a later review does not mistake it for settled: no evidence exists
that per-feature marketing pages move a hospital buyer, only that every reference
in both tiers ships them.

## User Stories / Scenarios

1. As a **hospital administrator** who was sent a link, I want the shared link to
   preview with the product's name and a picture of the screen it describes, so
   that I can tell what it is before opening it.
2. As a **hospital administrator** evaluating systems, I want a page per module
   that shows the actual screen and answers my objections, so that I do not have
   to book a call to learn what the software does.
3. As a **hospital administrator** reading about billing, I want to see that
   outpatient and patient records exist and are one system, so that I understand
   I am not buying a point solution.
4. As a **search user** typing "hospital GST invoice software", I want a page that
   uses those words and is indexable, so that it can be found at all. Satisfied
   only when `/billing` carries GST language in its title, description and body —
   indexability alone does not satisfy it.
5. As an **existing customer**, I want my organization's URL and page titles
   absent from search results, so that my hospital is not discoverable through
   the public site. Authentication already prevents access; this is about
   listing.
6. As a **visitor scanning the Product menu**, I want the module name to read
   ahead of its description, so that I can skim the list without reading it.

Scenario, before/after — **a new private route is added.** Before: nothing marks
it non-indexable. After: its path is absent from `PUBLIC_ROUTES`, so the server
middleware attaches `X-Robots-Tag: noindex, nofollow` to its responses and
`sitemap.xml` omits it, with no action by the author.

## Implementation Decisions

**Site configuration.** A new `apps/web/src/config/site.ts` is the single source
for the site's identity and its public surface. It exports `siteConfig` (name,
short name, default description) and `PUBLIC_ROUTES`, an ordered list of
`{ path, title, description, ogImage }`. `sitemap.xml`, `robots.txt`, the SEO
head helper and the `X-Robots-Tag` middleware all read it; publishing a page is
one edit. `siteConfig` holds **no environment access**, so it is importable from
a plain Bun script (see _Origin_ below).

**Origin.** `packages/env/src/web.ts` gains `VITE_WEB_URL`, validated as a URL and
then **rejected unless it is a bare origin** — `new URL(v).origin === v` after
trimming a trailing slash. `z.url()` alone accepts `https://host/path`, which
would silently produce doubled canonical paths. The variable is required, not
defaulted, per the repository's fail-loud convention.

Its plumbing is not only the schema. `apps/web/Dockerfile` currently declares
`ARG VITE_SERVER_URL` / `ENV VITE_SERVER_URL` only, and
[operations](../operations.md) documents that same single variable as the web
build's contract; both gain `VITE_WEB_URL`. `apps/web/vite.config.ts` sets
`envDir` to `packages/env`, so Vite loads the canonical `.env` for the app but a
script run from the repository root does not — `scripts/generate-og.ts` therefore
loads it explicitly through `@hms/env`'s existing loader rather than reading
`import.meta.env`.

**Indexing policy** (D030). Three mechanisms, one job each:

- **`X-Robots-Tag: noindex, nofollow`** is attached by a server middleware on the
  root route, beside the existing `evlogErrorHandler`, using the same
  `createMiddleware().server(...)` shape. It applies to every response whose
  pathname is not in `PUBLIC_ROUTES`. A header — not a `<meta>` tag — because it
  also covers the redirect an anonymous visitor gets from `/$orgSlug` and any
  non-HTML response.
- **`sitemap.xml`** emits exactly `PUBLIC_ROUTES`, served
  `application/xml; charset=utf-8`.
- **`robots.txt`** manages crawl budget only, served
  `text/plain; charset=utf-8`. It disallows `/login`, `/join`, `/create` and
  `/api/`, allows everything else, and carries the `Sitemap:` line. It does
  **not** deny by default: a deny-all rule would stop crawlers fetching `/og/`,
  `/hero/` and `/landing/`, so the social scrapers that render shared links
  could not load the Open Graph images this spec exists to produce.

Both are server routes using the `server.handlers.GET` shape already used by the
invoice PDF route. `public/robots.txt` is deleted.

**Reserved namespace.** `RESERVED_ROOT_SLUGS` in
`packages/auth/src/organization-slug.ts` gains `patients`, `records`, `reports`,
`files`, `emergency` and `faq`. Only `patients` collides with a route this spec
creates; the rest are **deliberate forward reservation**, not an implication that
each gets a page. Reservation is free, and the window closes permanently at
launch — afterwards, claiming a name back would orphan an organization already
using it. `opd` and `ipd` need no entry: they are three characters, below
`ORGANIZATION_SLUG_MIN_LENGTH`.

**SEO head.** `apps/web/src/lib/seo.ts` exports `pageHead({ path })`, which reads
the entry for `path` from `PUBLIC_ROUTES` and returns the `{ meta, links }` shape
TanStack Start's `head()` expects: title (templated `%s | HMS`, bare for `/`),
description, canonical link, `og:type`, `og:site_name`, `og:title`,
`og:description`, `og:url`, `og:image` with width, height and alt, and
`twitter:card = summary_large_image`. It throws for an unknown path, so a page
cannot ship with silently missing meta. There is no `packages/seo`:
`apps/fumadocs` is an Astro app and cannot consume TanStack's `head()` shape, so
a workspace package would have exactly one consumer.

**No internationalisation.** `<html lang="en">` and the site is English-only; the
Devanagari font is used solely by `billing-pdf.tsx` for patient names. No
`hreflang`, no alternates, no locale-prefixed routes.

**`ProductWindow` viewport.** The capture's own viewport height drives
`cropStyle` rather than a module constant, because the hero shot is 1440×830 and
the three landing shots are 1440×900. The existing three landing crops must be
re-checked visually after the fix: their rendered output changes. This is a
prerequisite for authoring any new crop region, which is why it is sliced ahead
of the feature pages.

**Feature routes.** Flat top-level paths — `/opd`, `/patients`, `/billing` — one
per module that has a capture today. `/ipd`, `/emergency` and a GST page are not
created until their module ships; a marketing page for software that does not run
contradicts the honesty the FAQ and the footer badges already commit to.

**Feature page composition.** Hero (module name as eyebrow, `text-4xl`/`text-5xl`
headline per the amended [type scale](../design.md#3-type), lead line, the shared
action pair), the full capture, three `ProductWindow` crops each carrying one
claim, the FAQ entries tagged for that module, a sibling cross-link row, then the
existing `LandingClosing`. No new screenshots.

Following the repository's rule that a helper is extracted at the second real
call site, `/billing` is built **route-locally first**; `FeaturePage` is extracted
when `/opd` and `/patients` arrive.

**`ProductWindow` contract.** The component requires `alt` and `title`, so every
crop and the full capture must supply both. `title` is the window chrome label
and follows the existing `"<Section> · Mercy General"` form. For `alt`: the full
capture is **informative** and takes descriptive alternative text; each crop is
**redundant** beside the claim printed next to it, so its `alt` is empty and the
surrounding figure is hidden from assistive technology. A crop that says the same
thing twice to a screen-reader user is noise, not access.

**FAQ tagging.** Each entry in `faq.tsx` gains `features: ShotName[]`.
`LandingFaq` accepts an optional filter: `/` renders all seven, a feature page
renders only its own. One list of answers, two presentations.

**Landing index grid.** `LandingCapabilities` becomes a card grid — one card per
feature, each with a cropped thumbnail of the real capture, the module name, one
line, linking to its page. The deep panel treatment moves to the feature pages.

**Type scale of the Product panel.** Item title becomes `text-sm`, blurb stays
`text-xs` muted; the shelf label stays `text-xs` muted. This uses the existing
scale — `text-sm` is already the section-title size — so no step is added. The
panel's icons are kept; they are not the cause of the flatness.

**Open Graph images.** Generated by `takumi-js`, which the repository already
uses — `apps/fumadocs` renders its documentation OG images through
`takumi-js/response`. `takumi-js` publishes an explicit `bun` export condition
resolving to the native napi backend rather than WebAssembly. A recorded
benchmark on a development machine, 1200×630: 113 ms first image, 8 ms per image
warm, 46 ms for a six-image run, `@takumi-rs/core` confirmed as the loaded
backend.

`@vercel/og` is rejected: it is Satori plus resvg-wasm, restricted to flexbox
with no CSS grid, to `ttf`/`otf`/`woff` fonts when the site's Inter is a
self-hosted `woff2`, and to a 500 KB bundle. It would also be a second renderer
beside the takumi already in the tree.

The card is composed in JSX from the landing wash gradient, the wordmark as an
eyebrow, and the page title, with Inter supplied from
`@fontsource-variable/inter` as a `woff2` buffer. Supplying the font is a
requirement, not a refinement: a probe run without it silently fell back to a
system face. Output is **static and committed** — `scripts/generate-og.ts` is run
by a person and writes into `apps/web/public/og/`. Four pages do not justify a
request-time route and its cache; the same `ImageResponse` call moves into a
server route unchanged when a changelog introduces arbitrary titles.

### Content matrix

Copy is specified here so no implementer invents product claims. Crop regions are
specified by **what they must frame**, not by invented pixel values: they are read
off the capture after the `ProductWindow` viewport fix and confirmed visually.

| Route       | `<title>`                                              | Meta description                                                                                       |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `/`         | HMS — the desk software your hospital actually runs on | Outpatient queues, patient records and billing for a hospital, in one system.                          |
| `/opd`      | Outpatient queue                                       | Token numbers, waiting times and no-shows on one screen — the whole morning at a glance.               |
| `/patients` | Patient records                                        | One MRN per patient, every visit in one place, allergies on top of the record.                         |
| `/billing`  | Billing, collections and GST                           | Invoices, refunds, cash and bank transfers, with a GST outward register your accountant can work from. |

| Route       | H1                                | Lead                                                            | Crops must frame                                                                                                                                                                       | FAQ entries                                                                                      |
| ----------- | --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/opd`      | See the whole morning at once     | Who is waiting, who is in a room, who never turned up.          | the token-and-status column; the department and practitioner columns; a no-show row                                                                                                    | "How do staff get accounts?", "Does it need the internet?"                                       |
| `/patients` | Every patient, one keystroke away | Search by name, MRN or phone. Allergies travel with the record. | the search field with an MRN visible; the registry columns; the allergy treatment on a record                                                                                          | "Can another hospital see our data?", "Are you ABDM certified?", "Can we get our data out?"      |
| `/billing`  | Know what you are owed            | Unbilled care, unpaid invoices and refunds due, on one screen.  | the four-tile Today row (waiting to be billed, collected, outstanding, over 30 days); the filter chips over the open-money list; rows showing an overdue invoice in the overdue colour | "Is it ready for GST?", "What happens when we bill something wrong?", "Can we get our data out?" |

Cross-link blurbs reuse the shelf blurbs already written in `nav.tsx` ("Token
numbers, waiting times, no-shows.", "One MRN, every visit, allergies on top.",
"Invoices, refunds, cash and bank transfers."). Each OG image carries the route's
`<title>` over the wash; no separate OG copy exists.

## Test Seams

Existing seams are used where they exist; the new ones are pure functions so the
invariants can be checked without a server.

| Seam                                                                                                     | Behaviour verified                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderRobots(routes, origin)` and `renderSitemap(routes, origin)` in `apps/web/src/lib/public-crawl.ts` | `sitemap.xml` contains exactly the `PUBLIC_ROUTES` paths and no others; `robots.txt` disallows `/login`, `/join`, `/create` and `/api/`, does **not** disallow `/`, `/og/`, `/hero/` or `/landing/`, and carries a `Sitemap:` line built from the origin.                                                      |
| `shouldDenyIndexing(pathname, routes)` in `apps/web/src/lib/public-crawl.ts`                             | True for a `/$orgSlug` path, for `/login`, and for an arbitrary unknown path; false for every `PUBLIC_ROUTES` path. This is D030's invariant.                                                                                                                                                                  |
| `organizationSlugIssue` in `packages/auth/src/organization-slug.ts`                                      | Each newly reserved slug is rejected. Prior art: `tests/unit/organization-slug.test.ts`.                                                                                                                                                                                                                       |
| `pageHead({ path })` in `apps/web/src/lib/seo.ts`                                                        | For a known path, returns title, description, canonical link, `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` with width, height and alt, and `twitter:card` — the complete contract, not a sample of it — with absolute URLs built from the origin. Throws for an unknown path. |

Feature pages, the index grid, the type scale and the `ProductWindow` fix are
visual and are verified by a production build plus inspection, per the
repository's rule for SSR/UI changes. No new test framework, directory or
end-to-end suite is added.

## Task Plan

Each slice runs the focused tests that cover it. The repository-wide gates
(`bun run check-types`, `bun run check`, `bun run test`) run once at completion,
per [development](../development.md#commands).

- [x] **Slice 1: Indexing policy, site config and environment plumbing** (riskiest)
  - Acceptance: `GET /robots.txt` returns `200` with `text/plain; charset=utf-8`,
    disallows `/login`, `/join`, `/create` and `/api/`, allows `/`, `/og/`,
    `/hero/` and `/landing/`, and carries the `Sitemap:` line; `GET /sitemap.xml`
    returns `200` with `application/xml; charset=utf-8` listing only
    `PUBLIC_ROUTES` (initially `/`); a response for any `/$orgSlug` path and for
    `/login` carries `X-Robots-Tag: noindex, nofollow` while `/` does not;
    `VITE_WEB_URL` is rejected when given a URL with a path; `patients`,
    `records`, `reports`, `files`, `emergency` and `faq` are rejected as
    organization slugs; `public/robots.txt` no longer exists; the Dockerfile and
    [operations](../operations.md) both name `VITE_WEB_URL`.
  - Verify: `bun test tests/unit/public-crawl.test.ts tests/unit/organization-slug.test.ts`,
    then `bun run --cwd apps/web build` and `curl -i` both routes and one
    `/$orgSlug` path against the preview server.
  - Depends on: none
  - Owns/Touches: `apps/web/src/config/site.ts` (new),
    `apps/web/src/lib/public-crawl.ts` (new),
    `apps/web/src/routes/robots[.]txt.ts` (new),
    `apps/web/src/routes/sitemap[.]xml.ts` (new),
    `apps/web/src/routes/__root.tsx`, `apps/web/public/robots.txt` (delete),
    `apps/web/Dockerfile`, `packages/auth/src/organization-slug.ts`,
    `packages/env/src/web.ts`, `packages/env/.env.example`,
    `docs/operations.md`, `tests/unit/public-crawl.test.ts` (new),
    `tests/unit/organization-slug.test.ts`
  - Interfaces: produces `siteConfig` and `PUBLIC_ROUTES: PublicRoute[]` where
    `PublicRoute = { path: string; title: string; description: string; ogImage: string }`
    from `@/config/site`; and
    `renderRobots(routes: PublicRoute[], origin: string): string`,
    `renderSitemap(routes: PublicRoute[], origin: string): string`,
    `shouldDenyIndexing(pathname: string, routes: PublicRoute[]): boolean` from
    `@/lib/public-crawl`. `PUBLIC_ROUTES` initially holds `/` only.

- [x] **Slice 2: SEO head applied to `/`**
  - Acceptance: `/` renders every field named in the `pageHead` test seam, with
    absolute URLs built from `VITE_WEB_URL`; the document title is unchanged;
    `pageHead` throws for an unlisted path.
  - Verify: `bun test tests/unit/seo.test.ts`, then `bun run --cwd apps/web build`
    and inspect the rendered `<head>` of `/`.
  - Depends on: Slice 1
  - Owns/Touches: `apps/web/src/lib/seo.ts` (new),
    `apps/web/src/routes/index.tsx`, `apps/web/src/routes/__root.tsx`,
    `tests/unit/seo.test.ts` (new)
  - Interfaces: produces
    `pageHead({ path }: { path: string }): { meta: object[]; links: object[] }`
    from `@/lib/seo`; consumes Slice 1's exports.

- [x] **Slice 3: `ProductWindow` viewport fix**
  - Acceptance: the capture's own viewport height drives `cropStyle` — 830 for
    the hero shot, 900 for `opd`, `patients` and `billing`; the three existing
    landing panels are re-inspected and their regions adjusted so each frames
    what its copy claims.
  - Verify: `bun run --cwd apps/web build`, then compare all four rendered
    windows against the source captures at 1440px and at 390px.
  - Depends on: none
  - Owns/Touches: `apps/web/src/components/landing/product-window.tsx`,
    `apps/web/src/components/landing/capabilities.tsx`
  - Interfaces: `ProductWindow`'s public props are unchanged; `SHOTS` gains a
    per-shot viewport height. Required by Slices 4 and 5.

- [x] **Slice 4: `/billing`, built but not published** (proof slice)
  - Acceptance: `/billing` renders hero, full capture, the three crops named in
    the content matrix, its three tagged FAQ entries, cross-links to `/opd` and
    `/patients`, and the shared closing CTA and footer; its title, description,
    H1 and lead match the matrix, and GST appears in title, description and body
    (user story 4); every `ProductWindow` receives `alt` and `title`, with crops
    hidden from assistive technology; `/` still renders all seven FAQ entries.
    The route is **absent** from `PUBLIC_ROUTES`, so it is not in the sitemap, is
    not linked from the header or footer, and carries `X-Robots-Tag: noindex`.
  - Verify: `bun test tests/unit/seo.test.ts`, `bun run --cwd apps/web build`,
    then load `/billing` and `/` and confirm the FAQ counts are 3 and 7.
  - Depends on: Slice 2, Slice 3
  - Owns/Touches: `apps/web/src/routes/billing.tsx` (new),
    `apps/web/src/components/landing/faq.tsx`
  - Interfaces: `LandingFaq` gains an optional `feature?: ShotName` prop. No
    shared `FeaturePage` is created here — there is one caller.
  - Note: publishing is deliberately withheld so no slice ships a page whose
    cross-links are dead. Stop here for acceptance of the page's shape.

- [x] **Slice 5: Publish all three routes, navigation and landing grid**
  - Acceptance: `/opd` and `/patients` exist with their matrix copy, crops and
    FAQ subsets; `FeaturePage` is extracted now that three callers exist and all
    three routes render through it; all three are in `PUBLIC_ROUTES`, appear in
    `sitemap.xml`, and no longer carry `X-Robots-Tag`; `/` renders one card per
    feature in place of the three full-width panels; the Product panel, its
    footer link and the footer's Product column point at the three routes; the
    `#opd`, `#patients` and `#billing` anchors and their `scroll-mt-20` are
    removed; the Product panel's item titles render at `text-sm` over `text-xs`
    muted blurbs with no arbitrary `text-[…]` value; no link on any public page
    resolves to a removed anchor.
  - Verify: `bun run --cwd apps/web build`, then follow every link on `/`,
    `/opd`, `/patients` and `/billing` and confirm each resolves; `curl -i` one
    feature route and confirm no `X-Robots-Tag`.
  - Depends on: Slice 4
  - Owns/Touches: `apps/web/src/routes/opd.tsx` (new),
    `apps/web/src/routes/patients.tsx` (new), `apps/web/src/routes/billing.tsx`,
    `apps/web/src/components/landing/feature-page.tsx` (new),
    `apps/web/src/components/landing/capabilities.tsx`,
    `apps/web/src/components/landing/nav.tsx`,
    `apps/web/src/components/landing/closing.tsx`,
    `apps/web/src/config/site.ts`
  - Interfaces: produces `FeaturePage` accepting
    `{ shot: ShotName; eyebrow: string; title: string; lead: string; capture: { region: Region; alt: string; title: string }; crops: { region: Region; title: string; claim: string; body: string }[]; faqFeature: ShotName; siblings: { to: string; label: string; blurb: string }[] }`.
    `nav.tsx` is edited once, here, for both its targets and its type scale.

- [x] **Slice 6: Open Graph images**
  - Acceptance: `bun scripts/generate-og.ts` writes one 1200×630 PNG per
    `PUBLIC_ROUTES` entry — four files — into `apps/web/public/og/`, each
    rendered with Inter rather than a system fallback and carrying the landing
    wash gradient and the route's title; running the script twice produces
    byte-identical files; the script prints its own elapsed time, and that figure
    is recorded in the commit message rather than asserted as a threshold; every
    public page's `og:image` resolves to an existing file.
  - Verify: run the script twice and `git diff --stat apps/web/public/og/`,
    expecting no change; then `bun run --cwd apps/web build` and `curl -i` each
    `og:image` URL, expecting `200` and `Content-Type: image/png`.
  - Depends on: Slice 5
  - Owns/Touches: `scripts/generate-og.ts` (new), `apps/web/public/og/`,
    root `package.json` (add `takumi-js` to devDependencies)
  - Interfaces: consumes `PUBLIC_ROUTES` and `siteConfig` from Slice 1 and the
    origin through `@hms/env`; renders via
    `new ImageResponse(element, { width: 1200, height: 630, format: "png" })`
    from `takumi-js/response`, with Inter supplied as a `woff2` buffer.

- [x] **Slice 7: Closure**
  - Acceptance: the repository-wide gates pass; the work registry entry in
    `docs/README.md` leaves **Active**; [operations](../operations.md) records
    `VITE_WEB_URL` in its deployment contract (written in Slice 1, verified
    here); [design](../design.md) §3 reflects display type on public marketing
    pages (already amended, verified here); D030 matches what shipped.
  - Verify: `bun run check-types`, `bun run check`, `bun run test`,
    `bun run --cwd apps/web build`, and `bunx oxfmt --check` on every changed
    Markdown file.
  - Depends on: Slice 6
  - Owns/Touches: `docs/README.md`, `docs/operations.md`, `docs/design.md`,
    `docs/decisions.md`
  - Interfaces: none.

## Shipped notes

Where the implementation departs from the text above, and why.

- `renderRobots(origin)` takes no route list: the rules do not depend on it.
- `siteConfig` carries `name` and `description` only; no short name had a
  reader. `OG_IMAGE` (1200×630) also lives in `site.ts` so the generator script
  needs neither `@hms/env` nor an origin — the cards carry no URL.
- `FeaturePage` props are `{ shot, eyebrow, title, lead, windowTitle, captureAlt, crops }`.
  Siblings, the FAQ filter and the capture region derive from `shot`; the
  window-chrome label is one string for every window on the page. The module
  list itself (`FEATURES` in `features.ts`) is shared by the Product panel, the
  landing grid, the footer's Product column and the sibling row.
- The full capture frames `1440×840`, not `1440×900`: every landing capture
  carries the router devtools badge in its last 60px, and re-capturing is out of
  scope.
- The OPD capture has no no-show row and the patients capture shows no allergy
  on a record, so the third OPD crop frames the status column with the
  balance-due badge and the third patients crop frames the header with
  **Register Patient** beside the right-hand registry columns.
- The OG generator composes with `takumi-js/helpers` node builders rather than
  JSX: the workspace root has no React dependency and a script does not earn
  one. Recorded run: four images in 127 ms.

### Follow-on, 2026-09-05: about, privacy, contact, changelog

Shipped after the seven slices on the owner's request and the findings in
[public site research](../research/public-site-seo-ai-and-pages.md):

- `/about`, `/privacy`, `/contact`, `/changelog` and `/changelog/<slug>` render
  through `PublicPage` (`components/landing/public-page.tsx`); prose uses the
  `PROSE` selector class, not a typography plugin.
- Changelog entries are `.mdx` under `src/content/changelog/`, compiled by
  `@mdx-js/rollup`; each exports `meta` and the filename is the slug. Midday
  keeps dated posts as MDX and legal pages as TSX; this follows that split.
- `PUBLIC_PATHS` (`config/public-paths.ts`) = `PUBLIC_ROUTES` paths + changelog
  entry paths; the sitemap and `X-Robots-Tag` middleware read it.
  `renderSitemap`/`shouldDenyIndexing` take `string[]` accordingly. Entries share
  `/og/changelog.png` and emit `og:type=article`.
- Contact is WhatsApp click-to-chat plus `mailto:`, from required
  `VITE_WHATSAPP_NUMBER` / `VITE_CONTACT_EMAIL`. No form, no server route.
- The footer's Company and Legal columns point at the new pages; Resources,
  Terms, Data processing and Careers are gone until their pages exist. Header
  gains Changelog; "Contact sales" now resolves to `/contact`.
- Not incorporated yet, so the Companies (Incorporation) Rules r26 identity
  block (name, CIN, registered office, phone, email, grievance contact on the
  home page) is **owed at incorporation**; `/about` and `/privacy` say so.

### Lean-code follow-through, 2026-09-05

- Product opens on mouse hover; taps and keyboard activation toggle it. Panel
  links follow the trigger in tab order; moving focus out closes it, and Escape
  returns focus to the trigger. The full-height group needs no hover timer or
  global keyboard listener.
- `PUBLIC_PATHS` derives changelog paths from filenames. Article content loads
  only with changelog navigation, through the router's existing split.
- The hero has no OS-theme preload hints. The persisted theme can differ from
  the OS preference, which caused both image variants to download.
- Production validation: main client JavaScript fell from 375,370 to 365,207
  bytes (gzip level 9: 116,107 to 112,138 bytes). With OS light and saved dark,
  the hero changed from two requests (89,176 + 88,578 bytes) to one (88,578
  bytes). These are bundle and request measurements, not latency or LCP claims.

## Out of Scope

- Legal pages (privacy, terms, data processing) and whether their copy is
  authored as MDX or TSX.
- Pricing, About, Story, blog and changelog pages, and the footer's links to them.
- Replacing the placeholder testimonials in `testimonials.tsx`.
- A `/faq` route: the FAQ stays on `/` and filtered on feature pages, so the same
  answers are not published at two URLs. `faq` is nevertheless reserved as an
  organization slug, deliberately — see _Reserved namespace_.
- Request-time Open Graph generation. The generator is a script a person runs;
  the same call moves into a server route when arbitrary titles arrive.
- Internationalisation of any kind.
- Re-capturing any screenshot. Slice 3 corrects how existing captures are
  cropped, not the captures themselves.

## Explicitly Deferred

- **Files and day-close reports have no feature page.** They are shipped modules
  with no capture and no landing section, so they stay absent from the Product
  panel until one is made. A known gap, not an oversight to fix mid-implementation.
- **`/ipd`, `/emergency` and a GST-specific page** wait for their modules;
  `/billing` carries the GST language in the meantime.
- **The footer's remaining dead links** (Story, Careers, Documentation, Support,
  Changelog, Privacy, Terms, Data processing) stay dead; only the Product column
  is repointed. Cutting the rest is its own change.
- The homepage phone section uses the OPD and dashboard phone captures.
- The owner restored the existing placeholder testimonials before the homepage
  FAQ on 2026-09-05. Their copy and lead metric remain placeholders.

## Open Questions

None.
