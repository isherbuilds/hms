# Landing header anatomy

Observed 2026-09-04. Evidence, not product truth. Companion to
[landing page composition](./landing-page-composition.md), which covers the page
below the bar; this note covers the bar itself.

## Question

What does a landing header actually contain in the sites we keep referencing,
and where do the design-led and healthcare tiers disagree about it?

## Answer

**Both tiers ship the same skeleton: a wordmark, one to four doors, and two to
three right-hand actions ending in a primary. They disagree about which action
is primary.**

Design-led sites make the primary action _self-serve_ — Cursor's is Download.
Healthcare sites make it a _conversation_ — Tebra ends on "Get demo", Jane on
"Book a demo". Every healthcare reference puts demo booking in the bar itself,
not only in the hero. For HMS, whose hero already carries both, that argues the
bar should show `Sign in` (secondary), `Book a walkthrough` (secondary), and
`Open your hospital` (primary), which is Cursor's three-action shape with the
healthcare tier's middle action.

The second disagreement is menu depth. Design-led product menus list features.
Healthcare product menus segment by **who is buying** as well as what the
software does: Tebra splits Products by practice type and specialty, Jane by
what the clinic is doing (Scheduling, Charting & Care, Clinic Management, Clinic
Marketing). A hospital visitor arrives knowing their job before they know your
module names.

## Evidence

| Site   | Wordmark | Doors (dropdowns in bold)              | Plain links                     | Right-hand actions                   |
| ------ | -------- | -------------------------------------- | ------------------------------- | ------------------------------------ |
| Cursor | left     | **Models**, **Product**, **Resources** | Enterprise, Pricing             | Sign in · Contact · **Download**     |
| Midday | left     | **Features**, **Resources**            | —                               | Sign in                              |
| Tebra  | left     | **Products**, **About**, **Resources** | Features, Pricing, Case Studies | Sign In · Take a tour · **Get demo** |
| Jane   | left     | **Features**, **Learn**, **About Us**  | Pricing                         | Sign up · **Book a demo** · Sign in  |

Sources: [cursor.com](https://cursor.com/), [midday.ai](https://midday.ai/),
[tebra.com](https://www.tebra.com/), [jane.app](https://www.jane.app/), read
2026-09-04.

**Nav placement.** Cursor's nav is horizontally centred on the page. Midday's
sits centre-left. The centred bar needs a three-column grid, not
`justify-between`: the wordmark and the action cluster have different widths, so
space-between leaves the nav wherever the remainder falls.

**Door contents, sizes observed.** Cursor's Product menu carries 8 items,
Resources 8. Tebra's Products menu carries roughly 25 across four labelled
groups. Jane's Features menu carries 19 across four groups plus a "View All
Features" escape. Nobody ships a four-item menu: the door is expected to open
onto something worth the trip.

**What nobody puts in the bar.** No reference exposes Security, Docs, or
Changelog as a top-level link — they live inside a Resources door. Pricing is
top-level in three of four.

## What this does not prove

These are norms, not conversion evidence. In particular the demo-first primary
action reflects a sales-led motion; HMS is self-serve at sign-up, so copying the
label without the motion behind it would be cargo cult.
