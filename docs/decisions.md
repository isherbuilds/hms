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
later clinical state.

### D016 — OPD records only observable states

**Accepted 2026-08-23; spec: [OPD desk lifecycle and day view](./specs/opd-desk-lifecycle.md).** OPD keeps only `booked`, `checked_in`, `cancelled`, and `no_show`. `in_consult`, `completed`, and `left_unseen` are removed outright with no compatibility alias, and staff copy is **Checked In**, **Cancelled**, **No show**.
Removed router procedures are `startConsultation`, `complete`, and `markLeftUnseen`; `opd.queue` and `opd.appointments` are removed and replaced by `opd.day`.
Columns `consultationStartedAt`, `completedAt`, and `leftUnseenAt` are dropped. Follow-up pricing keys on a prior `checked_in` attendance's `arrivedAt` and does not use completion.
Stale `booked` rows close to `no_show` lazily when a past date is read. No background job is introduced.
The reference memo's conclusion is preserved in the ledger row `OPD status mutation` in
`docs/research/README.md`.

## Superseded sequence

The following history is retained here so old reasoning is not mistaken for
current design:

- **0003 client-rendered org pages** → superseded by D008 server rendering.
- **0007 invite-only first-user bootstrap** → superseded by D006 operator-created
  accounts.
- **0010 organization ID claim** → slug became the immutable request claim in
  D001.
- **0017 generic AI streaming endpoint** → feature and endpoint removed by D014.
- **0022 shared Clinical Encounter + Billing Account** → Billing Account removed
  by 0023, then the remaining wrapper removed by D013/0026.

The detailed original ADRs and alternatives remain available in repository Git
history before the documentation consolidation of 2026-08-23.
