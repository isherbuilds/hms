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

### D006 — Operator-created accounts; founder-only Organizations

**Accepted; consolidates 0013–0014; supersedes invite-only bootstrap 0007.**
Public sign-up is disabled. Operators create password accounts with Better
Auth's hashing path. Only the account matching `FOUNDING_EMAIL` may create an
Organization; neither owner nor admin role grants that platform capability.
This removes the racy “first user” bootstrap while keeping ordinary membership
invitation inside Organizations.

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

### D023 — Lost-response retries of payments and corrections are accepted until pilot.

**Accepted 2026-08-31.** `recordPayments`, `issueCreditNote`, and
`recordRefund` mint fresh IDs per request and bound only cumulative totals, so a
client retry after a lost response can record a duplicate partial movement while
headroom remains. D020's charge revision is deliberately not a payment
idempotency key. This risk is accepted for the pre-pilot phase; before pilot,
revisit with a client-supplied operation ID and a scoped unique constraint if
the pilot workflow shows real retry exposure.

**Context:** Mutations do not auto-retry; the exposure is a human resubmitting
after a network failure.

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

## Superseded history

Each entry above names the numbered ADRs it consolidates or supersedes. The
original ADRs, their alternatives, and the reasoning that was rejected remain in
Git history before the documentation consolidation of 2026-08-23. Do not restate
them here — if an old decision is being revisited, read the original.
