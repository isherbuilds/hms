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

**Conditional amendment accepted 2026-10-04 (D058):** when controlled downtime
backfill ships, Charges may use tenant-scoped server-retained historical kit
prices/tax or an owner/admin-approved historical price exception with original
tax evidence. Scope, snapshot and approval are rechecked in the effect transaction.
Unsupported historical tax blocks the entry; arbitrary client-authored money is
still rejected. This exception does not change live desk repricing.

### D012 — Double-entry journals commit with billing documents

**Accepted.** Invoice, Payment, Advance Receipt, Advance
Allocation, Credit Note, and Refund creation posts an idempotent balanced
journal in the same transaction. The ledger serves
billing-ledger trial balance, balance sheet, and handover; it is not an ERP or
general accounting UI. Deriving every report directly from every document and
fire-and-forget posting were rejected.

**Conditional amendment accepted 2026-10-04 (D055): when Claims ships,**
remittance cash settlements, TDS adjustments, approved TPA-deduction write-offs,
patient/payer liability transfers and their exact linked reversals also commit
balanced journals atomically with their immutable source documents. Authorisation,
unapproved deductions and Form 26AS reconciliation observations post nothing.
The money journal remains mandatory, distinct from fire-and-forget audit.

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

**Accepted 2026-08-30; classification amended 2026-10-04 under D052.** One guarded `billing.getInvoice` call supplies a
server-rendered PDF endpoint shared by preview, print, and download. Templates
use Takumi's native semantic HTML/CSS and the stored source-document snapshots,
including each record's Business Date rather than a date re-derived from
`createdAt`. The renderer and its WASM load only through a server-only dynamic
import, and deployment-bundled Latin and Devanagari fonts remove any network
font dependency. The issued GSTIN/stream snapshot determines the itemized
document's **Bill of Supply**, **Tax Invoice** or neutral **Invoice** title (D052).

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
and refunds keep one org-wide series each. Until IPD ships, counter Pharmacy
prices are tax-inclusive (MRP), OPD prices tax-exclusive and basis derives from stream.

**Conditional amendment accepted 2026-10-04 (D056): when IPD ships,**
add stream `ipd` with exactly one typed Admission parent, counter
`invoice:ipd:${fy}` and `ipdInvoicePrefix`. Replace stream-derived price basis
with `priceBasis: exclusive | inclusive` snapshots on every Charge/Invoice line;
backfill existing OPD/pharmacy bases and migrate all math, preview, credit and
paper consumers in one cutover. One Admission bill may contain both bases;
gross totals sum line gross, with taxable/exempt amounts and price bases clearly
separated on paper. Basis is arithmetic, not an exemption decision. IPD round-off
is zero; D044 exact price units and counter-Pharmacy rounding remain unchanged.
Evidence and supply-classification rules: [D056](#d056--calendar-checkout-segmented-occupancy-and-an-ipd-financial-desk).

**Rejected:** a universal visit parent or splitting documents by revenue category
only. A counter Pharmacy sale has no visit; a future Admission uses its own typed
parent and line-basis snapshots rather than pretending all streams share a tax basis.

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

### D027 — Services own catalog identity; goods own sale facts

**Accepted 2026-09-03; amended 2026-09-29 on the owner's instruction;
evidence: [research ledger](./research/README.md#adopted-findings).**
`catalog_items` holds services only (consultation, procedure, lab, radiology,
other); a database CHECK excludes pharmacy. A service Charge links to its
tenant-scoped catalog row. Stocked goods live in `products`, which own their
`sold`, GST rate, HSN code and `active` facts. An internal supply is not sold;
counter selection requires both `sold` and `active`. Batch MRP supplies the
pharmacy price, not a zero-priced copied catalog row.

A pharmacy Charge has `catalogItemId = null`, `sourceType = pharmacy_batch`,
`stockBatchId` referencing its batch by `(orgId, stockBatchId)`, and a null
`sourceId`. The Charge remains the single description, quantity, price, tax
and revenue-category snapshot; OPD and pharmacy retain one Invoice path.
`SERVICE_CATEGORIES` type the catalog, while
`REVENUE_CATEGORIES` include pharmacy and make `revenueAccountFor` exhaustive
without a fallback. No second invoice or accounting path is needed (D025).
There is no data backfill migration: the pilot had no production data, and
production migration is handled manually by the owner.

**Conditional amendment accepted 2026-10-04 (D056): when IPD ships,**
Admission Charges use `sourceType = admission`, `sourceId = admissionId` and
typed bed-review/package/issue-line references with matching Admission parents.
Services retain catalog identity; medicines retain null catalog and a tenant-scoped
batch reference. Counter-sale `pharmacy_batch`/null-source-id rules stay intact.
The same Invoice/accounting path prices both care settings; this does not copy
Product GST into exempt composite inpatient care without supply classification.

**Context:** The catalog copy duplicated Product names and tax facts without
providing a service identity for stock goods. Keeping goods separate from
services removes the synchronization and join while preserving the Charge
snapshot and batch trace.

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

**Accepted 2026-09-04; conditionally amended 2026-10-04 by D055; evidence: [research ledger](./research/README.md#adopted-findings), [Frappe/Marley Claim](https://marleyhealth.io/wiki/insurance-claim) and [Payor accounts](https://marleyhealth.io/docs/v16/user/manual/en/healthcare/patient-insurance/insurance-payor).** Insurance, TPA and corporate credit are Payer-domain facts, never `paymentMethod` values. When Claims ships under the real paying-hospital/insured-volume or signed-payer gate, the accepted [Claims contract](./specs/cashless-claims.md) posts payer share to its distinct receivable at Invoice time and later resolves actual cash, TDS and approved deductions through immutable sources. Its design is accepted now, not awaiting CA/owner approval; until that release Sponsor stays measurement-only and patient-only IPD is self-pay only. Four actual Payment methods remain unchanged; this amendment neither claims the market gate is met nor authorizes cheque acceptance.
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

### D033 — A treatment plan item quotes a course and may price below catalog

**Accepted 2026-09-15; evidence: [research ledger](./research/README.md#adopted-findings).**
A Treatment plan item snapshots the catalog description, tax facts, revenue
category, whole-course `quotedPrice`, and estimated sitting count. The catalog
price is the default course price. A different price requires the item's `note`,
the same free-text field that records which tooth or site the work is for.
Delivered Charges use that quote; the catalog item stays unchanged.

### D034 — Course fees post on delivery

**Accepted 2026-09-15.** A Treatment plan and its items create no Charge,
Invoice, receivable, or revenue. Staff post an item only to a checked-in OPD
Appointment. That action creates the Charge for work delivered at that sitting.
For one-fee multi-sitting services, delivery is measured by per-sitting
proportionate completion (D053); there is no partial-work item or wait for the
whole course to finish.
Money received before delivery uses an Advance Receipt and remains a liability.

### D035 — Advance money is a separate document, not a Payment

**Accepted 2026-09-15; print particulars amended 2026-10-04 under D052.** A Payment always belongs to an Invoice. Money received
before an Invoice is an Advance Receipt with its own number and immutable print
snapshot. Applying credit creates an Advance Allocation and moves the amount
from Patient Advances to Patient Receivables. An unused balance is returned by
a linked Refund. Advance refunds use their own procedure and
`billing:advanceRefund` grant; they do not share the credit-note refund
permission boundary. The printed document is **Receipt Voucher** with Rule 50
particulars when the issued snapshot has the Organization's GSTIN, and
**Advance Receipt** without it (D052); no accountant approval is pending.

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
plan work. It refuses a plan item already posted to this visit or whose full
price was already posted, and always inserts its own Charge (`sourceType: "treatment_plan"`,
`sourceId` = the item). An ordinary Charge for the same catalog service stays
ordinary: the server cannot tell a second tooth from the same delivery, so it
never adopts, reprices, or refuses because of one. The Clinical panel warns when
the visit already bills that service, and the desk voids or credits the ordinary
Charge if it was this work. A sitting carries its plan link at intake so a plan
with a booked sitting drops off the Follow-ups call sheet.

Completion uses non-voided Charges less linked Credit Note taxable values
(D051). Every void goes through `voidPendingCharges`, which locks the delivering
plans and reopens a completed plan that loses a non-dropped item's posted work.
Credit issuance similarly locks plan items and plans before the Invoice, then
reopens a completed plan if a non-dropped priced item is no longer fully posted.
The Invoice and invoiced Charge remain immutable.

**Rejected:** matching by catalog item. Refusing on a same-service Charge blocked
two teeth sharing one procedure; adopting the first pending one merged distinct
work and rewrote a price the desk had set.

### D039 — Money commands have no replay protection

**Accepted 2026-09-19; conditionally amended 2026-10-04 under D058/D059.**
Ordinary money and stock commands have no replay protection: the removed
`request_keys`/`claimRequestKey` infrastructure stays removed. Row locks (D040),
Charge revision (D020) and document uniqueness do not prove a lost response
failed; staff investigate and use normal correction documents for duplicates.

The exhaustive exceptions, effective only when their workflows ship, are:

- **Downtime backfill (D058):** one allocated tenant-scoped paper slip is the
  durable identity, locked before domain resources; canonical server-validated
  payload, all effects and immutable provenance commit atomically.
- **Onboarding/opening stock (D059):** identity is Organization + entity type +
  source namespace + source key; reviewed canonical digests, source links and
  domain effects/opening receipts commit atomically under run/source locks.

Identical committed payload returns original ids without counters, money or
stock effects; changed payload conflicts instead of overwriting. Both exceptions
require tenant/effect permissions, validated source evidence and documented
D040 lock ordering. Neither adds automatic financial retry, generic request
keys or replay protection to ordinary desk commands.

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

**`medications` becomes `products`.** The table, the
`stock_batches.productId` column, and the API procedures rename. Products
hold both internal supplies and sellable medicines; their sale facts are owned
by Product (D027).

**Opening stock is a goods receipt.** `stock_counts` and `postOpeningCount` are
deleted. `goods_receipts` gains `opening`, and `supplierName` becomes nullable.
`receiveGoods` with `opening` posts `opening` movements and refuses a batch that
already moved, exactly as the count document did. One receiving path replaces
two documents that shared every line, batch and lock rule. The count-sheet
attachment was subsequently removed by D045 and D049.

**An internal issue names its department.** `stock_movements.departmentId` is a
nullable composite foreign key that only reason `internal_issue` sets; the zod
input requires it for that reason and refuses it for every other.
**Conditional amendment accepted 2026-10-04 (D056): when IPD ships,**
patient-specific ward dispensing uses typed Admission issue/return records,
batch movements and pending Admission Charges, never the interim department-only
issue or a counter Invoice. Unrelated ward/department consumption retains
`internal_issue` and its department; it is not converted into a patient sale.
This preserves D042's vocabulary/zod and append-only migration rules.

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

**Accepted 2026-09-23 on the owner's instruction; restored 2026-09-29 by D049.**
Prices are paise per `priceUnits` stock units, as printed. Invoice subtotals
round once at the document level; line subtotals take floors and receive
remaining paise by largest remainder, breaking ties in input order. Pharmacy
rounds only the grand total to the nearest rupee, storing `roundOff` (−49..50
paise) and posting it to the round-off account. OPD rounds to the paisa
(`roundOff = 0`). A credit note completing a full pharmacy return reverses
the invoice round-off.

Supplier receipt lines store billed and free stock-unit quantity, printed rate
per `packSize` stock units, discount %, GST % and HSN; `receiptLineCost`
derives their amounts exactly. Only the bill sum
rounds, and it must reconcile to the printed bill total within ±₹0.99. There
is no persisted unit cost: later valuation must use the exact receipt facts,
never a rounded cost per stock unit. D031 still applies: every stored money
column is `bigint` paise.

**Rejected:** storing fractional-paise numeric amounts creates a second money
representation instead of retaining exact price and receipt facts.

### D045 — Receive goods without an attachment

**Accepted 2026-09-23 on the owner's instruction; amends D042.** Neither
opening counts nor supplier deliveries attach a signed count sheet or bill
copy. Requiring a document adds friction during cutover, and the uploaded
evidence was not used in the receiving workflow. The `goods_receipts.fileId`
column was removed by D049: no pharmacy receipts existed in production.

### D046 — Medicine-name suggestions assist, not define, the product master

**Accepted 2026-09-23 on the owner's instruction.** Product names retain the
case staff enter, with internal whitespace collapsed; no normalized-name column
is added. The product form warns about likely duplicate names but does not
prevent saving them. Staff can request medicine-name suggestions while typing
and confirm them before copying them into the organization's own product row.
MRP, tax and schedule are never imported **from medicine-name suggestions**.

**Conditional amendment accepted 2026-10-04 (D059):** hospital-authorized,
operator-confirmed onboarding templates may supply explicit GST, schedule and
printed MRP after source/domain validation and reviewed commit. This is trusted
hospital source-entry, not third-party suggestion ingestion; the latter still
cannot define price, tax or legal schedule. D049 price-unit rules remain unchanged.

**Amended 2026-09-24, decided by the agent at the owner's request.**
Suggestions come from two sources queried in parallel by the browser:
Medbuzz's product search (stocked rows only) and Truemeds' search. Results
are merged with names starting with the typed text first (Medbuzz can answer
a brand with its substitutes), then Medbuzz before Truemeds, de-duplicated by
name ignoring case and punctuation, and capped at six. Each lookup has a
four-second limit. Requests carry search text, fixed request constants, and
the browser's site origin, never tenant or user identity. The web response uses
`Referrer-Policy: no-referrer` so the org route is not sent. Web CSP `connect-src` allows
`https://searchapi.medbuzz.in` and `https://nal.tmmumbai.in`.

A suggestion must fill strength, manufacturer and pack, not just a name.
Across 21 names (the pilot's 13 shelf items plus eight mainstream brands),
fully-filled hits were Apollo 0 (its products have no strength field),
Truemeds 6 (mainstream) and Medbuzz 6 (the pilot's LXIR ophthalmic line);
the two useful sets are disjoint
([source comparison](./research/medicine-name-sources.md)). 1mg returned
403 from the production server IP and has no browser CORS access.

Amended by D049.

**Consequence:** both endpoints are unofficial and can change or block.
Medbuzz's endpoint sits under `/admin/` with an empty ApiKey and no
published terms, and rejects non-browser clients. [Truemeds' terms](https://www.truemeds.in/legal/ispl/terms-and-conditions)
forbid "any automated means ... to access the Website, the information, or
Services for any purpose". This matches the risk class the owner accepted
for 1mg, but the owner has not confirmed it for these sources. Written
permission is needed before commercial launch. If one source fails, the
other still suggests; if both fail, manual entry remains available.

### D047 — A course is priced once and split across estimated sittings

**Accepted 2026-09-24 on the owner's instruction; amends D033 and D038.**
The pilot entered a ₹7,000 denture as unit price × 4 and quoted ₹28,000.
An item instead quotes the whole course. Each posted sitting bills the unbilled
price divided across the estimated sittings left, rounded to the nearest ₹100
(to the rupee below ₹1,000, so a ₹150 session stays exact) and the last
estimated sitting takes the exact rest; once the estimate is used up,
the next post bills all that remains. The desk may bill a sitting at another
amount, up to the unbilled price, such as a round figure or the whole balance to
finish early; the split then re-divides what remains. The
sitting count is an estimate, never a posting limit. A plan completes when
every non-dropped priced item has its full price posted, net of linked Credit Note
taxable values (D051). Credits restore that amount to unbilled work, not the
sitting count; a later checked-in sitting may bill it again. A free item still
needs one posted sitting before completion. This per-sitting allocation is the
proportionate-completion earning milestone (D053).

Patients pay at will. A sitting's Invoice may stay outstanding with a recorded
reason; money for later sittings is taken separately as an Advance Receipt
tagged to the plan, which settlement spends on that plan's Invoices first. The
OPD Billing tab shows the plan total and posted amount beside the existing
Invoice and Advance actions. There is no separate plan account or collection
balance: an Invoice can include tax and non-plan services.

Existing rows migrate by multiplying unit price by planned quantity
(`0007_treatment_item_sittings.sql` and `0008_treatment_course_price_data.sql`).
This changes the meaning of stored money,
so D031 requires a stop-the-world cutover.

**Amended 2026-09-24 on the owner's instruction:** a plan's advance is offered by
default only on that plan's Invoices, and settlement spends another plan's advance
after untagged credit. A dental advance paying a same-day dermatology consult was
unexpected at the desk.

**Rejected:** billing the whole course at the first sitting books revenue
before delivery (D034); an editable sitting count with floor rules adds more
logic than the desk needs.

### D048 — Catalog items have no code

**Accepted 2026-09-26 on the owner's instruction.** `catalog_items.code` is
dropped (`0009_drop_catalog_item_code.sql`). Services and pharmacy products are
found and shown by name; practitioners never had a code. Staff had to invent and
check a unique code for every item, and nothing downstream (Charges, Invoices,
the Billing Ledger) used it. Pharmacy search matches name, generic name, or batch
number; an internal supply is marked by `products.sold = false` (D027).

**Rejected:** keeping it optional — an unused column still shows up in forms,
lists, and search, which is the confusion being removed.

### D049 — Count products in smallest units, retain printed pack prices

**Accepted 2026-09-29 on the owner's instruction; restores D044 and amends D046.**
A Product counts, receives, sells and returns whole quantities of its smallest
`stockUnit`. Its required `unitsPerPack` is at least one; one means no conversion.
The optional `pack` is printed text (for example, "170 ml"), never a divisor.
`stockUnit` and `unitsPerPack` freeze once a batch exists; a different strip size
requires a new Product. Staff can receive five strips of ten as 50 tablets,
sell four tablets, and return loose tablets to quarantine against that sale.

Prices stay in paise per N stock units as printed: batch `mrp` / `mrpUnits`,
supplier receipt `rate` / `packSize`, and Charge and Invoice-line `unitPrice` /
`priceUnits`. A pack-priced supplier bill requires a billed quantity divisible
by the pack size; opening stock can include loose units. A batch's first
printed price representation stays, and later receipts compare exact price
ratios rather than rounded unit prices. Invoice lines follow D044's exact
subtotal and largest-remainder allocation; OPD prices retain `priceUnits = 1`.
A pharmacy Charge has a tenant-scoped composite foreign key to its batch through
`stockBatchId`, with `sourceId = null`; a database CHECK enforces the pharmacy
source, parent and batch pairing. The pilot database has no data to backfill.

**Conditional amendment accepted 2026-10-04 (D056): when IPD ships,**
source/parent/batch CHECKs also admit the typed Admission issue described in
D027, with `sourceType = admission`, `sourceId = admissionId` and the exact issue
line/batch pair. Counter-sale null-source-id pairing is unchanged. Whole smallest
stock units, frozen pack conversions and printed price units remain unchanged;
per-line price basis from D025 does not round medicine unit prices.

### D050 — Edernal Care brand and green accent

**Accepted 2026-09-30 on the owner's instruction; living rules: [Design](./design.md#5-colour).**
The product is renamed from HMS to Edernal Care. Its green `--brand` accent is
`oklch(0.532 0.141 132)` in light and `oklch(0.782 0.144 161)` in dark. Paired with
the Edernal Care wordmark, it marks identity and emphasis only, never state:
settled or clear remains `--clinical-clear`. Primary actions stay ink
(`--primary`); keyboard focus stays neutral (`--ring` and `--sidebar-ring`).

The public site keeps the Edernal Care mockup’s visual direction with concise
product copy. The footer uses verified product and contact links, with no unverified external
company affiliation or company-address placeholder. Secondary public pages
omit the repeated demo banner. Empty careers, customer and status pages redirect
to About or Contact and are not listed in the sitemap. Access is invite-only;
pricing presents Clinics, Hospitals and Large hospitals cards, each invite-only with
contact-based pricing. The cards use the shared WhatsApp link, with the phone
number below them. Public contact links use `lib/contact.ts`. The pocket section shows
real mobile dashboard captures in light and dark themes.

On 2 October 2026 the owner explicitly retained the existing landing animations,
role-stack layout and planned IPD/lab presentation for the invite-only product.
The 4 October browser correction retains that deck where its full content fits:
desktop widths of at least 1024 px and viewport heights of at least 900 px.
Smaller/shorter viewports and reduced motion use the same cards as a
natural-height stack; their forms and bill rows must remain readable rather
than be clipped by the pinned stage ([WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
This presentation decision does not expand the implemented product scope.

### D051 — Credited plan work returns to the unbilled balance

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [Odoo credit notes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/credit_notes.html), [Odoo 17 sales-line computation](https://github.com/odoo/odoo/blob/17.0/addons/sale/models/sale_order_line.py#L762-L826), [ERPNext Credit Note](https://docs.frappe.io/erpnext/credit-note), [ERPNext Sales Order](https://docs.frappe.io/erpnext/sales-order), and [ERPNext v15 linked-order billed update](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/doctype/sales_invoice/sales_invoice.py#L233-L250).**

A plan item's posted amount is the sum of its non-voided Charge prices less the
sum of Credit Note line **taxable values (pre-GST)** against those Charges,
linked through the immutable Invoice line's `chargeId`. Plan quotes exclude GST,
so a credit's GST and document round-off never become unbilled course price.
An Invoice discount is not itself a Credit Note and is not restored as unbilled.
The credited taxable value returns to the item's unbilled balance; a later
checked-in sitting bills it through `treatment.postToVisit`, including **Other
amount**, bounded by that remainder. The original visit still counts as a
posted sitting and cannot post the same item again.

Credit issuance locks the affected plan items and plans before the Invoice
(D040), then recomputes net posting after inserting the credit. A completed
plan reopens, clearing `completedAt`, when a non-dropped priced item falls below
its full price. Closed plans and dropped items are not reactivated. Charges keep
their invoiced status; Invoices and Charges are not rewritten, and a free item
still completes after one posted sitting.

This follows Odoo's linked sale-line refund subtraction from `qty_invoiced`
and resulting `qty_to_invoice`/“to invoice” status, without adopting quantity
returns for clinical work. ERPNext's linked return can reduce Sales Order
`billed_amt`/`per_billed` when **Update Billed Amount in Sales Order** is enabled
([implementation guard](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/doctype/sales_invoice/sales_invoice.py#L472-L479));
that is the rebillable-order precedent, not a claim that every ERPNext credit
automatically reopens an order. Financial correction must reach the plan read
model instead of leaving its full-price completion stale.

### D053 — Multi-sitting services earn by proportionate completion

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [ICAI AS 9 §7.1(i) and §12](https://resource.cdn.icai.org/69237asb55316-as9.pdf) and [ICAI's quotation of Ind AS 115 §35(a)](https://www.icai.org/post/implementation-of-ind-as-115-revenue-from-contracts-with-customers-in-context-of-real-estate-sector-20-07-2018).**

The earning milestone for a one-fee multi-sitting procedure is per-sitting
proportionate completion. D047 already implements it: the whole-course quote
is allocated across delivered sittings, **Other amount** records a different
delivered share, and early completion posts the remaining balance. No
partial-work catalog item and no completion-only posting are introduced.
Advance money remains a liability until applied to an issued Invoice (D035).

AS 9 permits multi-act service recognition by contract value, number of acts,
or another suitable measure of each act's performance; §12 requires relating
recognition to work accomplished. Ind AS 115's over-time criterion applies when
the customer receives and consumes benefit as performance occurs. We choose
that pattern for these treatment sittings rather than treating the final act
as the only earned service. Payment timing is not the earning milestone.
Reports continue to expose document-date net billed revenue; this does not
create an independent clinical-earnings or financial-statement reporting engine.

### D060 — Supplier bills need tax-aware non-stock adjustments

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [17 populated B2B invoice observations](./research/supplier-bill-reconciliation.md#invoice-observation-set), [Zestica's freight-bearing invoice](https://5.imimg.com/data5/SELLER/Doc/2021/8/HV/TY/AJ/7201880/allopathic-pcd-pharma-franchise-in-vaishali.pdf), [Iconic's packing/forwarding invoice](https://www.scribd.com/document/495160322/ATUL), [CGST Act ss15–17](https://cbic-gst.gov.in/hindi/CGST-bill-e.html), [CBIC Circular 92/11/2019-GST](https://cbic-gst.gov.in/pdf/circular-cgst-92.pdf), [ICAI AS 2 paras 6–7](https://resource.cdn.icai.org/69232asb55316-as2.pdf), [ERPNext landed costs](https://docs.frappe.io/erpnext/landed-cost-voucher), and [PSPCL's enacted 206C(1H) withdrawal circular](https://docs.pspcl.in/docs/dycaoaar20250404111604606.pdf).**

Stock-line net sum ±₹0.99 was the original receiving validator, not a universal
purchase-bill model. Fifteen inspected invoices fit; two contain separately
taxed non-stock freight/packing that do not fit stock lines alone. Public uploads do not establish
authenticity or prevalence among the pilot's suppliers. Line CD and scheme
summaries already included in line discounts/free quantities are not deducted
again; blank/zero CN and TCS fields are not evidence of actual offsets.

The shipped receiving extension records reasoned, signed non-stock acquisition
charges/current-invoice discounts with their separately printed GST, and
separately typed settlement credits or evidenced historical TCS. Payable is
stock-line net plus explicit adjustments plus a residual bounded to ±99
paise; never auto-plug a mismatch or invent a stock Product for freight.
Ordered adjustment rows have a tenant-composite receipt link; the header
stores explicit `billRoundOff`. Opening counts refuse adjustments. Signs,
reasons, supporting references and the historical-TCS date are validated;
exact pre-round consideration and payable cannot be negative.
Acquisition amounts alone enter future cost allocation, by affected lines'
post-discount taxable value and across billed plus scheme-free units.
Settlement offsets, unrelated prior CNs and income-tax credits do not enter
current inventory cost. None changes MRP, batch price or selling price.

Eligible recoverable purchase GST for taxable pharmacy supply is excluded
from inventory cost; nonrecoverable/blocked/exempt-use GST is included and
common use requires statutory apportionment. A receipt is not proof of ITC
eligibility, and this extension does not itself implement tax claims,
supplier accounting or valuation. Historic 206C(1H) collection is not
calculated on new bills: the enacted proviso stops its application from
1-Apr-2025. A supplier's accumulated outstanding balance is not this bill's
payable.

**Rejected:** one untyped signed adjustment allocated entirely to cost —
tax-bearing freight loses its tax facts and a prior credit/tax collection can
inflate or reduce the wrong stock. The
[implemented receiving contract](./research/supplier-bill-reconciliation.md#implemented-receiving-contract)
owns its fields, validation and acceptance cases. The first 10–20 consecutive
actual pilot supplier bills
remain a real operational validation gate, not a CA/owner decision gate.

### D055 — Evidenced cashless liability, TDS assets and approved deductions

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [Frappe/Marley v16 Claims](https://marleyhealth.io/wiki/insurance-claim), [Payor receivable/loss accounts](https://marleyhealth.io/docs/v16/user/manual/en/healthcare/patient-insurance/insurance-payor), [CBDT Circular 8/2009 under s.194J](https://www.incometaxindia.gov.in/w/8/2009-circular-no.-8/2009-dated-24-11-2009), [Form 26AS reconciliation](https://www.incometax.gov.in/iec/foportal/help/e-filing-manage-tax-credit-mismatch-faq), [ICAI AS 9 §9.3](https://resource.cdn.icai.org/27275asb-as-9.pdf), [IRDAI 2024 Master Circular](https://irdai.gov.in/document-detail?documentId=4942918), [NHA package rules](https://nha.gov.in/strapi/uploads/User_guidelines_for_HBP_2_2_6d2bc0412a.pdf), [Rule 6F](https://www.incometaxindia.gov.in/w/rule-6f), [CGST §36](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html), and [NMC §1.3](https://nmc.org.in/storage/cms/Ethics-Regulations-2002.pdf).**

The [Claims contract](./specs/cashless-claims.md) is the accepted future payer
domain, conditionally amending D029/D012 when Claims ships, not a Payment-method
extension. One immutable supply Invoice separates patient/payer receivables.
Cash alone produces Payments/Receipts. Evidenced TDS debits a TDS Receivable asset
and credits payer debt at settlement, reconciled to Form 16A/26AS without a second
posting; missing tax credit stays a deductor follow-up. Legacy s.194J/Rule 6F
citations supply the requested provenance; store the law applicable on the actual
settlement/tax year rather than freezing pre-2026 section numbers or rates.

Known contractual tariff reductions price the original bill correctly; later
overbilling uses a line-linked payer Credit Note. Policy-permitted non-payables
are patient liability before final discharge billing review, never a later
invented obligation. PM-JAY included care and insurer-delay charges cannot be
transferred to Patient. Unexplained short-payment remains disputed until
owner/admin approves loss; accountant then debits **TPA deductions expense**
and credits payer debt through an immutable approved adjustment. Revenue/GST
do not change for TDS, transfers or collection losses. Tax-bearing Credit Notes
reduce output GST only within CGST §15/§34 conditions; financial-only credits
otherwise leave output GST unchanged. Refunds return actual cash to its original
remitter under source caps, not TDS or payer money to Patient.

Existing roles suffice: reception manages requests, cashier allocates/collects,
accountant settles/reconciles/adjusts under evidence and existing
`billing:creditNote` authority; owner/admin configure and approve loss.
Unused-advance refunds retain `billing:advanceRefund`. Grants remain only in
`access.ts`; small facilities combine existing roles, not a new claims superuser.
Insurer pre-auth/discharge clocks start at evidenced receipt, one/three hours
under the 2024 circular, not the 2016 regulations or a bank-payment promise.

Retain financial Claim evidence for the longest applicable floor: Rule 6F's
six years after relevant assessment-year end, CGST's 72 months after annual-return
due date, and longer operative entity/state/scheme requirements. Indoor clinical
records have NMC's three-year minimum, not a universal state-law maximum; evidence
supporting a Claim follows the longer financial period. Open debt/proceedings
stay on hold (including CGST's one-year-after-disposal extension). Private,
append-only correction and authorized export do not authorize source deletion.

The only unresolved gate is real adoption: paying hospital/named desk owner
and meaningful measured insured volume or signed payer requirement with actual
contracts. IPD is a delivery dependency, not an undecided architecture.
No consultation is required to decide this policy; citations cannot create demand.

### D056 — Calendar checkout, segmented occupancy and an IPD financial desk

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [ERPNext Inpatient Record](https://frappehealth.com/docs/v13/user/manual/en/healthcare/inpatient_record), [billable Service Unit Type](https://frappehealth.com/docs/v13/user/manual/en/healthcare/healthcare_service_unit_type), [Inpatient ADT](https://frappehealth.com/docs/v13/user/manual/en/healthcare/inpatient_adt), [Bahmni/OpenMRS-backed ADT](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/114923665/Admit,+Discharge+and+Transfer+Patients), [Odoo third-party hospital module](https://apps.odoo.com/apps/modules/17.0/cerevantix_health_care_management), [NHA package inclusions/special cases](https://nha.gov.in/strapi/uploads/User_guidelines_for_HBP_2_2_6d2bc0412a.pdf), [ICAI AS 9 delivery recognition](https://resource.cdn.icai.org/27275asb-as-9.pdf), [CBIC inpatient healthcare clarification](https://cbic-gst.gov.in/pdf/circularno-32-cgst.pdf), [taxable-room exception](https://gstcouncil.gov.in/sites/default/files/2024-05/03_2022-ctr-eng_1.pdf), and [NMC paper-record duties](https://nmc.org.in/storage/cms/Ethics-Regulations-2002.pdf).**

The [IPD contract](./specs/ipd-admission-to-discharge.md) and its Admission/public
command seams are accepted. Retail bed billing uses calendar checkout,
configurable prospectively by owner/admin, default noon and minimum one day:
first window ends at checkout on the calendar date after admission, later
windows checkout-to-checkout; exact-boundary departure starts no new day.
Transfers split a window's one day by actual segment occupancy, weighted by
each snapshotted daily tariff, apportioned to paise deterministically. No
highest-transfer tariff or duplicate full-day charges. This is our chosen policy,
not an Indian statutory rule or a claim that the reference systems use this
exact formula; those references establish occupancy/movement traceability.

Packages post once on delivery with explicit included/extra quantities and
real stock trace; deposits remain liabilities. Actual payer/state package rules
override retail assumptions, including PM-JAY special-case payment and prohibition
on duplicate beneficiary collection. Arithmetic `priceBasis` is per line;
tax follows actual composite/independent supply, not MRP, payer or stream alone.
Accept **D025, D027, D042 and D049** amendments in place **when IPD ships**:
typed Admission parent/numbering and mixed bases; services distinct from
batch goods; typed patient issues instead of interim department issues;
unchanged whole stock units and printed exact price representations.
Do not claim those schema/caller changes have shipped.

Self-pay IPD may precede Claims only for self-pay Admissions. Measured cashless
volume/signed paid scope determines whether IPD+Claims must release together;
Sponsor is never an insurer Payment or proof of transferred debt. Clinical
discharge releases beds independently of billing/collection and exposes unbilled
departures. Paper clinicians/nurses own chart/MAR/discharge summary and signed
handoff; pharmacy issue is not administration, reception records movement,
and billing reconciles delivered sources. No unowned nursing/doctor role or claim
of full digital EMR.

Only real adoption remains blocked: paying hospital, named operational owner
and evidenced product-gate handoff/cutover with baseline and measured insured
volume. Design/accounting approval is not a remaining CA/owner question.
Reference features and autonomous acceptance do not replace a paying hospital
or real pilot observations.

### D054 — Revenue control separates posting-period sales, cash and current balances

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [ERPNext Sales Register and ledger reports](https://docs.frappe.io/erpnext/accounting-reports), [Accounts Receivable](https://docs.frappe.io/erpnext/accounts-receivable-and-payable), [Credit Note](https://docs.frappe.io/erpnext/credit-note), [Gross Profit](https://docs.frappe.io/erpnext/sales-analytics), [Tally correction-period Credit Notes](https://help.tallysolutions.com/sales-return-using-credit-note/), [voucher numbering methods](https://help.tallysolutions.com/use-voucher-numbering-methods/), [Sales Register](https://help.tallysolutions.com/how-to-work-with-sales-register-in-tallyprime/), [Marg expiry report](https://care.margcompusoft.com/margerp/expiry-stock/109499/1/how-to-view-expiry-stock-report-in-marg-erp-software), [MRP versus purchase-rate screen](https://care.margcompusoft.com/userfiles/CareImg070620190101479.png), [Bahmni billing and accounting](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32604217/Patient+Billing+and+Accounting), and [ICAI AS 2](https://resource.cdn.icai.org/27269asb-as-2.pdf).**

Credit Notes net billed revenue in their own Business Date/posting period,
including credits to older Invoices; Refunds affect cash, not revenue again.
The issue-date Invoice Register shows all linked movements visible when generated,
labelled **Invoices issued in period; balances now**, with the generation instant.
Two correction bridges explain its difference from event-period revenue.
Month/year handover ties event-period Invoice/Credit Note net sales excluding
GST, receipts/advances less Refunds, GST outward values and source-linked
billing-journal Trial Balance separately. HMS's partial books are not final accounts.
Statutory document classification, real issuer/GST registration and bounded
financial numbering belong to D052; reports preserve the issued full number.

Tally receives one Sales voucher per Invoice and one Credit Note voucher per
credit, retaining the full HMS number as voucher number and bill-wise reference.
Dedicated HMS types use **Manual** numbering with duplicate prevention; any
automatic-type migration uses **Retain Original Voucher No.** and proves supplied
numbers survive import. Period-summary sales and automatic renumbering lose
document-level reconciliation and are rejected. This is the handover contract,
not an implemented Tally adapter.

The billing lead performs daily close using the existing `accountant` role, or
`admin` when also running the billing desk; the owner reviews unexplained
differences. No new role or grant is introduced. Pharmacy explicitly linked to
OPD uses **linked attendance attribution**, not prescriber earnings; unlinked
sales remain unassigned. Earning department means the service owner, not the
attendance department or cashier desk: a future dimension increment snapshots
it on issued lines and revenue postings, with credits inheriting the original
dimension and legacy missing snapshots remaining unassigned.
[ERPNext Cost Centers](https://docs.frappe.io/erpnext/cost-center) establish the
line/posting dimension precedent. For future IPD, the admitting/primary consultant
is the default; authorized reassignment requires actor, old/new Practitioner and
reason in a sensitive audit. Issue-time attribution freezes on the Invoice,
credits inherit it, and reassignment changes later issues only.
[Marley Inpatient Record](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/inpatient_record)
establishes admission-order practitioner linkage, not a doctor-payout policy.

MRP exposure is sufficient for the operational expiry panel and is labelled
**not purchase cost or inventory valuation**. Costing is no prerequisite to this
panel. A separate inventory-accounting increment uses lower of cost and NRV
under AS 2; we select weighted-average cost for interchangeable goods from its
permitted formulas. Receipt cost is net of discounts, excludes recoverable GST,
includes non-recoverable tax and attributable acquisition costs, and spreads
across billed plus free units. Opening cost requires incumbent-book evidence;
missing cost is unknown, never zero. Expired goods have no ordinary sale NRV;
documented supplier recovery is assessed separately. No inventory journals are
authorized by an MRP exposure report.

Hospital billing coverage uses an independently reconciled, owner-entered
external denominator with matched scope/date basis, including exempt healthcare
and taxable pharmacy once and excluding GST/advances. Unknown/zero denominator
means unavailable, not 100%; it remains an external workbook figure, not an app
write model, because HMS cannot observe unrecorded desks. The
[revenue-control spec](./specs/revenue-control.md) is Ready-for-implementation
without a CA or discovery approval gate. No interviews or real-month evidence
are claimed. Daily adoption, actual issuer identity, an independently measured
denominator and the paying-hospital/signed-IPD-flow gate remain real-world
requirements, not facts manufactured by this decision.

### D057 — Fifteen-minute joint recovery with Indian immutable backups

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [pgBackRest](https://pgbackrest.org/user-guide.html), [AWS Indian regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html), [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), [age](https://github.com/FiloSottile/age#usage), [Healthchecks](https://healthchecks.io/docs/), [DPDP Act ss.8/16](https://egazette.gov.in/WriteReadData/2023/248045.pdf), [Rules 2025 rr.1/6–8](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf), [CGST s.36](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html), and [Income-tax Rule 6F](https://www.incometaxindia.gov.in/w/rule-6f).**

For a continuously staffed 10–50 bed pilot, accept joint RPO ≤15 minutes and
RTO ≤4 hours. Reject a daily quiesced dump as the sole strategy: losing a staffed
day's work is not an acceptable engineering trade. Use daily pgBackRest fulls,
continuous WAL and five-minute off-host joint manifests with exact immutable
ready-file coverage; WAL alone cannot recover missing prescription bytes.

Use a separate-account private AWS S3 ap-south-1 Mumbai bucket with versioning,
36-day COMPLIANCE Object Lock and a dependency-aware 35-day recovery window.
Pin actual version ids/hashes and retain full/WAL/object dependencies; latest
keys/delete markers are not immutable recovery evidence. Host systemd services
and timers survive Coolify app replacement. Neither the tool nor timers are
claimed installed. Founder and Designated Operations Operator are distinct
recovery/key custodians, with separately held age identities; Healthchecks
dead-man alerts reach both off-app with no hospital data in pings.

DPDP is not a universal India-localisation mandate; India is our conservative
storage contract and satisfies CERT-In's explicit Indian-log location rule.
The spec owns category clocks: CGST 72 months from annual-return due date with
proceeding extensions; applicable medical-profession Rule 6F six years after
assessment-year end; conservative seven-year clinical policy with longer
applicable holds/requirements; one-year necessary processing/security evidence,
and finite disaster copies separate from statutory archives. Rule 6F is an
Income-tax obligation, not Information Technology Act s.44AA. Actual applicable
tax-year/successor law controls, not permanently frozen predecessor numbering.

The operator reports covered CERT-In incidents within six hours, immediately
informs the hospital and preserves evidence; the hospital remains Data Fiduciary
for DPDP s.8(6) intimation. Implement future-phase r.7 without-delay Patient/Board
notice and 72-hour detailed Board deadline, with effective-date labels, not
permission to wait. Owner-only free export and the erasure/hold matrix are
accepted; D004 remains best-effort audit. The
[data-safety spec](./specs/data-safety-backup-restore-export.md) is implementation
authority, not a security certification. Production bucket/IAM/keys/host access,
contacts and real timed restore evidence remain external operator prerequisites.

### D058 — Controlled paper, manual statutory books and traceable backfill

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [NABH patient-safety principles](https://dev.nabh.co/wp-content/uploads/2025/07/23.-Entry-Level-Standards-for-Hospital.pdf), [AHRQ hospital downtime research](https://digital.ahrq.gov/sites/default/files/docs/citation/r21hs024350-wernz-final-report-2018.pdf), [Bahmni Outreach offline architecture](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3238625296/Bahmni+Outreach+App+for+Community+Healthcare+Offline+ready), [CGST Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), [Rule 49](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule49_v1.00.html), [ICAI AS 9](https://indasaccess.icai.org/Volume-III/AS/asb.html?a=110), and [AS 5](https://indasaccess.icai.org/Volume-III/AS/asb.html?a=108).**

Controlled paper is the routine bridge for ≤4 staffed hours; escalation starts
at outage declaration. Backfill/reconciliation finishes within four staffed
hours after restoration and before next-shift final sign-off, with every slip
accounted for and no unexplained money/duplicate effects. This is our risk
ceiling, not a NABH statutory SLA or measured hospital acceptance. Longer
outages invoke the hospital's prolonged-contingency policy; clinical/emergency
care is not stopped because the billing kit expires.

Require distinct pre-numbered manual Bill of Supply/Tax Invoice and money-receipt
series, each governed by its actual classification and financial year. Internal
DT slips alone are not statutory documents. Multiple series are permitted by
Rules 46/49; a Receipt is not a supply invoice. Digital re-entry is dated when
recorded, with immutable original manual number/date and supply/collection time;
it is not a second statutory issuance or collection. A 31 March event recorded
1 April gets a new-year digital number, an old-year original-time supplement and
an explicit tax/accounting bridge, never a counter rewrite or doubled revenue.
Actual supply/performance controls financial reporting, not computer-entry delay.

Accept conditional D011 historical-price verification and D039 slip-based atomic
replay exceptions in place; reject general client pricing/offline write retries.
Managed encrypted terminals, short-lived dated references, locked paper custody,
90-day PHI-free observations and D057 statutory evidence retention are accepted.
Shift Lead, Finance Reconciliation Lead and Duty Pharmacist resolve their named
exceptions before sign-off; unsupported identity/tax/stock cannot be guessed.
The [outage spec](./specs/outage-continuity.md) can be implemented now. Actual
hospital books/roster/drill access and residual 14+14-day observations remain
external evidence, particularly before considering a PWA or synchronized writes.

### D059 — Reserved assisted-import authority and fresh searchable identity

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [OpenMRS typed Patient identifiers](https://docs.openmrs.org/doc-1.8/org/openmrs/PatientIdentifier.html), [Bahmni/OpenMRS ID Gen](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2850849/Patient+Identifier), [current HMS explicit grants](../packages/auth/src/access.ts), and [CGST retained source records](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html).**

Accept conditional D039 source-row/opening-receipt atomic replay and D046
hospital-authorized tax/schedule/MRP entry in place. No general replay
infrastructure or vendor-suggestion tax import returns. Accept reserved
`onboarding_operator` with only `onboarding:manage` and shell `member:read`,
outside assignable ORG_ROLES, provisioned/revoked by deployment operator for
an authorized named Organization. All ordinary RPC and Better Auth
membership/invitation/union-role paths must prevent grant or manipulation of
protected memberships before release; current access.ts does not yet implement
that role. Founder-only Organization creation and scoped grants are unchanged.

Always issue a fresh transactional Organization MRN; preserve a confirmed
source-namespaced legacy identifier, searchable with normal `patient:read`.
Leading zeros survive; ambiguity blocks linking, never proves person identity.
This borrows OpenMRS's typed-identifier separation without importing old counters
or building a generic identifier platform. Old finances remain read-only in
the legacy HMS/lossless retained archive; no old Invoice, debt, Advance or fake
balancing journal migrates. A named legacy-accounting owner handles unresolved
obligations; this core import is not whole-hospital financial replacement.

Accept bounded templates/runbook as falsifiable targets; medicine mappings are
tenant-local unless an actual written hospital permission and any required
third-party licence authorize a sanitized reusable release. The
[onboarding spec](./specs/onboarding-import.md) has no remaining owner/CA design
question, but stays blocked on **an unrelated hospital's real authorized sample
export/count sheets, approvers and representative rehearsal**. A policy choice
cannot manufacture that consent, timed success, paying demand or IPD/claims
migration scope.

### D052 — GST registration determines document particulars and bounded numbering

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [CGST Act §§23, 31(3)(c)–(d), 16–17](https://cbic-gst.gov.in/pdf/CGST-Act-2017-amended-01012022.pdf), [CGST Rules 46, 49, 50 and 53](https://cbic-gst.gov.in/pdf/24092021-CGST-Rules-2017-Part-A-Rules.pdf), [Notification 12/2017-Central Tax (Rate), entry 74 and definition 2(zg)](https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification12-CGST.pdf), [Legal Metrology packaged-commodity rules](https://bombayhighcourt.gov.in/bhc/libweb/legislation/rulec/LegalMetrologyPackagedCommoditiesRules%2C2011.pdf), [official GST retail-price guidance](https://cgsthyderabadzone.gov.in/pages/faq/gstratesfaqs/1624gstratesfaq.pdf), [ICAI AS 2 §7](https://indasaccess.icai.org/Volume-III/AS/asb.html?a=105), and [Marg's item/HSN/MRP and CGST/SGST invoice fields](https://care.margcompusoft.com/margerp/gui-format/117346/1/null).**

The Organization's explicit **GSTIN**, not its generic PAN/tax-id field,
determines new document classification. Registered exempt healthcare in the
OPD stream prints **Bill of Supply**; retail pharmacy prints **Tax Invoice**;
an advance for future healthcare prints **Receipt Voucher**. Without GSTIN,
the titles remain **Invoice** and **Advance Receipt**, without a statutory
GST-document or tax-collection claim: separate tax rates/amounts and the
CGST/SGST summary are omitted, while issued gross amounts remain unchanged.
Exempt-only establishments need not register
under §23; a configured GSTIN does not itself prove the establishment's actual
registration or make a cosmetic service exempt. The supported OPD stream is
qualifying healthcare, not taxable cosmetic treatment.

Issuance snapshots GSTIN, local place-of-supply state/code, supplier name and
address, and configured pharmacy Form 20/21 licence numbers. Later settings
changes never reclassify old papers, and migration leaves old snapshots blank
rather than inventing historic registration. Registered supplier settings need
name/address, a valid matching GST state code, and an April financial year.
Registered OPD Bills of Supply and Receipt Vouchers require the patient's
address; a nonzero OPD GST amount is refused instead of mislabelling a taxed
bill as exempt. The Receipt Voucher prints serial/date, recipient name/address,
service description and purpose, advance amount, **Exempt** rate/nil tax,
state name/code, **Reverse charge: No**, and an authorised-signatory line.
The desk signs the issued paper; the line is not a digital signature.
Credit Notes retain their title, original document number/date, recipient
address, value/rate/tax correction and signatory line.

The existing pilot model is local, in-person B2C care/counter supply using the
Organization's own registration and CGST/SGST split, not a separate pharmacy
GSTIN or an inter-state/B2B invoicing engine. MRP is inclusive of GST on every
pharmacy line; tax is extracted, never added again. A4 and thermal print the
rate-wise taxable value and CGST/SGST footer, following Marg's familiar
retail presentation without copying its invoice implementation.

Every financial `documentNumber` series, including payment receipts, advances,
Credit Notes and the fixed `RF` refund prefix, uses only letters, digits,
hyphen and slash, with a full serial of at most 16 characters. Settings permit
at most four prefix characters: four + the longest seven-character FY label

- slash + four sequence digits = 16, reserving at least 9,999 issues per
  series/FY. Shorter prefixes have more capacity (e.g. `INV2026-27/99999`).
  The actual generated serial is checked again, including a positive safe
  integer sequence, and overflow aborts issuance; it never truncates or silently
  renumbers. Existing org/FY counters and document uniqueness indexes retain
  the uniqueness guarantee.

Eligible pharmacy purchase GST is input tax credit, not inventory cost;
nonrecoverable tax (including exempt-care use and the appropriate shared-input
restriction/reversal under §17) remains cost. AS 2 excludes subsequently
recoverable taxes. Current goods receipts retain pre-tax rate and GST
separately, and their GST-inclusive line sum reconciles the supplier payable;
that sum is not an inventory valuation or an ITC journal. This decision does
not build purchasing valuation/accounts or claim ITC has been posted.

No CA/owner classification approval remains. Actual issuer registration,
licence validity, signed papers, physical printer legibility and a real pilot
accounting handover remain operational evidence, not facts this decision can
manufacture.

### D061 — Pharmacy counter operating rules and truthful return scope

**Accepted 2026-10-04 on the owner's instruction (autonomous decision, no CA/owner consultation); evidence: [ERPNext material issue](https://docs.frappe.io/erpnext/stock-entry), [purchase receipt](https://docs.frappe.io/erpnext/purchase-receipt), [sales return](https://docs.frappe.io/erpnext/sales-return), [Marg multi-unit billing](https://care.margcompusoft.com/margerp/inventory/2001/1/null), [Drugs Rules 1945, Rule 65](https://cdsco.gov.in/opencms/opencms/en/Acts-and-rules/Drugs-Rules/) ([searchable text](https://indiankanoon.org/doc/147665881/)), and [CGST Act §34](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html).**

The counter and department consumption share the movement-ledger stock.
Department-only consumption uses reason-coded `internal_issue`; patient-specific
ward dispensing moves to Admission issues when IPD ships (D056). Supplier
deliveries retain the printed bill, batch, billed/free quantities, rate,
discount, GST and MRP; retain the original chronological purchase bills with
supplier address/licence and manufacturer particulars required by Rule 65.
Pack conversion follows D049, not an inferred number in printed pack text.

Schedule H/H1 supply requires a valid prescription and registered-pharmacist
supervision. Schedule H1 also requires a separate contemporaneous register
containing prescriber name/address, patient name, drug and quantity, retained
three years. HMS's names/reference fields are not that register: the paper
register and prescription records remain mandatory. Schedule X is neither
received for retail sale nor sold through this counter. Loose supply is under
registered-pharmacist supervision with Rule 65(19)'s labelled wrapper.

The pharmacy uses its Organization's actual legal entity/registration and its
own invoice series, with D052's document and licence rules. No guessed GSTIN
or second entity is created. Available patient-linked advance may pay a counter
sale; an anonymous buyer cannot consume a patient's balance.

The supported counter correction is a quantity return against the original
invoice, with returned goods entering quarantine and money derived from that
line's immutable amounts. Generic money-only pharmacy credit notes remain
explicitly refused. This is a product-scope choice, **not** a claim that §34
forbids value-only credit: ERPNext expressly supports credits without stock
movement. HMS does not offer that separate workflow; staff must never invent
returned goods or a stock adjustment to obtain a financial correction. A
value-only correction needs a separately authorised accounting workflow before
it is recorded in HMS. The decision closes the design question without
claiming that an unsupported operation has been implemented.

These operating rules need no further owner/CA answer. Actual licences,
registered staff, a named pilot operator, signed workflow acceptance, retained
statutory records and pilot-month usage remain external go-live evidence.

### D062 — Public search access, founder-owned contact and engineering-reviewed legal drafts

**Accepted 2026-10-04 on the owner's instruction, autonomously; engineering
compliance review, not legal advice or counsel publication approval.**

**Crawler policy:** preserve D030's search crawl rules, sitemap and central
`X-Robots-Tag` boundary. Add a separate deny-all group for `GPTBot`, `CCBot`,
`Google-Extended`, `ClaudeBot`, the legacy precautionary `anthropic-ai` token,
`Applebot-Extended`, `Bytespider` and `meta-externalagent`. Search/social
discovery remains allowed; do not create a deny-all wildcard or add `llms.txt`.
Robots is a voluntary prospective preference, not authentication, a guarantee
of obedience or removal of previously collected material.

Vendor documentation reviewed:

- [OpenAI](https://developers.openai.com/api/docs/bots): GPTBot collects for
  model training; OAI-SearchBot is independently controlled search. Block only
  GPTBot, leaving search/user retrieval under the existing wildcard rules.
- [Common Crawl](https://commoncrawl.org/ccbot): CCBot creates a publicly reusable
  crawl dataset and documents `Disallow: /`. Opt out of that dataset, rather
  than claiming Common Crawl itself is a model-training service.
- [Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended):
  Google-Extended governs Gemini training **and grounding**, not Google Search
  inclusion/ranking. Accept losing that grounding while keeping Googlebot search.
- [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler):
  ClaudeBot may collect training content; Claude-SearchBot and Claude-User have
  separate purposes and remain allowed. The current document names ClaudeBot,
  not `anthropic-ai`; the latter is a precautionary legacy opt-out, not a claim
  that Anthropic currently documents that token.
- [Apple](https://support.apple.com/en-us/119829): Applebot-Extended opts out of
  foundation-model training without excluding Applebot search.
- [ByteDance/Toutiao](https://zhanzhang.toutiao.com/docs/intro/26899) (rendered
  in a browser) identifies Bytespider as a **search** crawler; its
  [robots matching document](https://zhanzhang.toutiao.com/docs/intro/520)
  describes platform rules. The vendor material read does **not** establish
  training use or promise Bytespider robots obedience. Deny Bytespider as an
  explicit conservative exception to the search-allow policy; do not label its
  training use as verified.
- [Meta](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers):
  Meta-ExternalAgent includes foundation-model training. Block that agent, not
  FacebookExternalHit link previews or Meta-WebIndexer search.
- [Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers):
  PerplexityBot is search and explicitly not used for AI-foundation-model
  crawling. **Allow it**; Perplexity-User is user-directed retrieval, not training.

**Contact:** `support@edernal.com` is the fixed single public inbox for demos,
support, privacy grievances and security reports, answered by the founder
(the actual `FOUNDING_EMAIL` holder). Acknowledge within **48 hours**, resolve
grievances within **one month**; this is not an emergency/24-hour clinical
service and never postpones incident deadlines. Marketing and legal pages use
`lib/contact.ts`; retire the configurable `VITE_CONTACT_EMAIL` build argument.
Optional phone/WhatsApp shares that ownership. `VITE_WHATSAPP_NUMBER` is an
operator Coolify **web-build** value: absent/empty hides those links, while email
remains available. No real number, inbox delivery or production deployment is
asserted from repository evidence.

**Concrete legal-copy corrections:**

1. `/privacy` distinguishes our website-enquiry/log purposes from the hospital's
   patient/staff fiduciary role; itemises data/purposes, requires the hospital's
   own pre-collection notice/consent and chosen-language notice, and gives an
   email/same-channel withdrawal route and consequences. Adds access/sharing
   summary, correction/completion/update/erasure, nomination, identity/authority
   particulars and grievance-before-Board complaint procedure; does not invent
   an operational Board portal. Explains registered Consent Managers and states
   we are not one and have no integrated service.
   Sources: [DPDP Act ss.5–6, 8, 11–14](https://egazette.gov.in/WriteReadData/2023/248045.pdf),
   [final Rules rr.3–4, 9, 14](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
2. Replaces the absolute “no sharing” promise with contracted infrastructure,
   instructed operator support, channel-provider and legally required disclosure
   limits; explains purpose/hold-based retention, one-year resolved-enquiry
   policy, residual backup expiry and transfer restrictions. Does not claim
   that a production host has been verified.
   Sources: [SPDI rr.4–7 (gazette text)](https://prsindia.org/files/bills_acts/bills_parliament/2011/IT_Rules_2011.pdf),
   [DPDP ss.8(7), 16](https://egazette.gov.in/WriteReadData/2023/248045.pdf), final Rules rr.6, 8, 15.
3. All public legal/contact pages identify the founder-owned grievance channel
   and response window. `/terms` preserves mandatory consumer/privacy remedies,
   describes invite-only negotiated fees/cancellation/refunds instead of
   invented prices, and no longer treats report exports as full exit.
   [SPDI r5(9)](https://prsindia.org/files/bills_acts/bills_parliament/2011/IT_Rules_2011.pdf)
   requires the actual officer **name** and contact and resolution within one month;
   [Consumer Protection (E-Commerce) Rules 2020 rr.4(2), 4(4)–(5)](<https://thc.nic.in/Central%20Governmental%20Rules/Consumer%20Protection%20(E-Commerce)%20Rules,%202020.pdf>)
   require entity/contact particulars and officer name/designation/contact,
   48-hour acknowledgement and one-month redress where applicable. We adopt
   that stricter window without declaring a blanket B2B exemption.
4. `/privacy` and `/security` separate processor notification from fiduciary
   affected-person/Board notices; adopt without-delay initial notice and 72-hour
   detailed Board facts/extension, with breach contents and contact. Label DPDP
   substantive duties as future-phase (scheduled **13 May 2027**), not current.
   Sources: DPDP s8(6), final Rules rr.1, 7 and the
   [commencement notification](https://egazette.gov.in/WriteReadData/2025/267647.pdf).
   Consent Manager registration has a separate one-year phase; our notice does
   not assert registration today.
5. `/security` states six-hour CERT-In reporting, Indian ICT logs for ≥180 days,
   synchronised clocks and registered incident contact as **operator duties**,
   not automatically installed features. Application guards/certification absence
   do not establish comprehensive IT Act s43A/SPDI r8 compliance.
   Sources: [CERT-In directions (i)–(iv), Annexure I](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf),
   [SPDI r8 under IT Act s43A](https://prsindia.org/files/bills_acts/bills_parliament/2011/IT_Rules_2011.pdf).

**Remaining gate:** counsel's approval of these explicitly labelled drafts
before publication. That review must verify the real operator identity/address
and founder's public grievance-officer **name/contact**, contract applicability
and actual operating evidence; the repo only supplies a development founding
account, not a verified public identity. Role wording is not claimed to satisfy
the statutory officer-name requirement. No further crawler/contact design
decision is pending. The optional production number and production controls
remain external deployment evidence, not decisions this agent can manufacture.
