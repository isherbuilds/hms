# Decision log

This compact log preserves architectural rationale without one file per choice.
Living behavior belongs in [Product](./product.md) or
[Architecture](./architecture.md). Add a new numbered entry only for a choice
that is expensive to reverse; mark later changes as superseding rather than
silently rewriting history.

## Current decisions

### D001 — Explicit per-request tenant claim

**Accepted; consolidates 0001, 0002, 0009–0011, 0015, and 0025.** Organization
scope is immutable `orgSlug` in root URLs and typed procedure input, never
session state or a fallback. `orgProcedure(permission, input)` proves membership
and union-role authorization, exposes `context.scope.orgId`, and cannot be
constructed without a permission. Slugs reserve public/system roots. This
keeps tabs and integrations concurrency-safe, makes cache keys tenant-specific,
and makes missing/foreign scope fail closed.

### D002 — Application-enforced tenant isolation

**Accepted; former 0008.** Every organization row has `orgId NOT NULL` and every
query includes the verified predicate. PostgreSQL RLS is not used because pooled
connections and all three router entry points would need synchronized session
state/policies. The cost is disciplined queries and mandatory tenancy tests.
RLS remains a possible additive backstop if regulation or an incident justifies
the complexity.

### D003 — One dependency-free permission model

**Accepted; former 0004.** All statements and explicit role grants live in
`packages/auth/src/access.ts`, which imports neither database nor environment.
Server and client share types; client checks remain cosmetic. Role inheritance
is rejected because it hides a role's actual grant surface.

### D004 — Operational audit is fire-and-forget

**Accepted; former 0005.** Audit records verified denials and selected
sensitive/destructive actions without delaying or failing the source operation.
A future compliance-critical domain may write an audit row inside its own
transaction after a separate decision. Financial journals are already atomic
because ledger drift is not an acceptable availability trade.

### D005 — All stored objects are private

**Accepted; former 0006.** Storage offers short-lived presigned URLs only;
objects never pass through the app server and the bucket is never anonymously
readable. A database visibility flag cannot secure an object-storage policy.
Revisit only with tenant-isolated buckets or signed CDN enforcement.

### D006 — Invitation-gated accounts; founder-only Organizations

**Accepted; consolidates 0013–0014; supersedes invite-only bootstrap 0007.**
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

**Accepted; former 0012.** The runtime image executes the shared database
migrator, under advisory lock, before serving. The bundled app does not locate
or run migrations itself. Rolling releases require old/new schema compatibility
until the old version drains.

### D008 — Request-local membership reuse and server-rendered org pages

**Accepted; consolidates 0009 and 0021; supersedes client-rendered 0003.** Web
SSR calls the same router in-process. Context resolves the session once and
memoizes each membership only for that request; every endpoint still checks its
permission. The layout loads `member.me`; children prefetch in parallel through
TanStack Query. Base UI popups remain client-only while their SSR store is
unsafe.

### D009 — In-process TTL cache only for derived settings reads

**Accepted; former 0016.** Settings may be cached briefly for derived reads that
tolerate staleness; writes invalidate the local process. Authorization,
membership, prices frozen into financial documents, and cross-process-sensitive
shell reads remain fresh. Revisit with shared invalidation only after measured
need.

### D010 — Organization-scoped transactional MRN counter

**Accepted; former 0018.** Patient registration increments a named counter and
inserts the Patient in one transaction. Rollback also rolls back allocation,
and contention is isolated per Organization. MRN is a local display identifier,
not global/national identity.

### D011 — Server verifies references, price, and tax

**Accepted; former 0019.** Browser ids and amounts are claims. Every referenced
row is re-read under verified tenant scope and Charges snapshot current catalog
facts. Performance may fold verification into `INSERT … SELECT`, adopt composite
tenant foreign keys, or cache safe reference data; it may not trust client
pickers or accept client-authored money.

### D012 — Double-entry journals commit with billing documents

**Accepted; former 0020.** Invoice, Payment, Credit Note, and Refund creation
posts an idempotent balanced journal in the same transaction. The ledger serves
billing-ledger trial balance, balance sheet, and handover; it is not an ERP or
general accounting UI. Deriving every report directly from every document and
fire-and-forget posting were rejected.

### D013 — Care settings are separate destinations and records

**Accepted in final form by 0026; supersedes the shared Clinical Encounter and
Billing Account models in 0022–0023.** Use one `opd_appointments` record for
scheduled and walk-in OPD. Future Admissions and Emergency Cases own separate
tables and state machines. Money and attachments reference the exact care
record. A generic wrapper returns only after two live settings prove a shared
child/query needs it.

### D014 — Generic AI chat is removed

**Accepted by 0024; supersedes streaming exception 0017.** A technically secure
free-form chat without an owned hospital workflow, provenance, consent, source
link, or required review is not a product capability. AI returns only as a new
vertical slice whose transport follows its accepted workflow.

### D015 — Normal desk walk-ins settle atomically at creation

**Accepted 2026-08-23; former 0027.** The pilot desk takes payment before
consultation. A normal walk-in therefore commits its OPD Appointment, token,
known Charges, itemized supply document, Payments, Receipts, and journal entries
as one transaction. The API requires a settlement object. A walk-in either
settles or carries an explicit note; there is no unsettled walk-in path. Online
advances and Emergency use separate policies. Financial state never drives
later clinical state. A walk-in with no configured attendance fee and no selected
service has nothing to settle: it commits only its checked-in appointment and
token and returns no Invoice or Payment. It cannot accept a discount or payment.
Non-zero UPI and card collections and refunds require their transaction
reference so the movement can be reconciled; cash does not.

### D016 — OPD records only observable states

**Accepted 2026-08-23; living behavior: [OPD](./opd.md).** OPD keeps only `booked`, `checked_in`, `cancelled`, and `no_show`. `in_consult`, `completed`, and `left_unseen` are removed outright with no compatibility alias, and staff copy is **Checked In**, **Cancelled**, **No show**.
Removed router procedures are `startConsultation`, `complete`, and `markLeftUnseen`; `opd.queue` and `opd.appointments` are removed and replaced by `opd.day`.
Columns `consultationStartedAt`, `completedAt`, and `leftUnseenAt` are dropped. Follow-up pricing keys on a prior `checked_in` attendance's `arrivedAt` and does not use completion.
Stale `booked` rows close to `no_show` lazily when a past date is read. No background job is introduced.
The reference memo's conclusion is preserved in the ledger row `OPD status mutation` in
`docs/research/README.md`.

### D017 — Immediate OPD fee omission needs no reason

**Accepted 2026-08-25; amended 2026-08-25.** The server auto-adds the configured consultation or follow-up fee to an immediate quote. Reception removes it with `omitConsultFee: boolean`; no reason is required or recorded. The server selects the fee for every complete quote and again inside creation when omission is false. If no billable line remains, the quote returns zero totals and creation commits the checked-in appointment and token without creating a financial document. Selected additional services remain local editable state; their first preview uses the same dependency-free invoice math on the client, while the quote and creation own authoritative server verification and the consultation line.

_D018 amends this decision. It removes the desk-side catalog exclusion but keeps this automatic fee ladder and omission contract._

**Context:** A patient who attends only for a procedure, lab, or x-ray should not enter a fake discount workflow.

### D018 — Consultation is a normal catalog item at the desk

**Accepted 2026-08-28; amended by D024; living behavior: [OPD](./opd.md).** Consultation is a normal catalog item for intake. `catalog.searchServices` requires the caller to state consultation eligibility explicitly; immediate intake passes true, Later intake passes false. The consultation gates are removed from `billing.addChargesTx` and walk-in service resolution in `opd.ts`. The automatic practitioner and department fee ladder remains the default. `opd.book` still rejects consultation items because check-in has no mechanism to supersede the automatic fee. An OPD Appointment may contain two consultation charges; staff correct a duplicate by voiding it. A picked item keeps `sourceType: "catalog"` because `sourceType` records how the charge came to exist. Its item category sets `revenueCategory`, which records what kind of revenue it is.

_The functions named above were removed on 2026-09-03: `billing.settleCharges` no longer accepts lines, and walk-in pricing is `resolveOpdPricing`. The consultation contract is unchanged._

**Context:** Practitioner and department default fee items accept any category. A non-consultation default books to that category's revenue account through `revenueAccountFor`. Consultation revenue reporting therefore requires consultation-category defaults.

_D024 removed the billing desk's own catalog picker, so "Billing passes true" no longer describes a shipped caller. Intake remains the only one._

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
Post-check-in desk additions, manual voids, and invoice issuance advance it in
the same transaction.
Settlement must match the revision the desk reviewed while holding the care-row
lock, and must separately match the reviewed grand total after trusted repricing.
The revision replaces pending-Charge ID lists and latest-Invoice-ID surrogates.
It is not a generic Billing Account, a payment idempotency key, or financial
lifecycle state.

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

### D022 — Pre-pilot migration baseline is disposable; history is append-only afterward.

**Accepted 2026-08-31.** The migration history was squashed to a single
regenerated baseline (`0000_overrated_pandemic`) folding in the billing
`business_date` columns and `charge_revision`. This is safe because no
environment has deployed the old journal: the repository has no CI/CD pipeline
or deployment manifests, production hardening and pilot readiness are open
work, and the product is pre-pilot. The prior migrations (including the
hand-authored business-date backfill) remain recoverable from git history.
Every existing local database must be reset (`bun run db:seed -- --reset` or
drop and recreate); the replayed baseline fails loudly on existing relations
rather than drifting. From the first environment that retains data onward,
migration history is append-only — a baseline squash requires a recorded
disposition here first.

**Context:** A squashed baseline reproduces the old chain's end state only for
empty databases; the deleted backfill has no replacement path for pre-existing
rows.

### D023 — Lost-response retries of payments and corrections are accepted.

**Accepted 2026-08-31; revisited and kept 2026-09-03.** `recordPayments`,
`issueCreditNote`, `recordRefund`, `settleCharges`, and `createWalkIn` mint
fresh IDs per request and bound only cumulative totals, so a client retry after
a lost response can record a duplicate movement while headroom remains. D020's
charge revision is deliberately not a payment idempotency key. The pre-pilot
revisit compared Bahmni, Danphe, and Marley/ERPNext
([research](./research/reference-financial-integrity-and-catalog.md)): none
carries a client operation key; their guards are the numbering lock and journal
uniqueness HMS already has. A client-supplied operation ID is therefore not
built. Reopen only on an observed duplicate in the pilot's cash reconciliation.

**Context:** Mutations do not auto-retry; the exposure is a human resubmitting
after a network failure, and the day-close report plus SOP is the detection path.

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

### D025 — Invoice granularity is one document per appointment, and that is a decision to revisit before lab or pharmacy ships. **Open.**

**Raised 2026-09-01.** `billing.settleCharges` issues one invoice per
appointment, mixing every revenue category on it. D024 keeps that honest today
by allowing only one stream onto an outpatient visit. When a second billing
domain arrives the choice is: keep one document per visit and split by
`revenueCategory` in reporting only, or issue one document per stream with its
own numbering series.

**Context:** Numbering runs through `counter`, and issued financial documents are
immutable (`docs/product.md`), so changing granularity afterwards means
migrating documents the product promises never to rewrite. Decide before the
first non-OPD invoice exists, not after.

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
[research](./research/reference-financial-integrity-and-catalog.md).** A
billable item is one `catalog_items` row: name, code, category, price, tax,
active. When pharmacy, lab, IPD, or OT open (product roadmap gates), each domain
owns its own master (drug and batch, lab test and components, bed type, package
and components) that carries a required composite tenant foreign key to its
`catalog_items` row, unique on `(orgId, catalogItemId)`. The catalog never
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

**Accepted 2026-09-04; evidence: [research memo](./research/reference-payment-methods-and-payers.md).** Insurance, TPA, and corporate credit are Payer-domain facts, never `paymentMethod` values. The payer-domain shape the evidence settles posts the Payer share to a separate receivable at Invoice time. That domain remains out of scope until pilot data supports a go/no-go decision.
Cheques are not accepted at the OPD desk and are revisited with the Payer domain, where remittances actually arrive; the spec's [unproven-volume admission](./specs/payment-methods-cheques-and-sponsors.md#validation--evidence) records why.

### D030 — Indexing is denied by response header; the sitemap is the allowlist

**Accepted 2026-09-04; amended the same day before implementation.** One
`PUBLIC_ROUTES` constant lists every publicly indexable page. Three mechanisms
follow from it, each with one job:

- **`X-Robots-Tag: noindex, nofollow`** is applied by server middleware to every
  response whose path is not in `PUBLIC_ROUTES`. This is the indexing guarantee.
  A header covers redirects and non-HTML responses, which a `<meta>` tag cannot,
  and it is applied centrally so a new private route inherits it.
- **`sitemap.xml`** emits exactly `PUBLIC_ROUTES` and nothing else.
- **`robots.txt`** manages crawl budget only. It does not deny by default: it
  disallows the known non-public application prefixes and allows everything
  else, including the static asset directories.

**Context:** The first form of this decision made `robots.txt` deny-all with a
per-path allowlist. That was wrong twice over. Mechanically, `Allow: /` and
`Disallow: /` are the same length, and RFC 9309 §2.2.2 resolves an equal-length
conflict in favour of the allow, so the rule set permitted everything it was
written to forbid. Conceptually, a `Disallow` stops a crawler fetching the page
at all, so it never reads the `noindex` that was supposed to be the second
layer — a disallowed URL can still be listed in results from links alone. The
two mechanisms were not independent; one disabled the other. A deny-all rule
would also have blocked `/og/`, `/hero/` and `/landing/`, so the Open Graph
images that exist to make shared links render would have been unfetchable by
the social crawlers that need them.

The scope of this decision is **URL discoverability, not data security**.
Authentication is the security boundary and is unchanged; every tenant route
already requires a session. What this prevents is an organization's slug and
page titles appearing in public search results.

**Rejected:** generating the sitemap from the route tree minus a blacklist, as
the reference template does. That is correct for a mostly-public site; here
nearly every route is a private tenant page under a customer-chosen
`/$orgSlug`, so a blacklist makes "indexed" the default and a forgotten entry is
a silent regression.

## Superseded history

Each entry above names the numbered ADRs it consolidates or supersedes. The
original ADRs, their alternatives, and the reasoning that was rejected remain in
Git history before the documentation consolidation of 2026-08-23. Do not restate
them here — if an old decision is being revisited, read the original.

### D031 — Money is `bigint` paise; the conversion is a stop-the-world cutover

**Accepted 2026-09-11.** Every money column is Postgres `bigint` paise and all
arithmetic is `bigint`. Inputs and outputs of every procedure are `bigint` too (the
RPC serializer carries it natively); decimal strings exist only where a person
types or reads them: form inputs, PDF cells, and audit meta. The client keeps
bigint literals out of `.tsx` files because the oxc React Compiler rewrites them
to `undefined`; components compare against the imported `ZERO`.
The now-squashed `0002_money_bigint_paise` migration rescaled retained rows in place
(`USING round(col * 100)`), so a numeric-era server reading the migrated table
sees amounts 100× too large and writes amounts 100× too small. D007's rolling
compatibility does not hold for this release: stop every pre-0002 process
before the migrator runs, run the migrator, then start only bigint-aware code.
There is no compatible window and no down migration; restore from the
pre-cutover backup if the release must be abandoned. Later releases return to
D007's rolling rule.

### D032 — Production journal reset to the single 2026-09-11 baseline

**Accepted 2026-09-11; narrow exception to D022.** The repository squashed its
migrations into one `0000_production_baseline` (timestamp `1788496041019`, the
original `0000` ordering value). Production had applied only the committed
`0000` and `0001_patient_contacts`; its money columns were still `numeric`.
On 2026-09-11 the pilot was cut over by hand, with both applications stopped
and a `pg_dump` taken first: the 22 money columns were converted in one
transaction with `round(col * 100)`, the three `DEFAULT 0` values and eleven
check constraints were re-declared to match the baseline, and
`drizzle.__drizzle_migrations` was replaced by one row carrying the baseline's
sha256 and timestamp. A catalog diff against a scratch database built from the
baseline showed zero differences afterwards. Production therefore looks exactly
like a fresh database that applied the baseline once; later migrations apply in
both paths. `dev:status` exact-history checks pass everywhere. The old SQL
remains recoverable from Git history. Migration history is append-only again
after this one repository-only squash.

### D033 — A treatment plan item is a quote and may price below catalog

**Accepted 2026-09-15; evidence: [research](./research/treatment-plans-and-advances.md).**
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

**Accepted 2026-09-16; supersedes the exact-domain-key rule. Amended 2026-09-16:**
the query client's `MutationCache` invalidates every query when the last pending
write succeeds or fails — before that write's own callbacks run, so a callback
that navigates does not fetch the same record twice — and toasts every failure,
so no mutation calls invalidation or toasts an error itself. Other organizations' cached queries are only marked
stale; they are not mounted, so nothing refetches for them. The original rule
had each mutation call `invalidateOrg(queryClient, orgSlug)`. The per-domain helpers it replaces
(appointment, billing, patient, treatment, credit, advance, accounting) were a
hand-kept map of which write ages which key, and it had already drifted: voiding
a plan charge left "done" counts stale, and spending credit left the Follow-ups
figure stale. Only mounted queries refetch, and a screen mounts a handful, so the
request count is close to what the hand-written set produced. Correctness is now
structural rather than remembered. A mutation that must not refetch a specific
key is the exception that has to argue for itself.

### D037 — A list keeps its previous rows while the next key loads

**Accepted 2026-09-16; amends [Design](./design.md) §9.** Search- and
filter-driven lists use `placeholderData: keepPreviousData`, so typing or
toggling a filter never blanks rows that are about to be replaced. The first
load of a list still renders nothing, and `/$orgSlug` carries
`remountDeps: ({ params }) => ({ orgSlug })` so previous rows can never cross a
tenant boundary. The rule that nothing stands in for data that has not arrived
still holds for a region that has never had data.

### D038 — A plan item is charged once, and the rule lives at posting

**Accepted 2026-09-16.** `treatment.postToVisit` refuses when a non-voided charge
for the same catalog item already exists on that visit. That single check
replaced three coupled guards: a `excludePlanId` filter on catalog search, the
intake service rejection inside `opd.book`/`createWalkIn`, and their plan lock.
The desk may now bill a service directly or post it from the plan; whichever
happens first wins, and the second attempt is refused where the Charge is
created. A sitting still carries its plan link at intake, because a plan with a
booked sitting must drop off the Follow-ups call sheet.
