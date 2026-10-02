# HMS documentation

Use the [staff guide](../apps/fumadocs/content/docs/index.mdx) for tasks in the
app. Use the pages below to develop, operate, or review HMS. Keep each fact in
one owner document and link to it elsewhere.

- New contributor: [Development](./development.md#start-locally).
- Product behavior: [Product](./product.md), [OPD](./opd.md), and [Reports](./reports.md).
- Pharmacy contracts: [counter sales and stock](./specs/pharmacy-counter-sale-and-stock.md),
  [goods and services](./specs/pharmacy-goods-and-services.md), and
  [packs and loose units](./specs/pharmacy-packs-and-loose-units.md).
- Deployment or pilot preparation: [Operations](./operations.md).
- Unfinished work: [Work lifecycle](#work-lifecycle).

| Document                                | Owns                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| [Product](./product.md)                 | Scope, vocabulary, roadmap gates, and product invariants             |
| [OPD](./opd.md)                         | Shipped intake, queue, record, and care-setting billing behavior     |
| [Reports](./reports.md)                 | Billing worklists and day-close reports                              |
| [Architecture](./architecture.md)       | Runtime shape, tenancy, authorization, data, storage, and accounting |
| [Development](./development.md)         | Local setup, code style, tests, and contribution rules               |
| [Operations](./operations.md)           | Environment, deployment, backups, and release checks                 |
| [Design](./design.md)                   | UI tokens, density, layout, motion, and completion checklist         |
| [Decisions](./decisions.md)             | Current expensive-to-reverse choices and their reasons               |
| [Research ledger](./research/README.md) | Evidence summaries and unresolved validation questions               |

## Work lifecycle

This is the sole registry for unfinished documentation-backed work. Each linked
file owns its contract or evidence; lifecycle is recorded only here. **Active**
means implementation remains, **Blocked** means a named prerequisite prevents
progress, and **Verification** means implementation is complete but its exit
evidence is not. Product roadmap items remain evidence-gated—not active work—
until their trigger is met and they enter this registry.

### [Landing page code reduction](./design.md)

**Verification.** The 2026-09-30 pass cut the home page sections and moved their type, radius and spacing onto the standard scale. A browser pass covered desktop light and mobile dark: journey pin, roles stack with settle and chapter clicks, bed tiles, reveals and the FAQ. Still to check: the reduced-motion tabs, desktop dark and mobile light. Known before this pass: on a phone the front-desk and billing role cards are taller than the stack and clip.

### [Bot review UI fixes](./design.md#8-layout-primitives)

**Verification.** Start local services, then check mobile audit actor name and email, OPD service rate and large totals, and medicine suggestion pack values after an operator edit. Docker and the web app were unavailable on 2026-09-24.

### [Patient routes and compact workspaces](./design.md#8-layout-primitives)

**Verification.** Desktop/mobile layout and patient active-route checks passed. Repeat Take Advance and advance receipt disclosure on the new patient Billing route, and verify a foreign-org patient direct URL is denied, in an isolated browser session. The shared browser changed during the final interaction checks.

### [Keyboard focus](./design.md#7-sidebar)

**Verification.** Desktop light: login fields and Sign in, page tabs, sidebar, list filter search, patient table row, organization menu item, and catalog checkbox show the rounded ring unclipped; page tabs also checked dark. Remaining: mobile widths, dark theme beyond tabs, dialogs and sheets, comboboxes and the custom date popover, compact list rows, `/join` and onboarding.

### [Static choice controls](./design.md#10-task-overlays)

**Verification.** Start the web and API after the local migration mismatch is resolved. In desktop and mobile light/dark, exercise native choices in patient, pharmacy, billing, and settings forms. Verify current values, keyboard selection, and submission; confirm loaded-record comboboxes still search.

### [Credit note on a plan sitting](./opd.md#intake)

**Blocked.** A credit note leaves the charge invoiced, so the plan still counts that sitting as billed and cannot re-bill it; voiding before invoicing is correct. Needs an accounting decision on whether credited plan charges stop counting as posted before code changes.

### [Treatment plans and advances](./opd.md#intake)

**Verification.** After a pilot month: every open course is a plan, no Invoice precedes its posting, Follow-ups is in daily use, and three cases work without a pre-delivery Invoice (an RCT abandoned after two sittings; a ten-session course paid by three advances across several Invoices; an RCT with a crown added mid-course). The chartered accountant answers the two open questions in [OPD](./opd.md#intake). D047 cutover remains unverified: a pilot database owner must confirm migration `0008` ran once, compare affected plan quotes with the pre-migration unit price × sittings, and record the stopped-writer interval. Once the app runs, check invoice and settlement credit fields with only another plan's advance: start at zero, allow a typed amount up to total credit, and reject amounts above it on desktop and mobile in both themes.

### [Custom OPD rates](./opd.md#catalog-and-charge-meaning)

**Verification.** Finish desktop/mobile browser checks

### [Patient contacts and name casing](./product.md#patient-contacts)

**Verification.** Inspect thermal, Receipt, Credit Note, and refund layouts with retained sample documents

### [Invitation account onboarding](./research/invitation-account-onboarding.md)

**Blocked.** An email provider exists; then add mailbox verification per the memo and retire the id-as-proof rule in D006

### [Payment methods, bank transfer, sponsors](./specs/payment-methods-cheques-and-sponsors.md)

**Active.** After one month of pilot use the method-mix and sponsor-share counts are recorded and the payer-domain go/no-go is decided

### Public site owner decisions

**Blocked.** The owner supplies legal name, CIN, registered office, support and sales email, the WhatsApp Business number and who answers it, and decides on a lead form, training-crawler access, and a booking tool

### [Production hardening](./operations.md#production-hardening)

**Verification.** Release-time evidence on the deployed host records digests, sizes, header checks, and a reviewed cleanup dry run

### [Pilot readiness](./operations.md#pilot-readiness)

**Active.** A named owner records every operational, accounting, print, restore, and compliance gate complete

### [Frontend pattern items](./research/frontend-patterns.md#remaining-work)

**Active.** Batching is measured and landed or dropped; the remaining `useSearch` selector sites are measured or dropped

### [Midday adoption performance exceptions](./research/data/perf-midday-adoption/README.md)

**Verification.** A named owner accepts the three bound misses as ambient drift, or re-measures them within bounds

### [Pharmacy counter sale and stock](./specs/pharmacy-counter-sale-and-stock.md)

**Verification.** Slices 1–3 landed 2026-09-18 with products, opening receipts, department issues and the filter toolbar (D042); the sales list became the section landing page and the desk moved to `/pharmacy/new` on OPD intake's layout. A signed-in browser pass on desktop and mobile covers the new desk end to end (batch search, H1 prescriber, Collect overlay, hand-off to the opened sale), Products, Receive goods (priced supplier delivery with free quantity and bill-total check, opening count, inline new medicine, pack counting), Stock (internal issue, filter chips, Load more) and the date defaults on Dashboard, OPD and Sales. A 2026-09-23 pass covered the Movements tab (org-wide and batch-filtered), 1mg name suggestions with keyboard pick and the duplicate-name warning, and the receive mode toggle without attachments; the 2026-09-24 switch to browser-fetched Medbuzz and Truemeds suggestions (D046) still needs that pick exercised in a signed-in browser. Then one pilot month with the incumbent read-only: sales by day, stock per batch reconciled to a physical count, and zero movements recorded outside HMS. The owner confirms the assumed Stage 0 answers at the walkthrough

### [Supplier bill reconciliation](./specs/pharmacy-counter-sale-and-stock.md#out-of-scope)

**Active.** Before the purchasing spec locks bill reconciliation, inspect 10–20 real supplier invoices for header-level freight, handling, and miscellaneous adjustments outside the current line-sum ±₹0.99 model; record whether that model holds. Do not build header-charge support before the evidence and purchasing decision.

### [Pharmacy goods and services](./specs/pharmacy-goods-and-services.md)

**Verification.** Implemented 2026-09-29: Products own sale facts, Services excludes pharmacy, and pharmacy Charges trace batches without a catalog link. Owner browser verification remains: Products, Receive goods, counter sale/return, Services and OPD quote on desktop/mobile in light/dark, including GST, counted unit, and printed pack. Production migration is manual with no data backfill; pilot setup and opening stock require a fresh physical count.

### [Pharmacy packs and loose units](./specs/pharmacy-packs-and-loose-units.md)

**Verification.** Owner browser seam: add a tablet Product with a strip of 10, receive 5 strips, sell 4 tablets, print, return 3, release; check stock after each step on desktop/mobile in light/dark. Receive and sell a BP apparatus without expiry. Pilot evidence: count loose versus whole-strip lines in one week of incumbent bills and time a three-item sale with one loose line. Before push, the owner confirms production has no rows in `products`, `stock_batches` or `goods_receipt_lines` and no pharmacy Charges.

### [Blank data regions](./design.md#9-density-and-emptiness)

**Verification.** Slow-4G cold-open and screen-reader checks confirm no collapsed region and no ambiguous silent navigation

### [Patient monogram colour experiment](./design.md#5-colour)

**Verification.** Inspect the patient header, selected patient input, and shell organization and user profiles in a signed-in browser on desktop and mobile, in light and dark themes. Confirm the pastel colours and symbols read as identity only, then keep or revert the experiment.

### [Sidebar active state](./design.md#7-sidebar)

**Verification.** With the app running, click between sidebar destinations on desktop and mobile in light and dark themes. Confirm the old and new active rows change colour without a flash.

### [List row activation](./design.md#8-layout-primitives)

**Verification.** With OPD appointments, open money, a refund due, held advances, and patient invoices in local data, click empty space in each row and its second control on desktop; confirm the row opens its record and the second control still works

### [Choice controls](./design.md#8-layout-primitives)

**Verification.** Start the local services, then inspect the organization and account menus, list filters and custom date popover, and a record combobox on desktop and mobile in light and dark themes. Check keyboard focus, opening near viewport edges, selection, empty results, and the active organization mark. On 2026-09-29, desktop light checks passed for OPD and pharmacy patient picks, pharmacy batch add, receipt product pick and edit, and treatment procedure pick and edit. The input kept focus after each pick; the batch search cleared for the next item. The receipt product popup and empty state had no horizontal overflow at 500px in light and dark. Remaining: physical Tab checks (the Chrome tool sent no keydown event) and mobile interaction checks. Also inspect the organization and account menus, list filters, and custom date popover in both themes.

### [OPD appointment forms](./opd.md)

**Verification.** With the web and API running, reschedule and cancel an appointment on desktop/mobile in light/dark. Check the local date and time default, required field messages, success, and close while pending. The Portless web and API registrations did not respond on 2026-09-29.

End-user help belongs in `apps/fumadocs`, not here. Code is authoritative for
exact APIs, schemas, permissions, and environment validation; these docs explain
the stable shape and why it exists.

## Documentation rules

- Write current behavior in present tense. Git is the changelog.
- Record an expensive-to-reverse choice in [decisions](./decisions.md); do not
  create a new file for it. A changed decision is rewritten or deleted in place,
  never kept beside its replacement.
- A spec is active only while it owns unfinished work. When complete, reduce it
  to durable behavior or fold it into product/architecture docs.
- Research is evidence, not authority. Promote accepted conclusions into the
  relevant living doc and reduce the research entry to a short ledger item.
- Update the closest source of truth in the same change as behavior. Delete
  stale text instead of adding a correction beside it.
- Prefer links to repeated rules. `AGENTS.md` stays a map plus hard invariants.
