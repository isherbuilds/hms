# Decision log

Each entry is a current, expensive-to-reverse choice and why it was made.
Living behavior belongs in [Product](./product.md) or
[Architecture](./architecture.md). When a decision changes, rewrite or delete its
entry; Git keeps the old text. Numbers are stable identifiers and are never
reused.

### D001 — Explicit per-request tenant claim

**Accepted.** Organization
scope is immutable `orgSlug` in root URLs and typed procedure input, never
session state or a fallback. `orgProcedure(permission, input)` proves membership
and union-role authorization, exposes `context.scope.orgId`, and cannot be
constructed without a permission. Slugs reserve public/system roots. This
keeps tabs and integrations concurrency-safe, makes cache keys tenant-specific,
and makes missing/foreign scope fail closed.

### D002 — Application-enforced tenant isolation

**Accepted.** Every organization row has `orgId NOT NULL` and every
query includes the verified predicate. PostgreSQL RLS is not used because pooled
connections and all three router entry points would need synchronized session
state/policies. The cost is disciplined queries and mandatory tenancy tests.
RLS remains a possible additive backstop if regulation or an incident justifies
the complexity.

### D003 — One dependency-free permission model

**Accepted.** All statements and explicit role grants live in
`packages/auth/src/access.ts`, which imports neither database nor environment.
Server and client share types; client checks remain cosmetic. Role inheritance
is rejected because it hides a role's actual grant surface.

### D004 — Operational audit is fire-and-forget

**Accepted.** Audit records verified denials and selected
sensitive/destructive actions without delaying or failing the source operation.
A future compliance-critical domain may write an audit row inside its own
transaction after a separate decision. Financial journals are already atomic
because ledger drift is not an acceptable availability trade.

### D005 — All stored objects are private

**Accepted.** Storage offers short-lived presigned URLs only;
objects never pass through the app server and the bucket is never anonymously
readable. A database visibility flag cannot secure an object-storage policy.
Revisit only with tenant-isolated buckets or signed CDN enforcement.

### D006 — Invitation-gated accounts; founder-only Organizations

**Accepted.**
Public sign-up is disabled. Operators can create password accounts with Better
Auth's hashing path. Only the account matching `FOUNDING_EMAIL` may create an
Organization; neither owner nor admin role grants that platform capability.
This removes the racy “first user” bootstrap while keeping ordinary membership
invitation inside Organizations.
**MVP without email (2026-09-08).** No email provider is configured, so the
invitation id itself is the proof: native password sign-up succeeds only with a
live invitation id whose email matches the address being registered. Accounts
created this way are unverified. Accepted risk: a member with the invite grant
can create the account for an email they do not own, because mailbox ownership
is never proven. The id is therefore visible only to invite-grant holders.
Trigger to revisit: when a provider exists, add mailbox verification (native
email OTP before password setup, see the research memo) and drop the id-as-proof
rule. The invitation id must be an opaque UUID (`generateId` is UUIDv7).

### D007 — Migrate before application startup

**Accepted.** The runtime image executes the shared database
migrator, under advisory lock, before serving. The bundled app does not locate
or run migrations itself. Rolling releases require old/new schema compatibility
until the old version drains.

### D008 — Request-local membership reuse and server-rendered org pages

**Accepted.** Web
SSR calls the same router in-process. Context resolves the session once and
memoizes each membership only for that request; every endpoint still checks its
permission. The layout loads `member.me`; children prefetch in parallel through
TanStack Query. Base UI popups remain client-only while their SSR store is
unsafe.

### D009 — In-process TTL cache only for derived settings reads

**Accepted.** Settings may be cached briefly for derived reads that
tolerate staleness; writes invalidate the local process. Authorization,
membership, prices frozen into financial documents, and cross-process-sensitive
shell reads remain fresh. Revisit with shared invalidation only after measured
need.

### D010 — Organization-scoped transactional MRN counter

**Accepted.** Patient registration increments a named counter and
inserts the Patient in one transaction. Rollback also rolls back allocation,
and contention is isolated per Organization. MRN is a local display identifier,
not global/national identity.

### D011 — Server verifies references, price, and tax

**Accepted.** Browser ids and amounts are claims. Every referenced
row is re-read under verified tenant scope and Charges snapshot current catalog
facts. Performance may fold verification into `INSERT … SELECT`, adopt composite
tenant foreign keys, or cache safe reference data; it may not trust client
pickers or accept client-authored money.

### D012 — Double-entry journals commit with billing documents

**Accepted.** Invoice, Payment, Advance Receipt, Advance
Allocation, Credit Note, and Refund creation posts an idempotent balanced
journal in the same transaction. The ledger serves
billing-ledger trial balance, balance sheet, and handover; it is not an ERP or
general accounting UI. Deriving every report directly from every document and
fire-and-forget posting were rejected.

### D013 — Care settings are separate destinations and records

**Accepted.** Use one `opd_appointments` record for
scheduled and walk-in OPD. Future Admissions and Emergency Cases own separate
tables and state machines. Money and attachments reference the exact care
record. A generic wrapper returns only after two live settings prove a shared
child/query needs it.

### D014 — Generic AI chat is removed

**Accepted.** A technically secure
free-form chat without an owned hospital workflow, provenance, consent, source
link, or required review is not a product capability. AI returns only as a new
vertical slice whose transport follows its accepted workflow.

### D015 — Normal desk walk-ins settle atomically at creation

**Accepted 2026-08-23.** The pilot desk takes payment before
consultation. A normal walk-in therefore commits its OPD Appointment, token,
known Charges, itemized supply document, Payments, Receipts, and journal entries
as one transaction. The API requires a settlement object. A walk-in either
settles or carries an explicit note; there is no unsettled walk-in path. Online
advances and Emergency use separate policies. Financial state never drives
later clinical state. A walk-in with no configured attendance fee and no selected
service has nothing to settle: it commits only its checked-in appointment and
token and returns no Invoice or Payment. It cannot accept a discount or payment.
Every non-cash collection and refund requires its transaction reference so the
movement can be reconciled; cash does not.

### D016 — OPD records only observable states

**Accepted 2026-08-23; living behavior: [OPD](./opd.md).** OPD keeps only
`booked`, `checked_in`, `cancelled`, and `no_show`. The desk cannot observe when a
consultation starts or ends, so HMS stores no consultation-progress state and
follow-up pricing keys on a prior `checked_in` attendance's `arrivedAt`. Stale
`booked` rows close to `no_show` lazily when a past date is read; there is no
background job. Evidence: the `OPD status mutation` row in the
[research ledger](./research/README.md).

### D017 — Immediate OPD fee omission needs no reason

**Accepted 2026-08-25.** The server auto-adds the configured consultation or follow-up fee to an immediate quote. Reception removes it with `omitConsultFee: boolean`; no reason is required or recorded. The server selects the fee for every complete quote and again inside creation when omission is false. If no billable line remains, the quote returns zero totals and creation commits the checked-in appointment and token without creating a financial document. Selected additional services remain local editable state; their first preview uses the same dependency-free invoice math on the client, while the quote and creation own authoritative server verification and the consultation line.

**Context:** A patient who attends only for a procedure should not enter a fake
discount workflow.

### D018 — Consultation is a normal catalog item at the desk

**Accepted 2026-08-28; living behavior: [OPD](./opd.md).** Consultation is a normal catalog item for intake. `catalog.searchServices` requires the caller to state consultation eligibility explicitly; immediate intake passes true, Later intake passes false. The automatic practitioner and department fee ladder remains the default. `opd.book` still rejects consultation items because check-in has no mechanism to supersede the automatic fee. An OPD Appointment may contain two consultation charges; staff correct a duplicate by voiding it. A picked item keeps `sourceType: "catalog"` because `sourceType` records how the charge came to exist. Its item category sets `revenueCategory`, which records what kind of revenue it is.

**Context:** Practitioner and department default fee items accept any category. A non-consultation default books to that category's revenue account through `revenueAccountFor`. Consultation revenue reporting therefore requires consultation-category defaults.

### D019 — Care settings own separate billing desks

**Accepted 2026-08-29.** OPD, IPD and Emergency each own their operational
billing route and workflow. They share the finance domain's immutable documents,
collection, correction, accounting and authorization rules, but not one universal
checkout screen. OPD remains concrete while it is the only shipped care-setting
billing flow; shared UI or orchestration is extracted only after another shipped
section demonstrates the same state and interaction model. The OPD Billing tab is
the checkout workspace itself rather than a page that opens a second review dialog.

**Context:** Separate desks must be able to work independently, and room stays,
discharge, investigations and emergency care will not converge on one search-and-
checkout layout merely because their final financial documents are alike.

### D020 — Settlement compares an explicit Charge revision

**Accepted 2026-08-29; evidence: [research ledger](./research/README.md#evidence-anchors).**
Each care record owns a monotonically increasing revision of its Charge set.
Every write that changes the Charge set after check-in (a plan posting, a void,
invoice issuance) advances it in the same transaction.
Settlement must match the revision the desk reviewed while holding the care-row
lock, and must separately match the reviewed grand total after trusted repricing.
The revision replaces pending-Charge ID lists and latest-Invoice-ID surrogates.
It is not a generic Billing Account or financial lifecycle state.

**Context:** A row lock serializes two desks but cannot tell whether the second
desk reviewed the newly committed state. Invoice IDs describe child documents,
not the version of the Charge set being settled.

### D021 — Billing paper is server-rendered from immutable source facts

**Accepted 2026-08-30.** One guarded `billing.getInvoice` call supplies a
server-rendered PDF endpoint shared by preview, print, and download. Templates
use Takumi's native semantic HTML/CSS and the stored source-document snapshots,
including each record's Business Date rather than a date re-derived from
`createdAt`. The renderer and its WASM load only through a server-only dynamic
import, and deployment-bundled Latin and Devanagari fonts remove any network
font dependency. Until the pilot accountant approves statutory classification
and fields, the itemized document keeps the neutral label **Invoice**.

**Context:** Client rendering and browser print styles would create a second
data path and environment-dependent paper. Keeping authorization, facts, font
metrics, and pagination on the server makes repeated rendering reproducible
without placing a heavy WASM renderer in browser or ordinary route bundles.

### D022 — Migration history is append-only once a retained database applies it

**Accepted 2026-08-31.** A migration that any retained
database (production, pilot, or a kept local copy) has applied is never edited,
renamed, or squashed; the next schema change is a new migration. A migration no
retained database has applied is still a draft: regenerate it with
`bun run db:generate` rather than stacking a correction on top. Before merging a
regenerated migration, compare it against the target branch's migration list; a
file that exists there is not a draft. A baseline squash of applied history needs
its own decision entry first.

**Context:** A squashed or renamed migration reproduces the old chain's end state
only for empty databases, and Drizzle identifies applied migrations by hash, so
rewriting applied history either replays or silently skips work.

### D024 — An outpatient appointment carries only consultation and procedure charges.

**Accepted 2026-09-01.** `OPD_BILLABLE_CATEGORIES` in
`@hms/db/schema/catalog-items` is the single statement of what staff may pick as
an OPD service. `resolveOpdPricing` refuses selected services outside that set,
so the rule holds for `opd.book`, `opd.createWalkIn` and `opd.quoteWalkIn` alike,
and `catalog.searchServices` offers only the same set. D018's automatic fee
ladder remains category-agnostic. The outpatient billing desk no longer carries
a catalog picker at all: it prices the charges the appointment already has and
issues one invoice for them.

**Context:** Revenue posts to a per-category account (`revenueAccountFor`), so a
lab test attached at the outpatient desk books lab revenue against an OPD
invoice. The ledger stays correct, but the document stops being attributable to
one stream, and the desk becomes the place that decides which stream earned the
money. Lab, radiology and pharmacy bill where the work is ordered, by the domain
that owns it, when those domains ship.

### D025 — One invoice per stream with its own numbering series

**Accepted 2026-09-18.** `invoices.stream` is `opd` or `pharmacy`, and an
invoice carries exactly one typed parent — an OPD Appointment or a Pharmacy
sale — enforced by a check that also matches the parent to the stream. OPD
keeps the counter `invoice:${fy}` with `invoicePrefix`; pharmacy numbers from
`invoice:pharmacy:${fy}` with `pharmacyInvoicePrefix`. Receipts, credit notes
and refunds keep one org-wide series each. Pharmacy prices are tax-inclusive
(MRP) and OPD prices tax-exclusive, so the price basis is a pure function of
the stream rather than a stored column.

**Rejected:** one document per visit split by `revenueCategory` in reporting
only. A pharmacy counter sale has no visit to hang the document on, and a
mixed document cannot carry two tax bases.

**Context:** Numbering runs through `counter`, and issued financial documents
are immutable (`docs/product.md`), so granularity had to be decided before the
first non-OPD invoice existed. See
[Pharmacy counter sale and stock](./specs/pharmacy-counter-sale-and-stock.md).

### D026 — Conditional state writes collapse missing and stale rows into one conflict

**Accepted 2026-09-03.** A tenant-scoped conditional `UPDATE … RETURNING` does
not issue a second existence query when no row matches. Patient compare-and-swap
and appointment state transitions return one `CONFLICT` for a missing, foreign,
stale, or already-moved row. Reads and direct writes still return `NOT_FOUND` for
foreign ids. A command that already needs a pre-read may distinguish the two
without adding a fallback query.

**Context:** The scoped predicate prevents cross-tenant access either way. A
second read only changes the error label, adds latency, and races with another
write; clients recover from the combined conflict by closing stale overlays and
refreshing authoritative state.

### D027 — `catalog_items` is the only billable identity; domain masters link to it

**Accepted 2026-09-03; evidence:
[research ledger](./research/README.md#adopted-findings).** A
billable item is one `catalog_items` row: name, code, category, price, tax,
active. When pharmacy, lab, IPD, or OT open (product roadmap gates), each domain
owns its own master (product and batch, lab test and components, bed type,
package and components) that carries a composite tenant foreign key to its
`catalog_items` row, unique on `(orgId, catalogItemId)` where the link is set.
The link is nullable, because a domain master also holds rows that are never
billed: a pharmacy `products` row with no catalog row is an internal supply
(gloves, soap, cleaning liquid) that is stocked and issued but not sellable, and
every sale and stock-search path joins the catalog row inner, so it cannot be
sold. The domain master owns the display `name` and writes it onto the linked
catalog row in the same transaction, because that row remains the snapshot
source for the Charge. The catalog never
grows a kind column, nullable domain columns, or a details blob, and no second
items table with its own name, price, tax, or invoice type is created. Price
_source_ may be domain-specific (batch MRP, occupancy × rate); the Charge
snapshot remains the single money record, and `charges.sourceType`/`sourceId`
is the extension point. `category` stays the revenue routing key and
`revenueAccountFor` is exhaustive over it, so a new category cannot post to a
fallback account. D025 still owns invoice granularity.

**Context:** Marley/ERPNext (`Item` + linking templates) and Danphe
(`BillServiceItem` + integrated masters) converge on this shape; Danphe's
separate pharmacy item master is the counter-example, forking its invoice,
worklists, and ledger mapping. No domain table is created before its gate opens.

### D028 — Organization currency is immutable

**Accepted 2026-09-04.** An Organization without saved settings uses and may
persist only the application-default currency; an existing Organization keeps
its stored currency. Settings saves may change other fields but never currency.
HMS is a single-currency ledger: Charges, Invoices, payments, corrections,
journal entries, dashboards, and reports store or aggregate amounts without a
per-row currency dimension.

**Context:** Relabeling the Organization after financial rows exist would mix
historical amounts under a new unit in every aggregate and document. “Choose on
first save” is also unsafe because operational work can use the unsaved default
before that save. Supporting configurable or multiple currencies requires an
explicit creation-time choice or money model, conversion policy, and ledger
design; a mutable display setting is not that feature.

### D029 — Insurance, TPA, and corporate credit are never Payment-method values

**Accepted 2026-09-04; evidence: [research ledger](./research/README.md#adopted-findings).** Insurance, TPA, and corporate credit are Payer-domain facts, never `paymentMethod` values. The payer-domain shape the evidence settles posts the Payer share to a separate receivable at Invoice time. That domain remains out of scope until pilot data supports a go/no-go decision.
Cheques are not accepted at the OPD desk and are revisited with the Payer domain, where remittances actually arrive; the spec's [unproven-volume admission](./specs/payment-methods-cheques-and-sponsors.md#validation--evidence) records why.

### D030 — Indexing is denied by response header; the sitemap is the allowlist

**Accepted 2026-09-04.** One
`PUBLIC_PATHS` list (`PUBLIC_ROUTES` plus changelog entries) names every publicly
indexable page. Three mechanisms
follow from it, each with one job:

- **`X-Robots-Tag: noindex, nofollow`** is applied by server middleware to every
  response whose path is not in `PUBLIC_PATHS`. This is the indexing guarantee.
  A header covers redirects and non-HTML responses, which a `<meta>` tag cannot,
  and it is applied centrally so a new private route inherits it.
- **`sitemap.xml`** emits exactly `PUBLIC_PATHS` and nothing else.
- **`robots.txt`** manages crawl budget only. It does not deny by default: it
  disallows the known non-public application prefixes and allows everything
  else, including the static asset directories.

**Context:** A `robots.txt` deny-all with a per-path allowlist fails twice:
`Allow: /` and `Disallow: /` tie in length and RFC 9309 resolves the tie as
allow, and a disallowed page is never fetched, so its `noindex` is never read
while links can still list it. It would also block the `/og/` images social
crawlers need.

The scope of this decision is **URL discoverability, not data security**.
Authentication is the security boundary and is unchanged; every tenant route
already requires a session. What this prevents is an organization's slug and
page titles appearing in public search results.

**Rejected:** generating the sitemap from the route tree minus a blacklist, as
the reference template does. That is correct for a mostly-public site; here
nearly every route is a private tenant page under a customer-chosen
`/$orgSlug`, so a blacklist makes "indexed" the default and a forgotten entry is
a silent regression.

### D031 — Money is `bigint` paise

**Accepted 2026-09-11.** Every money column is Postgres `bigint` paise and all
arithmetic is `bigint`. Inputs and outputs of every procedure are `bigint` too (the
RPC serializer carries it natively); decimal strings exist only where a person
types or reads them: form inputs, PDF cells, and audit meta. The client keeps
bigint literals out of `.tsx` files because the oxc React Compiler rewrites them
to `undefined`; components compare against the imported `ZERO`.
The conversion rescaled rows in place, so it ran as a stop-the-world cutover
instead of D007's rolling release. A change that alters the unit
or meaning of stored money again needs the same treatment: stop every writer,
migrate, and start only code that reads the new unit.

### D033 — A treatment plan item is a quote and may price below catalog

**Accepted 2026-09-15; evidence: [research ledger](./research/README.md#adopted-findings).**
A Treatment plan item snapshots the catalog description, tax facts, revenue
category, planned quantity, and quoted unit price. The catalog price is the
default. A different price requires the item's `note`, the same free-text field
that records which tooth or site the work is for. A delivered Charge uses the
plan price, while the catalog item stays unchanged.

### D034 — Course fees post on delivery

**Accepted 2026-09-15.** A Treatment plan and its items create no Charge,
Invoice, receivable, or revenue. Staff post an item only to a checked-in OPD
Appointment. That action creates the Charge for work delivered at that sitting.
Money received before delivery uses an Advance Receipt and remains a liability.

### D035 — Advance money is a separate document, not a Payment

**Accepted 2026-09-15.** A Payment always belongs to an Invoice. Money received
before an Invoice is an Advance Receipt with its own number and immutable print
snapshot. Applying credit creates an Advance Allocation and moves the amount
from Patient Advances to Patient Receivables. An unused balance is returned by
a linked Refund. Advance refunds use their own procedure and
`billing:advanceRefund` grant; they do not share the credit-note refund
permission boundary. The printed document uses the neutral title **Advance Receipt**
until the pilot chartered accountant approves GST Receipt Voucher particulars.

### D036 — One invalidation: a write ages every query

**Accepted 2026-09-16.** The query
client's `MutationCache` invalidates every query whenever any write succeeds or
fails, and toasts every failure. No mutation invalidates or toasts an error
itself; it adds only its success copy, a field error, or `closeOnConflict`.
The refresh starts before the write's own callbacks and is not awaited: a
callback that navigates reads the fresh data once, and a save spinner never
waits on unrelated refetches. Only mounted queries refetch, so the request count
stays close to a hand-kept key map, while other organizations' cached queries are
merely marked stale.

**Context:** A hand-kept map of which write ages which key drifts. Gating the
refresh on `isMutating() === 1` fails because a mutation stays pending through
its callbacks, so two overlapping writes both skip it. A write that must not
refetch a specific key is the exception that argues for itself.

### D037 — A list keeps its previous rows only while its search changes

**Accepted 2026-09-16.** Search-driven lists use
`placeholderData: keepPreviousData`, so typing never blanks rows that are about
to be replaced. A list whose rows carry actions is keyed by its other inputs (day,
status filter), so changing them remounts it and another queue's rows never
stand in with live controls; the route loader already fetched that key. The first
load of a list still renders nothing, and `/$orgSlug` carries
`remountDeps: ({ params }) => ({ orgSlug })` so previous rows never cross a
tenant boundary.

### D038 — Plan work is identified by its plan item, at posting

**Accepted 2026-09-16.** `treatment.postToVisit` is the only path that creates
plan work. It refuses the same plan item twice on one visit and a quantity above
the plan, and always inserts its own Charge (`sourceType: "treatment_plan"`,
`sourceId` = the item). An ordinary Charge for the same catalog service stays
ordinary: the server cannot tell a second tooth from the same delivery, so it
never adopts, reprices, or refuses because of one. The Clinical panel warns when
the visit already bills that service, and the desk voids or credits the ordinary
Charge if it was this work. A sitting carries its plan link at intake so a plan
with a booked sitting drops off the Follow-ups call sheet.

Completion counts non-voided Charges, so every void goes through
`voidPendingCharges`, which locks the delivering plans and reopens a completed
plan that loses a non-dropped item's delivery.

**Rejected:** matching by catalog item. Refusing on a same-service Charge blocked
two teeth sharing one procedure; adopting the first pending one merged distinct
work and rewrote a price the desk had set.

### D039 — A money command carries a request key

**Superseded 2026-09-19.** For the MVP, the owner accepted removing the request key,
`request_keys` table, `claimRequestKey`, and `pharmacy.sell`'s
`alreadyRecorded` reply were removed. Money and stock commands rely only on row
locks (D040), the Charge revision (D020), and document uniqueness. A retry after
a lost response can record twice; staff resolve it through the normal correction
documents. Revisit replay protection if a client requires it or the pilot records
a duplicate caused by retrying a lost response.

### D040 — Writes serialize with row locks in one documented order

**Accepted 2026-09-16.** Concurrent writes are made safe by the database, not by
application retries: a scoped conditional `UPDATE … RETURNING` where one row
decides the outcome (D026), and `SELECT … FOR UPDATE` where a check spans rows.
Locks are always taken in the order in
[Architecture](./architecture.md#writes-and-concurrency), so two transactions
wait instead of deadlocking. A new write that must lock a record already in that
order takes its place in the order; a new record type is added to it in the same
change. There is no automatic retry loop, advisory-lock manager, or `SERIALIZABLE`
isolation.

**Context:** Two writers that lock the same rows in opposite orders deadlock, and
PostgreSQL resolves it by aborting one, which reaches the desk as a failed save.
A written order makes the check mechanical in review.

### D041 — Stock on hand is the sum of movements

**Accepted 2026-09-18; evidence:
[Pharmacy reference flows](./research/pharmacy-reference-flows.md).** Stock is
held per batch with its expiry, and quantity lives only in an append-only
`stock_movements` ledger keyed by batch and bucket (`shelf | quarantine`) with
a check tying the sign of `qty` to the reason. On hand is `sum(qty)`, read
under the batch lock. Every writer locks its batches `SELECT … FOR UPDATE`
ordered by `(expiryDate, id)`, reads the bucket sums afterwards, and refuses a
bucket that would fall below zero. A goods receipt, ordinary or opening, is the
only source of a new batch; a return goes into quarantine and is released to the
shelf by an adjustment.

**Rejected:** a maintained balance column on the batch (Danphe's shape) before
measurement. A balance that is written by every path is the figure someone
eventually types over, and the sum with a `(orgId, batchId, bucket)` index is
measured on realistic movement history before any projection is added.

### D042 — One migration baseline, and rules live in zod

**Accepted 2026-09-18; evidence:
[Hospital inventory models](./research/hospital-inventory-models.md).** Four
schema choices land with this decision.

**Amended 2026-09-21.** The squash to one baseline that this entry originally
recorded rested on a false premise: production had already applied
`0000_production_baseline` through `0003_windy_omega_red`, so D022 forbade it.
Those four files and their snapshots are reinstated verbatim, and the schema
below lands as `0004_pharmacy_stock`, generated against the `0003` snapshot and
rehearsed on the production dump: the migrator applied only `0004`, the result
matched the squashed baseline column for column, and a second run was a no-op.
A future squash needs a new entry and an empty production, per D022.

**Enum lists leave the database.** Every check of the form `column in ('a',
'b', …)` is removed. Validity of a vocabulary is stated once, by the
`z.enum(CONST)` on the write path, over the same `as const` array that types the
column. The database keeps what zod cannot see: sign and money checks, the
`stock_movements` sign-by-reason rule, cross-column shape checks, unique keys,
and foreign keys. A new value then costs a constant and a deploy, not a
migration, and the two statements of the same list can no longer drift.

**`medications` becomes `products`, with a nullable catalog link.** The table,
the `stock_batches.productId` column, and the API procedures rename. The link
to `catalog_items` is nullable and its unique index is partial, so the store
holds internal supplies beside sellable medicines (D027).

**Opening stock is a goods receipt.** `stock_counts` and `postOpeningCount` are
deleted. `goods_receipts` gains `opening` and a nullable `fileId` for the
retained count sheet, and `supplierName` becomes nullable. `receiveGoods` with
`opening` posts `opening` movements and refuses a batch that already moved,
exactly as the count document did. One receiving path replaces two documents
that shared every line, batch and lock rule.

**An internal issue names its department.** `stock_movements.departmentId` is a
nullable composite foreign key that only reason `internal_issue` sets; the zod
input requires it for that reason and refuses it for every other. Stock that
leaves the store for a ward is answerable to a department before the IPD spec
replaces the interim path with a typed issue.

**Rejected:** keeping the enum checks as a second guard. A check that repeats a
zod enum fails later and worse — after the transaction, as a 500 instead of a
field error — and the pair drifts on the first value someone adds to only one.

### D043 — One list filter idiom across the console

**Accepted 2026-09-19.** Lists filter through `components/list-filter.tsx`: a
filter button inside the search field opening a Base UI menu of submenus and
checkbox items, applied filters as removable chips, and date presets from the
organization's business date with a custom range in a dialog. It replaced the
toggle-pill `FilterGroup`/`FilterSelect`, `report-period-controls.tsx`, and the
`toggle`/`toggle-group` primitives they alone consumed, on every list that had
them (billing, OPD, patients, reports) as well as the three pharmacy
lists. The pharmacy brief said "no new shared components"; this one is accepted
here because the stock list needs product, expiry and bucket at once, a pill
row wraps to two lines on a phone at five options and cannot express
multi-select, and two filter idioms side by side would be the worse outcome.

**Licence:** the owner accepted AGPL-3.0 for the repository. The root licence,
package metadata, README, and application source link state that choice; the
adapted Midday files retain their original copyright notices.

**Rejected:** deferring the migration and giving pharmacy a local control. Two
idioms would drift on the first filter someone adds to only one, and the shared
module is the one place the date preset and business-date rule lives.

### D044 — Exact prices; only a document total rounds

**Accepted 2026-09-23 on the owner's instruction.** A price is paise per N
stock units, stored exactly as printed: batch `mrp`/`mrpUnits`, and Charge and
Invoice-line `unitPrice`/`priceUnits`. No tablet, product, or line price is
rounded. Invoice line subtotals allocate the rounded document subtotal by
largest exact remainder, breaking ties in input order. Pharmacy rounds only
the grand total to the nearest rupee, storing `roundOff` (−49..50 paise) and
posting it to the round-off account. OPD rounds to the paisa (`roundOff = 0`).
A credit note completing a full pharmacy return reverses the invoice
round-off.

Supplier receipt lines store only billed and free quantity, pack size, rate,
discount %, GST %, and HSN; `receiptLineCost` derives their amounts exactly.
Only the bill sum rounds, and it must reconcile to the printed bill total
within ±₹0.99. There is no persisted unit cost: later valuation must use
the exact receipt facts, never a rounded cost per stock unit. D031 still
applies: every stored money column is `bigint` paise.

**Rejected:** flooring or half-up rounding a unit MRP loses the printed
strip price on loose-unit sales; storing fractional-paise numeric amounts
creates a second money representation instead of retaining exact price and
receipt facts.

### D045 — Receive goods without an attachment

**Accepted 2026-09-23 on the owner's instruction; amends D042.** Neither
opening counts nor supplier deliveries attach a signed count sheet or bill
copy. Requiring a document adds friction during cutover, and the uploaded
evidence was not used in the receiving workflow. The `goods_receipts.file_id`
column remains nullable for existing receipts and their retained files;
new receipts leave it null. There is no destructive migration.

### D046 — Medicine-name suggestions assist, not define, the product master

**Accepted 2026-09-23 on the owner's instruction.** Product names retain the
case staff enter, with internal whitespace collapsed; no normalized-name column
is added. The product form warns about likely duplicate names but does not
prevent saving them. Staff can request medicine-name suggestions while typing
and confirm them before copying them into the organization's own product row.
MRP, tax and schedule are never imported.

**Amended 2026-09-24, decided by the agent at the owner's request.**
Suggestions come from two sources queried in parallel by the browser:
Medbuzz's product search (stocked rows only) and Truemeds' search. Results
are merged with names starting with the typed text first (Medbuzz can answer
a brand with its substitutes), then Medbuzz before Truemeds, de-duplicated by
name ignoring case and punctuation, and capped at six. Requests carry only the search text plus fixed request
constants, never tenant or user identity. Web CSP `connect-src` allows
`https://searchapi.medbuzz.in` and `https://nal.tmmumbai.in`.

A suggestion must fill strength, manufacturer and pack, not just a name.
Across 21 names (the pilot's 13 shelf items plus eight mainstream brands),
fully-filled hits were Apollo 0 (its products have no strength field),
Truemeds 6 (mainstream) and Medbuzz 6 (the pilot's LXIR ophthalmic line);
the two useful sets are disjoint
([source comparison](./research/medicine-name-sources.md)). 1mg returned
403 from the production server IP and has no browser CORS access.

**Consequence:** both endpoints are unofficial and can change or block.
Medbuzz's endpoint sits under `/admin/` with an empty ApiKey and no
published terms, and rejects non-browser clients. [Truemeds' terms](https://www.truemeds.in/legal/ispl/terms-and-conditions)
forbid "any automated means ... to access the Website, the information, or
Services for any purpose". This matches the risk class the owner accepted
for 1mg, but the owner has not confirmed it for these sources. Written
permission is needed before commercial launch. If one source fails, the
other still suggests; if both fail, manual entry remains available.
