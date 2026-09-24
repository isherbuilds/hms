# Design

The rules this product's interface is built to. One document, so a screen built
next month looks like one built today without anyone comparing them side by
side.

Every rule is a default. A deviation needs a comment saying why, and a deviation
that recurs is a missing primitive, not a style choice.

## 1. Surfaces

Three greys, and they must stay distinguishable. This is the single most
important rule in the document, because the card language is built on it and it
collapses silently when two of them drift together.

| Surface | Token                       | What it is                                                 |
| ------- | --------------------------- | ---------------------------------------------------------- |
| Canvas  | `bg-background`             | The page. Flat sections and rationed card trays sit on it. |
| Shell   | `bg-muted`                  | The tinted wrapper that carries a card's label.            |
| Card    | `bg-card` + `border-border` | The raised surface that carries the content.               |

**Card trays are rationed against stacking, not against use.** An operational
list — a table of rows staff work through — gets exactly one tray. That is the
standard list treatment, not an exception: the OPD day list, the patients
registry, and record Charges or Billing tables all use it. Rationing means a
screen does not stack many trays and boxes in one composition: flat sections
with typographic hierarchy and hairlines are the default for everything that is
not a row group. A tray uses `rounded-xl bg-muted p-1`, an `h-9` label row, and
a raised `rounded-lg border bg-card` body. Never nest a card inside an
already-raised surface, such as a Sheet or popover.

```
┌ shell (bg-muted, rounded-xl, p-1) ──────────┐
│  label row (h-9, px-3, muted-foreground)    │
│ ┌ card (bg-card, border, rounded-lg, p-4) ┐ │
│ │  the content                            │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

The shell groups related rows. Do not nest a shell inside a shell.

Keep the muted tray and its inset card. Reduce the information shown at once
before removing this framing. Billing separates open money, refunds, and held
advances into routes. Patient billing opens on invoices; advance receipts expand
below them. Staff keeps a compact panel and a button-style view selector, so
nested tab strips do not add parallel rules. Reports use a muted
navigation panel with no extra rule above or below it.

Organization settings use a left-aligned `max-w-5xl` content column. At `md`,
section context occupies one column and its fields occupy two. On smaller screens
they stack. A rule separates each group from the next; no trailing rule sits above Save.
The scrollbar stays at the page edge; only the content has a width limit.

**Do not tune these values per page.** If a shell is invisible, the token is
wrong, not the page — fix `--muted` in `packages/ui/src/styles/globals.css`.

## 2. Spacing

One scale. Five steps carry everything:

| Step       | Token          | Where                                            |
| ---------- | -------------- | ------------------------------------------------ |
| `1` (4px)  | `gap-1`, `p-1` | Icon→label, chips, the shell's inset             |
| `2` (8px)  | `gap-2`        | Controls in a row, label→field                   |
| `3` (12px) | `gap-3`        | Fields in a form, cards in a grid                |
| `4` (16px) | `gap-4`, `p-4` | Page padding, card padding, gap between sections |
| `6` (24px) | `gap-6`        | Between major blocks on a public page only       |

- **Page padding is `p-4`, applied by `PageBody`.** Pages do not retune the
  ordinary gutter. A task route may add bottom-only reserve when its fixed
  mobile action footer would otherwise cover the final fields.
- **Prefer `gap` on the parent over margins on children.** A margin is a decision
  only the child knows about; a gap is one the layout owns. `mt-*`/`mb-*` on a
  child is a smell — the sole exception is the optical nudge under a label, and
  `PageHeader` owns it.
- **`5`, `7`, `9` and fractional steps are not in the scale.** Reaching for `p-5`
  means the answer is `p-4` or `p-6`.

## 3. Type

A dense data surface. `text-xs` is the body size, not a small size.

| Size                      | Where                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `text-[0.6875rem]` (11px) | `Badge` primitive only: dense status labels                                               |
| `text-xs` (12px)          | Default: table cells and column labels, body copy, buttons, inputs                        |
| `text-sm` (14px)          | Page and section titles                                                                   |
| `text-base` (16px)        | Dialog and Sheet task titles                                                              |
| `text-lg` (18px)          | Public pages and a chart's fixed-height interactive readout                               |
| `text-xl` (20px)          | Public pages only                                                                         |
| `text-2xl`/`text-3xl`     | The headline number on a dashboard stat card; `text-3xl` also opens a public-page section |
| `text-4xl`/`text-5xl`     | Display: marketing headlines on public pages only, never inside the app                   |

- **Display sizes stop at the app's edge.** `text-4xl`/`text-5xl` exist so the
  public pages — `/` and the per-feature marketing routes — can carry a headline
  at the size a reader expects from a product site. Nothing behind a login uses
  them: a dense operational surface
  that needs 36 px to state something has a hierarchy problem, not a size one.
- **No route-level `text-[13px]`-style values.** A missing step means the design
  is wrong, not the scale. The reviewed 11 px component labels above and print
  sizes measured against physical paper are the only type exceptions.
- **Weight carries hierarchy, not size.** `font-medium` for titles and the active
  row; regular elsewhere. There is no `font-bold`.
- **`text-muted-foreground` is the only secondary colour** — not an opacity, not a
  lighter grey.
- **`font-mono` is for identifiers compared character by character**: MRN,
  phone, invoice number, token, actor id, catalog code. Never prose, never
  amounts.
- **`tabular-nums` on every number that can change** — counts, money, times. Without
  it a live-updating figure jitters.

Patient facts must look as honest as they are stored: every age derived from an
estimated birth date carries a `~` prefix, and registration never preselects a
sex value for the operator.

**Fonts.** Inter Variable (UI) and JetBrains Mono (identifiers), both self-hosted
via `@fontsource-variable/*`. Billing PDFs pair Takumi's shipped Latin sans with
static Noto Sans Devanagari subsets for fixed metrics and script coverage. No
CDN: the app must work on a hospital LAN with no outbound internet.

## 4. Radius

Set by the component layer, never at a call site.

| Radius         | Where                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `rounded-md`   | The default. Every component in `packages/ui`: controls, dialogs, sheets, popovers, tooltips, empty states |
| `rounded-sm`   | Checkbox only — `rounded-md` on a `size-4` box reads as a circle                                           |
| `rounded-lg`   | Page-level cards in `apps/web`                                                                             |
| `rounded-xl`   | The card shell in `apps/web`                                                                               |
| `rounded-full` | `Button shape="pill"` only — currently the sign-in CTA alone                                               |

A component in `packages/ui` owns its radius. If a page is writing `rounded-*`,
either it is building a shell (allowed) or the component is missing a variant.

The base is `--radius: 0.625rem`; every step above is derived from it, so a
tier is changed once in `globals.css` and never at a call site.

## 5. Colour

Theme tokens only: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`,
`text-pending`, and `text-overdue`.

- **No palette utilities** (`bg-neutral-100`, `text-zinc-500`). They do not invert
  in dark mode, which is how a screen ends up unreadable in one theme.
- **Both themes are shipped, not one flipped.** Every screen is checked in light
  and dark before it is done.

Light `--muted-foreground` is `oklch(0.5 0 0)` so secondary text clears 4.5:1 on the canvas, card, and muted tray.

- **Five documented exceptions.** Print documents use `bg-white text-black
border-black` because paper is white with black ink in every theme; the login
  context panel is a fixed dark surface in both themes; the landing page's wash
  (`components/landing/wash.tsx`) is a decorative gradient pinned to its light
  values in both themes, because a wash that inverts becomes a different object
  and because a bright stage carrying a dark app window is the effect it exists
  for — it sits behind product screenshots only, never behind type; clinical
  severity uses the named tokens below; and identity monograms use the four fixed
  pastel pairs below to distinguish records.
- **Clinical severity** is the one place hue carries meaning beyond tenancy
  state: `--clinical-alert` for what is dangerous about a patient (allergies, a
  balance still owed), `--clinical-note` for what is chronic (medical history),
  `--clinical-clear` for what is settled or explicitly absent. Each has a
  `-surface` and a `-border` companion and is defined in both themes in
  `globals.css`. A hue here is a claim about the patient, never decoration —
  and the word is still present, so the meaning survives for a reader who
  cannot see the colour.
- **Billing work state** uses `--pending` for Charges not yet invoiced and
  `--overdue` for an unpaid Invoice older than seven days. These tokens appear
  through labelled `Badge` variants; neither is a general accent colour.
- **Monogram colour carries identity, not status.** A patient ID, organization
  slug, or user email selects one of four muted duotone pairs (teal, indigo,
  rose, ochre) in `components/monogram.tsx`. Patients show initials;
  organizations and users show distinct symbols. Each uses `rounded` corners
  and stays legible at `size-6` in both themes. Do not use the pair for patient
  facts.
- **Elsewhere, colour means state.** `text-destructive` for a failure the user must
  act on. Status is carried by a `Badge`, never by colour alone — the word is
  always present.

## 6. Icons

Lucide only. Never a second icon set.

| Size              | Where                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| `size-3.5` (14px) | Inside the app shell: sidebar, table rows, card labels. Optically matches `text-xs`. |
| `size-4` (16px)   | Inside a `Button` or input — the component sets this; do not override.               |
| `size-5`+         | Empty-state illustration only, never an interface icon.                              |

A bare icon button needs `aria-label`. An icon beside text needs nothing.

**Where there is no picture, there is a `Monogram`** — a pastel identity square
for an organization, a member, or a patient. One size (`size-6`), with initials
for patients and symbols for organizations and users. A second hand-rolled
identity box is the bug, not a style choice.

## 7. Sidebar

The rail sits flat on the canvas (`--sidebar` equals `--background`) and the
content panel is the card that rises off it. The rail is not a card.

- **Hover is `bg-sidebar-accent/60`, the active row is the full accent plus
  `font-medium`.** They must not be the same value, or the current page is
  indistinguishable from whatever the pointer is passing over.
- **Nav icons are `text-muted-foreground` until the row is active.** This is the
  one place secondary colour is applied to an icon rather than to text.
- At widths below `lg` (including tablets), the rail is an off-canvas Sheet.
  `PageHeader` owns its trigger; pages and fixed footers never compensate for a
  collapsed desktop rail themselves.
- Primary and Settings destinations use zero-delay intent preloading. Pointer
  hover or keyboard focus warms route code and query data without eagerly
  running every sidebar destination loader when the shell mounts.

Keyboard focus is the global unlayered `:focus-visible` rule in `globals.css`: a
rounded 2.5px ring 2px off the element. Full-bleed targets flush against a
clipping edge or neighbouring row (menu items, options, `data-focus-inset` rows)
draw it inside; a tab whose box carries the strip underline puts the ring on an
inner `data-focus-ring` label. Components add no focus rings or offsets of their
own; do not remove or replace the rule. Hover effects are gated to
`(hover: hover) and (pointer: fine)`.

The skip link is the first focusable element and targets `#main` on every page root.

## 8. Layout primitives

Reach for these before writing a `div` with padding. All in
`apps/web/src/components/page.tsx`.

- **`PageBody`** — the page container: `p-4`, `gap-4`, `text-xs`. Every page inside
  the org shell starts with one.
- **`PageHeader`** — title, optional description, optional action. It renders the
  page's single 48 px title band, including the off-canvas sidebar trigger. A
  page never adds a second title or mobile trigger. It stays pinned to the top
  of the shell's content scroller; the body scrolls beneath it. Horizontal
  padding is `px-3` below `lg`, with `gap-3` between its menu trigger and title.
  Once the desktop rail is visible, the title uses `pl-6` for the small optical
  inset it needs beside the raised content panel.

**Say it once.** The people at the desk are receptionists, not technical staff,
and every repeated fact is one more thing to read past. A fact appears once per
screen: the record page's identity block owns name, MRN and phone; the
PageHeader description owns `Token N` and nothing else; a summary row never
repeats either. Where a name is shown, it is also the link to that record, with
a muted `ArrowUpRight` icon. A row shows one visible action — the common next
step — and moves rare or destructive ones into a `⋯` menu. An action the server
would refuse is not offered until it can succeed. Labels use desk words ("Add to
bill", "Bill remaining", "Add visit to plan"), never ledger verbs like "post".

**Page-header grammar.** Every page uses `PageHeader`. The title is a static noun
of at most two words. Never put data in the title. Put durable context in the
description: `Token N` identity on record pages, or a short phrase with no
trailing period. Patient records are the exception: `MRN · Name` lives in the
pinned identity strip, not the PageHeader description. A date appears only when
it is an interactive part of the screen: operational day navigation belongs in
the header action area, while screens fixed to today (such as Dashboard) do not
repeat today's date. Actions align to the right in the header. Sibling record
tab pages — views of one entity, like the OPD record's Clinical and Billing —
share one title and description, so switching tabs does not shift the layout.
Section tabs over distinct pages, like Settings, keep their own titles.

Page-header and panel-label-row actions use the default 32 px control height
(`icon` when icon-only), including secondary actions and operational date
navigation. This keeps sibling pages aligned without route-specific height
overrides. Row actions inside a list use `size="xs"`/`size="icon-xs"`; there is
no `sm`.
Creation actions are text-first. Labels such as `New`, `Add`, `Register`,
`Invite`, and `Create` do not repeat their meaning with a leading plus icon.
Button labels render in Title Case through the shared button primitive; routes
do not add one-off text transforms.
Every section label — flat or in a tray — is muted `text-xs` at plain weight, so
no section label competes with the page title. Flat section label rows carry
`min-h-6`, so a section with an action and one without are the same height.

**Two surfaces are exempt from the org-shell rules.** Public entry pages
(`login`, `join`, `create`, the root screen) do not use `PageHeader`; they may
use `text-base` and larger, sentence titles, and the fixed dark context panel.
Paper uses a separate black-on-white document system: billing documents are
server-rendered PDFs shown in an iframe, while the OPD slip remains the
`data-opd-slip` print article. Paper keeps bold weights and physical
measurements by design; do not "fix" it toward app-shell conventions. Billing
PDFs use native semantic HTML/CSS in Takumi, including `<thead>` for repeated
page headings, and only application-bundled fonts. Money and other changing
numerals stay aligned because ragged digit columns are a document defect, not a
style choice.

- **`ErrorNote`** — the one way a page reports a failed read.
- **`PageTabs` / `PageTab`** — the one tab strip below `PageHeader`. `PageTab`
  keeps typed route links, active state, and tab styling consistent. All sub-navigation
  starts at the left page gutter, including patient and OPD records, Settings,
  Pharmacy, and Billing. It never inherits a centered content column. The index
  link uses exact matching so it is not active on a child route.
- **Patient sections** — Record, Visits, Billing, and Treatment are child routes.
  The layout owns one live patient query; each child loads only its own data.
  Account totals belong to Billing, so the other sections do not load the full
  account. Record shows allergy and medical-history sections, followed by one
  patient details card containing contact, identity, guardian, and payer details.
  Patient and report content columns are centered within the page; their text stays
  left-aligned. As the page-header exception, the name and MRN appear once in the
  pinned compact identity strip, not again in PageHeader. Allergy and medical-history
  sections retain their color tokens without an outer Clinical notes panel. Open money
  and Refunds due panels fill the remaining page height.
- **`ListToolbar`** — the row above a list. Search comes first, followed by
  filters.
- **`SearchInput`** — the one uncontrolled search box. It trims the query and
  applies it after a 300 ms pause.
- **`list-filter.tsx`** — the one list filter idiom (D043): `FilterMenu` inside
  the search field, `FilterSubmenu` and checkbox items for each dimension,
  `FilterChips` for what is applied, and `DateSubmenu`/`DateFilter` for the
  business-date presets and custom range.
- **`Panel` / `PanelEmpty`** — the muted tray, label row, raised card, optional
  footer, and centered empty copy used by every list. `grow` fills the page on
  every page whose body is one list, so its footer sits at the same bottom edge
  everywhere; pages that stack several panels leave them at their rows. Patient visit details and advance receipts retain their disclosures. Non-growing panels within forms and disclosures use compact heights. A
  single-list page drops `label` when the page title already names the list:
  from `md` the table's column labels sit on the tray in the label row's place.
  A panel with an `action`, or one of several on a page, keeps its label.
- **`ListState`** — the only pending, error, retry, and empty-state branch for a
  list.
- **`LoadMore`** — the count and the only control that grows a cursor list. It
  belongs in the panel footer.
- **`DataList`** — for simple, read-only, low-density lists with a single row
  target. One `columns` definition renders the table at `md` and the compact
  row below it. The first column is the row name and target; `mobile: "title"`
  shares its line, while other columns join with `·`. `action` sits outside the
  target. Editable or information-dense rows own explicit responsive layouts:
  OPD service entry, the pharmacy sale cart, the audit log, and the Settings
  catalog (whose memoised row earned its place in a benchmark) do not use
  `DataList`.

**Choice controls.** Use a dropdown menu for actions and short option lists,
including the list filter's checkbox submenus. Use a popover when the anchored
surface contains interactive content such as the custom date calendar. Use a
combobox when someone must type to find and choose a record; use autocomplete
when the text remains editable and suggestions only help complete it. Keep
menu rows inset within their popup and group related items before a separator.

**List grammar.** Every list page puts `ListToolbar`, with search first and
filters after it, above a `Panel`. Search is temporary client state. It applies
after a 300 ms pause and has no submit button. Filters are URL search state. Every
dimension is a submenu of checkbox items under the field's filter button, and
each applied one is a removable chip; an absent parameter is the default, so it
is never a chip. A list with no search field to anchor to puts its date range on
a labelled `DateFilter` button instead of behind an icon. Read states come only
from `ListState`. A cursor list grows only through `LoadMore` in the panel
footer, which also shows the count. Operational tables never scroll
horizontally: below `md` a list renders one compact card per row (`text-xs`,
`px-3 py-2`, `border-b`, the row's own link or activation handler) with the
identifier, primary name, and status on the first line and secondary facts
below, and the table returns at `md`. Report and print tables are the one
exception and keep the primitive's horizontal scroll. A scrollbar is 6 px on
both axes; the sidebar rail hides its own because a rail is not a data region.
A long text cell wraps with `wrap-break-words` when its content is why the reader is
there, or uses `max-w-0` with an inner `truncate` `div` and a `title` when it
is secondary. Identifiers stay whole: when one can outgrow the row, the table is
`table-fixed` with declared column widths and the identifier cell wraps with
`break-all`.

**Row activation.** A row that opens one record is one target: its primary
link or button carries `after:absolute after:inset-0` inside a `relative` row,
and any second control in the row is `relative` so it stays on top (`z-10` when
it comes before the primary control). A row edited in place keeps its explicit
buttons and has no row target, so a stray click at the counter cannot open an
editor. Read-only rows are not clickable.

A new bespoke layout wrapper is a signal that one of these is missing a prop.

## 9. Density and emptiness

- **A panel holds its height when empty.** An empty dashboard should read as a
  dashboard with nothing in it, not as a collapsed page. Panels declare a
  `min-h-*` so the layout is the same shape at 0 rows as at 20.
- **Empty text states what would be here**, in `text-muted-foreground`, as a
  short label with no trailing period: "The queue is empty", not "No data". A
  second sentence earns its place only by stating a consequence or rule the
  reader cannot infer.
- **Nothing stands in for data that has not arrived.** A page renders only the
  chrome it can build from route params: its header band. The data region stays
  empty until the data lands. The panel's `min-h-*` makes that blank region read
  as an empty panel, not a collapsed page.
- **Rows already on screen stay while the search term changes.** A list that
  blanks between keystrokes reads as "nothing found", a different statement
  from "still loading". A day or filter change remounts a list whose rows carry
  actions, so another queue's rows never stand in with live controls, and a
  first load never shows placeholder rows (D037). A route loader fetches what its screen paints,
  so a panel that the page owns arrives with the page instead of after it.

## 10. Task overlays

- Mobile and tablet navigation use the same shared Sheet primitive; there is no
  breakpoint-specific duplicate. Every Sheet is inset from the viewport, uses
  the large radius, and carries a 2 px muted boundary around its full perimeter.
- Focused forms use the same header, scrollable content and footer composition
  in both Dialog and Sheet presentations. Their content column is capped at
  `max-w-lg`; switching presentation must not rearrange the form.
- Overlay task titles are `text-base`; descriptions, labels, controls and errors
  are `text-xs`. Financial totals use weight and tabular numerals for hierarchy,
  not an additional display-size type scale.
- Sheet and dialog chrome owns its spacing. Headers, bodies and footers use
  `p-4`; feature forms compose `SheetHeader`/`SheetFooter` or
  `DialogHeader`/`DialogFooter` rather than recreating their borders and padding.
- Forms compose `FieldGroup`, `Field`, `FieldSet` and `FieldError`. Sets of two
  to five choices use a `NativeSelect` or a `role="group"` row of buttons that
  carry `aria-pressed`, and section boundaries use `Separator`.
- An overlay holding a pending money write ignores Escape, backdrop, and close
  until the write settles.
- Sheet motion is limited to the existing 150 ms opacity and directional
  transform transition. It communicates where the occasional overlay came from;
  frequent list and keyboard interactions remain static.

## 11. Charts

- **Pick the form from the data's job**, not from what looks good. Magnitude over
  time → bars. A single headline → a stat card, not a chart.
- **One series needs no legend** — the panel title names it. Two or more always get
  one.
- **Never a dual axis.** Two measures of different scale are two charts.
- **Colour is `currentColor`/tokens**, so the chart inverts with the theme instead
  of being flipped by hand.
- **Gap-fill time series in SQL.** A day with no rows plots as a zero, or the axis
  silently compresses and lies.
- **A bar chart is interactive by default**: per-bar hover, a readout that does not
  reflow the plot, hit targets the full column height.

## 12. Motion

- **Entrances `ease-out`, never `ease-in`.** Keep UI motion under 200ms.
- **`transform` and `opacity` only.** No animating width, height, or top.
- **The more frequent the action, the less it animates.** A view switch a user
  performs 100 times a session gets no transition at all.
- **`prefers-reduced-motion` is handled globally** in `globals.css`; do not
  re-implement it per component.

## 13. Money and numbers

- **Amounts cross the wire as `numeric` strings**, never JS numbers — rounding money
  through a float is a bug waiting to happen.
- **Format at the edge** with `Intl.NumberFormat`, currency from org settings.
- **Right-align numeric table columns**; left-align text.

## Checklist before calling a screen done

- [ ] When a card tray is used, canvas, shell and card are three visibly distinct surfaces.
- [ ] Card trays group related rows only; flat sections use hairlines and typography, and no card sits inside a raised surface.
- [ ] No route-level arbitrary values; only the documented component and print exceptions.
- [ ] Every colour is a token; checked in light **and** dark.
- [ ] Spacing uses the scale; no margins on children where a gap would do.
- [ ] `tabular-nums` on every changing number; `font-mono` on identifiers.
- [ ] Icons are Lucide at `size-3.5`/`size-4`.
- [ ] Panels hold their height when empty, and say what would be there.
- [ ] No placeholder stands in for loading data.
- [ ] The page uses `PageBody` / `PageHeader`, not a bespoke wrapper.
- [ ] No fact repeats on one screen (header vs body, summary vs detail); names link to their record.
- [ ] Each row has at most one visible action; the rest sit in a `⋯` menu.
