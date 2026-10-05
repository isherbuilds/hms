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

**Verification.** On 2026-10-04 these passed: desktop/mobile light/dark,
native-wheel reverse scroll (no overlap with the journey), short viewports and
reduced motion. On constrained viewports the role cards now take their natural
height; the animated deck stays on viewports of at least 1024×900 (D050
amended). The slow-4G dashboard was captured, and the treatment demo's lower
rows are present in the DOM without overflow. Still owed: a visual capture of
those lower rows.

### [Bot review UI fixes](./design.md#8-layout-primitives)

**Verification.** At 390px, the mobile OPD ₹900 rate and ₹8,99,100 totals read
correctly in light and dark with no overflow. Still owed: the mobile audit
actor's name and email, and medicine suggestion pack values after an operator
edit.

### [Keyboard focus](./design.md#7-sidebar)

**Verification.** With physical Tab, the patient sheet and founder `/create`
show unclipped rings on desktop/mobile light/dark. Still owed: `/join`, org
onboarding, compact rows, the mobile sidebar, the custom date popover and the
record combobox.

### [Static choice controls](./design.md#10-task-overlays)

**Verification.** Patient native choices pass on desktop/mobile light/dark:
current value, keyboard selection and submission. Time zones now use modern
IANA names on client and server: Asia/Tokyo → Asia/Kolkata → reload persists
Asia/Kolkata. Still owed: the pharmacy and billing choices. Known issue: the
"Settings saved" toast covers the Save button until it fades.

### [Treatment plans and advances](./opd.md#intake)

**Verification.** D052 settles the Advance Receipt GST particulars. D053 fixes
the earning milestone as per-sitting proportionate completion under D047.

- **After a pilot month:** every open course is a plan, no Invoice precedes its
  posting, and Follow-ups is in daily use. Three cases work without a
  pre-delivery Invoice: an RCT abandoned after two sittings; a ten-session
  course paid by three advances across several Invoices; an RCT with a crown
  added mid-course.
- **D047 cutover:** a pilot database owner confirms migration `0008` ran once,
  compares affected plan quotes with the pre-migration unit price × sittings,
  and records the stopped-writer interval.
- **In-app:** passed 2026-10-04 on desktop/mobile light/dark. With only another
  plan's ₹300 advance, both credit fields start at zero, accept 300 and reject 301.
  D051 also passed at runtime: crediting a billed sitting returns it to
  unbilled, reopens the plan, and a later visit re-bills it.

### [Custom OPD rates](./opd.md#catalog-and-charge-meaning)

**Verification.** Edit, blank reset, server quote and booking pass on
desktop/mobile light/dark; SQL confirms the custom ₹900 on Charges and the
issued Invoice line. Fixed: the mobile rate input kept a stale value after a
desktop commit.

### [Patient contacts and name casing](./product.md#patient-contacts)

**Verification.** Print layouts pass. On 2026-10-04 the thermal, Receipt, Credit
Note and Refund PDFs (registered and neutral) were fetched as owner and
inspected. Still owed: checks on physical A4 and 80 mm printers at the pilot.

### [Invitation account onboarding](./research/invitation-account-onboarding.md)

**Blocked.** An email provider exists; then add mailbox verification per the memo and retire the id-as-proof rule in D006

### [Payment methods, bank transfer, sponsors](./specs/payment-methods-cheques-and-sponsors.md)

**Active.** After one month of pilot use the method-mix and sponsor-share counts are recorded and the payer-domain go/no-go is decided

### Public site owner decisions

**Blocked.** D062 settles the open decisions:

- AI-training crawlers are disallowed.
- support@edernal.com is the public channel; the founder answers it and
  acknowledges within 48 hours.
- `/privacy`, `/terms` and `/security` had an engineering gap review against
  the DPDP, SPDI, e-commerce and CERT-In rules.
- Phone and WhatsApp links are hidden when unset.

Counsel must approve the pages before publication, with the verified operator
identity and the grievance officer's details. `/terms`, `/security`, `/contact`
(desktop/mobile) and the live `/robots.txt` are verified.

### [Production hardening](./operations.md#production-hardening)

**Verification.** Release-time evidence on the deployed host records digests, sizes, header checks, and a reviewed cleanup dry run

### [Pilot readiness](./operations.md#pilot-readiness)

**Active.** A named owner records every operational, accounting, print, restore, and compliance gate complete

### [Pharmacy counter sale and stock](./specs/pharmacy-counter-sale-and-stock.md)

**Verification.** D061 closes the assumed Stage 0 answers. D052 settles GST
classification, statutory particulars, 16-character numbering and purchase-GST
cost. The 2026-10-04 browser pass on desktop/mobile light/dark covered:

- Product creation
- receipt and opening conversion
- the Medbuzz keyboard pick
- a sale and its PDF (inclusive MRP: 112 = 100 + 6 + 6)
- return, quarantine and release

H1 prescriber, internal issue, filter chips, Load more and date defaults also
pass. External: one pilot month (sales by day, stock reconciled to a physical
count, zero movements outside HMS), and the real issuer and licence documents.

### [Supplier bill reconciliation](./specs/pharmacy-counter-sale-and-stock.md#out-of-scope)

**Verification.** D060 as simplified on 2026-10-04: a receipt carries freight/packing
charges and bill discounts with their GST, typed as positive amounts whose kind
sets the sign, and the lines plus adjustments match the bill total within ₹0.99.
Settlement credits, historical TCS, references and a stored round-off were
removed. Still owed: the receive page on desktop/mobile light/dark, and
consecutive real bills from the pilot's suppliers.

### [Pharmacy goods and services](./specs/pharmacy-goods-and-services.md)

**Verification.** Products, Receive goods and counter sale/return pass on
desktop/mobile light/dark, including GST, counted unit and printed pack. Fixed
along the way: checked checkboxes in dark mode and truncated mobile stock rows.
Services and the OPD GST quote (₹400 + ₹100 + ₹18) pass on desktop/mobile
light/dark. The production migration is manual with no data backfill, and
pilot setup needs a fresh physical count.

### [Pharmacy packs and loose units](./specs/pharmacy-packs-and-loose-units.md)

**Verification.** The strip-of-10 seam passes: UI and SQL agreed at each step
(receive 50, sell 4 → 46, return 3 to quarantine, release → 49). A BP apparatus
was received with no expiry and sold (3 → 2). A scripted three-item sale with
one loose line takes a median of 3.2 s. Pilot evidence: count loose versus
whole-strip lines in one week of incumbent bills. Before push, the owner
confirms production has no rows in `products`, `stock_batches` or
`goods_receipt_lines` and no pharmacy Charges.

### [Blank data regions](./design.md#9-density-and-emptiness)

**Verification.** Lists now announce loading through a hidden status, and route
changes announce their title. A failed optional panel keeps its ErrorNote, with
no interval refetch until data exists, and recovers on focus or reconnect.
Slow-4G dashboard samples showed no zero-height region. Still owed: cold opens
of OPD, patients, billing and pharmacy, and a full screen-reader pass.

### [Sidebar active state](./design.md#7-sidebar)

**Verification.** Desktop light passes: across 1432 sampled frames only the old
and new states appear. Still owed: desktop dark and mobile light/dark.

### [List row activation](./design.md#8-layout-primitives)

**Verification.** Clicking a held-advance row opens patient Billing. Still owed:
OPD appointments, open money, refund due, patient invoices, and each row's
second control.

### [Choice controls](./design.md#8-layout-primitives)

**Verification.** Desktop light passes: the organization menu's active mark,
keyboard opening and selection, and the account menu opening above its trigger.
Still owed: dark and mobile menus, list filters, the custom calendar, and on
record comboboxes physical Tab, search and empty results.

### [OPD appointment forms](./opd.md)

**Verification.** Desktop light passes: the reschedule default matches the
booked local time, an empty value shows "Choose a date and time", and the
submit shows pending, then success. Still owed: cancel, the other viewports and
themes, and close-while-pending.

### [Revenue control](./specs/revenue-control.md)

**Verification.** Simplified on 2026-10-04: the owner digest and weekly module use
were removed. The page keeps net billed revenue with its correction bridge,
expiry exposure and review signals; register and signal totals come with the
first page only, and each Excel sheet is one query. Integration tests pass.
Still owed: both pages on mobile and dark, staff denial, downloads, print, and
one hand reconciliation.

### [Backups](./operations.md#backups-and-restore)

**Active.** The in-app data-safety subsystem was removed on 2026-10-04. Provision
the Coolify scheduled PostgreSQL backup and `weed filer.backup`, then run and
record the first isolated restore before go-live.

### [Outage continuity](./specs/outage-continuity.md)

**Blocked.** Review only: D058 settles the design (a paper bridge of up to four
hours, separate manual books, re-entry dated on the recording date with the
original time). Implementation was reverted on the owner's instruction. It
waits for the owner's go-ahead and for real books, a roster and a staffed drill.

### [Onboarding import](./specs/onboarding-import.md)

**Blocked.** D059 settles the design: fresh MRNs with searchable legacy
identifiers, read-only old finances and the reserved operator role. It needs an
authorised sample export from an unrelated hospital and its approvers.

### [IPD admission to discharge](./specs/ipd-admission-to-discharge.md)

**Blocked.** D056 settles the design: noon checkout, a one-day minimum,
occupancy-weighted transfers, packages and a self-pay-first release. D025, D027,
D042 and D049 are amended conditionally. The only open gate is the
[IPD/ADT gate](./product.md#roadmap-gates): a paying hospital and a named owner.

### [Cashless claims](./specs/cashless-claims.md)

**Blocked.** D055 settles TDS, payer Credit Notes, patient liability, the
approved write-off path and retention. D029 and D012 are amended conditionally.
It needs live IPD and the [Insurance/TPA gate](./product.md#roadmap-gates).

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
