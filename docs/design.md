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

| Surface | Token                       | What it is                                          |
| ------- | --------------------------- | --------------------------------------------------- |
| Canvas  | `bg-background`             | The page. Nothing sits directly on it except cards. |
| Shell   | `bg-muted`                  | The tinted wrapper that carries a card's label.     |
| Card    | `bg-card` + `border-border` | The raised surface that carries the content.        |

**The card-in-card pattern** is the house style for anything with a label:

```
┌ shell (bg-muted, rounded-xl, p-1) ──────────┐
│  label row (h-9, px-3, muted-foreground)    │
│ ┌ card (bg-card, border, rounded-lg, p-4) ┐ │
│ │  the content                            │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

The shell is what makes a grid of cards read as one instrument rather than as
six unrelated boxes. Do not nest a shell inside a shell.

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

- **Page padding is `p-4`, applied by `PageBody`.** Pages do not set padding.
- **Prefer `gap` on the parent over margins on children.** A margin is a decision
  only the child knows about; a gap is one the layout owns. `mt-*`/`mb-*` on a
  child is a smell — the sole exception is the optical nudge under a label, and
  `PageHeader` owns it.
- **`5`, `7`, `9` and fractional steps are not in the scale.** Reaching for `p-5`
  means the answer is `p-4` or `p-6`.

## 3. Type

A dense data surface. `text-xs` is the body size, not a small size.

| Size                            | Where                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `text-xs` (12px)                | Default: table cells, labels, body copy, buttons, inputs               |
| `text-sm` (14px)                | Page and section titles                                                |
| `text-3xl` (30px)               | The headline number on a stat card — where the number _is_ the content |
| `text-base`/`text-lg`/`text-xl` | Public pages only (`/login`). Never inside the org shell.              |

- **No `text-[13px]`-style values.** A missing step means the design is wrong, not
  the scale. The only arbitrary sizes live in print documents, measured in `mm`
  against physical paper.
- **Weight carries hierarchy, not size.** `font-medium` for titles and the active
  row; regular elsewhere. There is no `font-bold`.
- **`text-muted-foreground` is the only secondary colour** — not an opacity, not a
  lighter grey.
- **`font-mono` is for identifiers compared character by character**: MRN, invoice
  number, token, actor id, catalog code. Never prose, never amounts.
- **`tabular-nums` on every number that can change** — counts, money, times. Without
  it a live-updating figure jitters.

**Fonts.** Inter Variable (UI) and JetBrains Mono (identifiers), both self-hosted
via `@fontsource-variable/*`. No CDN: the app must work on a hospital LAN with no
outbound internet. Two families, no more.

## 4. Radius

Set by the component layer, never at a call site.

| Radius         | Where                                                        |
| -------------- | ------------------------------------------------------------ |
| `rounded-md`   | Controls: buttons, inputs, menu items, badges                |
| `rounded-lg`   | Cards, dialogs, popovers, the login context panel            |
| `rounded-xl`   | The card shell                                               |
| `rounded-full` | `Button shape="pill"` only — currently the sign-in CTA alone |

A component in `packages/ui` owns its radius. If a page is writing `rounded-*`,
either it is building a shell (allowed) or the component is missing a variant.

The base is `--radius: 0.625rem`; every step above is derived from it, so a
tier is changed once in `globals.css` and never at a call site.

## 5. Colour

Theme tokens only: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`.

- **No palette utilities** (`bg-neutral-100`, `text-zinc-500`). They do not invert
  in dark mode, which is how a screen ends up unreadable in one theme.
- **Both themes are shipped, not one flipped.** Every screen is checked in light
  and dark before it is done.
- **Two documented exceptions.** Print documents (`bg-white text-black
border-black` — paper is white with black ink in every theme), and the login
  context panel, a fixed dark surface in both themes by design.
- **Colour means one thing: state.** `text-destructive` for a failure the user must
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

**Where there is no picture, there is a `Monogram`** — the initials square used
for an organization, a member and a patient. One size (`size-6`), two tones. A
second hand-rolled initials box is the bug, not a style choice.

## 7. Sidebar

The rail sits flat on the canvas (`--sidebar` equals `--background`) and the
content panel is the card that rises off it. The rail is not a card.

- **Hover is `bg-sidebar-accent/60`, the active row is the full accent plus
  `font-medium`.** They must not be the same value, or the current page is
  indistinguishable from whatever the pointer is passing over.
- **Nav icons are `text-muted-foreground` until the row is active.** This is the
  one place secondary colour is applied to an icon rather than to text.

Keyboard focus is the global unlayered `:focus-visible` rule in `globals.css`;
do not remove or replace it with component-only rings. Hover effects are gated
to `(hover: hover) and (pointer: fine)`.

## 8. Layout primitives

Reach for these before writing a `div` with padding. All in
`apps/web/src/components/page.tsx`.

- **`PageBody`** — the page container: `p-4`, `gap-4`, `text-xs`. Every page inside
  the org shell starts with one.
- **`PageHeader`** — title, optional description, optional action. It renders the
  page's single title band, so a page never adds a second one.
- **`ErrorNote`** — the one way a page reports a failed read.

A new bespoke layout wrapper is a signal that one of these is missing a prop.

## 9. Density and emptiness

- **A panel holds its height when empty.** An empty dashboard should read as a
  dashboard with nothing in it, not as a collapsed page. Panels declare a
  `min-h-*` so the layout is the same shape at 0 rows as at 20.
- **Empty text states what would be here**, in `text-muted-foreground`: "The queue
  is empty", not "No data".
- **Nothing stands in for data that has not arrived.** A page renders only the
  chrome it can build from route params: its header band. The data region stays
  empty until the data lands. The panel's `min-h-*` makes that blank region read
  as an empty panel, not a collapsed page.

## 10. Charts

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

## 11. Motion

- **Entrances `ease-out`, never `ease-in`.** Keep UI motion under 200ms.
- **`transform` and `opacity` only.** No animating width, height, or top.
- **The more frequent the action, the less it animates.** A view switch a user
  performs 100 times a session gets no transition at all.
- **`prefers-reduced-motion` is handled globally** in `globals.css`; do not
  re-implement it per component.

## 12. Money and numbers

- **Amounts cross the wire as `numeric` strings**, never JS numbers — rounding money
  through a float is a bug waiting to happen.
- **Format at the edge** with `Intl.NumberFormat`, currency from org settings.
- **Right-align numeric table columns**; left-align text.

## Checklist before calling a screen done

- [ ] Canvas, shell and card are three visibly distinct surfaces.
- [ ] No arbitrary values outside print documents.
- [ ] Every colour is a token; checked in light **and** dark.
- [ ] Spacing uses the scale; no margins on children where a gap would do.
- [ ] `tabular-nums` on every changing number; `font-mono` on identifiers.
- [ ] Icons are Lucide at `size-3.5`/`size-4`.
- [ ] Panels hold their height when empty, and say what would be there.
- [ ] No placeholder stands in for loading data.
- [ ] The page uses `PageBody` / `PageHeader`, not a bespoke wrapper.
