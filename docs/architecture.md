# Architecture

HMS is a Bun/Turborepo monorepo: TanStack Start (`apps/web`), Hono/oRPC
(`apps/server` and `packages/api`), Drizzle/PostgreSQL (`packages/db`), Better
Auth (`packages/auth`), private S3-compatible storage (`packages/storage`), and
shared Base UI/shadcn components (`packages/ui`).

## Runtime shape

```text
browser ──HTTP──▶ apps/server/Hono ──▶ oRPC handler ──┐
                    └─ /api/auth                      │
                                                     ├─▶ appRouter
browser ──HTTP──▶ apps/web billing-PDF route ─────────┤
apps/web SSR ──in-process router client───────────────┤
tests ─────────in-process router client───────────────┘
```

Every router entry point builds the same request context. SSR, billing-document
routes, and integration tests therefore exercise the same router and
authorization guard as HTTP. The API server also exposes development-only
reference pages; they never mount in production. RPC and development reference
bodies are limited to 1 MiB before expensive context work.

Source-of-truth code:

| Concern                   | Location                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| Roles and permissions     | `packages/auth/src/access.ts`                                         |
| Request context           | `packages/api/src/lib/context.ts`                                     |
| Guarded procedure factory | `packages/api/src/lib/procedures/factory.ts`                          |
| Routers and audit         | `packages/api/src/routers/`, `packages/api/src/audit.ts`              |
| Schema and migrations     | `packages/db/src/schema/`, `packages/db/src/migrations/`              |
| Web RPC/query policy      | `apps/web/src/lib/orpc.ts`, `query-client.ts`, `operational-query.ts` |
| Storage                   | `packages/storage/src/index.ts`                                       |

## Tenancy and authorization

The organization slug is explicit untrusted procedure input. It is never
session state and never falls back:

```text
/:orgSlug/... → input.orgSlug → orgProcedure(permission, input)
              → session + indexed membership + union-role grant
              → context.scope { orgId, userId }
              → WHERE table.org_id = scope.orgId
```

- Organization slugs are immutable, URL-safe, at least four characters, and
  outside the reserved public/system root namespace.
- `session.activeOrganizationId` is never tenant scope.
- A missing claim fails validation, a missing session is `UNAUTHORIZED`, and a
  missing membership or grant is `FORBIDDEN`. Foreign/nonexistent slugs are
  intentionally indistinguishable.
- HMS recognizes `owner`, `admin`, `reception`, `cashier`, and `accountant`. Any
  other stored role, including Better Auth's default `member`, is rejected by
  `parseRoles`/`authorize` and fails closed.
- Better Auth's own organization endpoints remain mounted at `/api/auth/*` and
  may consult active-organization state when their input omits an id. They
  enforce Better Auth permissions but bypass the application's membership audit;
  supported product flows use guarded `member.*` procedures. Integration tests
  pin both properties until the direct surface is closed or audited.
- The request context memoizes membership only within that request. Every
  procedure still checks its own permission and denial audit. Nothing survives
  the request, so revocation applies on the next request.
- Handlers use only `context.scope.orgId` for SQL. `userId` is attribution.
- Every primary-key lookup and write includes the tenant predicate. Reads and
  direct writes turn foreign ids into `NOT_FOUND`; conditional state writes may
  deliberately return the same `CONFLICT` for missing and already-moved rows.
- Every referenced id is re-verified under the same tenant. Taxes and default
  prices come from server-read catalog rows. OPD intake may supply a custom rate,
  which the server accepts only after it verifies the active tenant-scoped
  catalog row and its custom-rate setting.
- RLS is not currently used. Application predicates plus integration guardrails
  are the accepted enforcement model; RLS may later be additive defense in
  depth, never a replacement for membership/permission checks.

Permissions are defined only in dependency-free `packages/auth/src/access.ts`.
Better Auth stores comma-joined roles; `parseRoles` and `authorize` treat them as
a union and throw on unknown roles. Client checks only hide controls; every
operation is checked server-side.

No email is sent. The invitation id is an opaque UUIDv7 that the admin hands to
one person; presenting it with the invited email is the proof of eligibility
(D006). The `invitation-claim` plugin enforces this in Better Auth's
`user.create.before` hook: native `/sign-up/email` must carry a live invitation
id whose email matches, and every other creation path is refused. Operator
scripts insert rows directly and bypass the hook. New accounts stay
`emailVerified: false` until a provider exists; organization endpoints do not
require verification.

Because the id creates the account, `member.list` returns invitation rows and
their links only to members holding `invitation: ["create"]`. Expired rows are
hidden; inviting the same email again after expiry creates a fresh id.

The join page's invitation lookup is public and returns the invited email,
organization name and slug, and whether an account exists. From it the visitor
either signs in or creates the account (name and password), then accepts the
selected invitation through Better Auth, which checks the session email against
the invitation. The organization picker loads only when no invitation is
selected; its invitation links open the same selected-invitation screen.

To add an organization-scoped domain:

1. Add `orgId NOT NULL` and a tenant-leading index; generate the migration.
2. Add explicit grants for every role in `packages/auth/src/access.ts`.
3. Declare every endpoint with `orgProcedure(permission, orgInput...)`.
4. Predicate every read/write/reference with verified `context.scope.orgId`.
5. Put web routes under `apps/web/src/routes/$orgSlug/` and include `orgSlug` in
   every query, mutation, direct call, and invalidation key.
6. Add procedures to `GUARDED_CALLS` and prove cross-tenant row invisibility in
   `tests/integration/tenancy.test.ts`.

## Web data flow

Org pages server-render. The `/$orgSlug` loader calls `member.me` through the
request-local in-process client and supplies the shell's identity, roles,
organizations, timezone, and currency. Base UI popups remain behind
`ClientOnly` because of their current SSR store behavior.

TanStack Query is the sole cache. Loaders prime it and components subscribe with
the identical `queryOptions`; loaders do not carry query data as a second cache,
and a loader's return value is not a channel for handing data down as props —
`useMembership` in `apps/web/src/lib/membership.ts` is how a component asks for
the one slice of `member.me` it draws. Independent reads run in parallel.
Required failures reach route error/not-found boundaries; secondary prefetches
may fail into component-level states.

A route gated by a permission resolves it in the loader through
`requireOrgPermission` and redirects somewhere the role can use. The gate names
every grant the page needs to reach a submitted state, not just the one its name
suggests: a page that renders and then 403s on save is the same denial arriving
later. Actions that a role cannot perform on an otherwise readable page are
hidden with `useCan` instead.

The landing page and `/login` are for signed-out visitors. Their `beforeLoad`
calls `redirectSignedInHome` in `apps/web/src/lib/home.ts`, a server function
that reads the session and sends a member to their first organization by name
(the switcher's order) or, with no membership, to `/join`. A validated `redirect`
search value on `/login` wins over that default. Sign-in itself navigates to `/`
so this is the one place that decides where a signed-in user belongs.

Shared chrome for a tabbed record lives in its layout route, so switching tabs
re-renders the body alone. A React context shared between sibling routes must be
declared **outside** the route tree: TanStack Start splits a route file into
separate chunks, so a context created in `route.tsx` and imported from a sibling
route resolves to two different objects — the provider publishes into one and the
tab reads the other. `apps/web/src/lib/opd-record.ts` is why.

Every query identity includes `orgSlug`. Growing lists use keysets containing
all stable ordering columns and select `limit + 1` base rows through a
tenant-leading index before joining display data. Never use `OFFSET` for
operational lists.

The OPD operational surfaces poll every 10 seconds with a 5-second stale time
and refetch on focus; background tabs pause, and a paged list stops polling once
it holds more than one page. Every settled mutation refreshes all mounted queries
through the query client's `MutationCache` (D036), so no write can miss a key,
and a `CONFLICT` refreshes the losing terminal's screen too. A search-driven list
keeps its previous rows only while the search term changes (D037). There is no
WebSocket/SSE layer.

## Data and migrations

- Every Organization-owned domain or infrastructure row has `orgId NOT NULL`.
  Keys and timestamps follow the record's job: UUIDv7 text ids and paired
  `createdAt`/`updatedAt` are common, but counters use composite keys, immutable
  documents may have only `createdAt`, and a file id is its validated object
  key. Do not infer a field contract from convention. Cross-row invariants are
  database constraints when PostgreSQL can express them.
- Sponsor data lives in the organization-scoped `payers` master and `patient_payers` links; it is measurement data, not billing state.
- Tenant-leading indexes follow the actual filter/order/keyset shape. Descending
  nullable cursor columns specify matching null ordering explicitly.
- Use scoped `UPDATE/DELETE ... RETURNING` instead of select-then-write; see
  [Writes and concurrency](#writes-and-concurrency).
- Never hand-edit generated Drizzle migrations. Schema changes use
  `bun run db:generate`; intentionally hand-authored SQL gets a separate
  migration.
- History is append-only once a retained database applied it; an unapplied
  migration is a draft to regenerate, never to stack a fix on (D022).
- Development and production apply migrations before app startup. Production
  startup retains the advisory lock; deployment migrations must remain
  compatible with an old instance that may still be draining.
- Integration tests use real PostgreSQL and wipe only a database ending in
  `_test`.

## Domain boundary

Patient MRNs use an organization-scoped transactional counter plus configured
prefix. The MRN is a local display identifier, not primary identity or a
national ID.

A Patient stores one date of birth plus `dobEstimated`; age is always derived
against the Organization-local date, and an estimate is displayed with a `~`
prefix. Registration requires an explicit sex choice. Phone matching and input
classification compare digits only, while the stored and displayed phone text
keeps the operator's formatting.

Patient edits are an Organization-scoped compare-and-swap against the loaded,
millisecond-exact `updatedAt`. A zero-row update is a stale-record `CONFLICT`
with no second read; the client offers a refresh, which also reveals a Patient
that no longer exists. The server does not retry a stale write.

The catalog is a flat chargeable-item registry. Charges snapshot name/code,
category, unit price, tax rate, and tax code so later catalog edits never
rewrite financial history. New/follow-up attendance pricing is configured per
practitioner; a configured zero-price item represents intentional free care.
An OPD intake custom rate changes only the new Charge snapshot. It
does not update the catalog item.

One OPD Appointment is the parent for its Patient link, queue lifecycle,
Charges, Invoices, and prescription attachments. Check-in enriches a booked row;
it does not create a Visit/Encounter wrapper. Details live in [OPD](./opd.md).

A Treatment plan groups a course of care for one Patient and Practitioner. Its
items are quote snapshots, not earned work. Each Sitting is an ordinary
plan-linked OPD Appointment. Posting a plan item to a checked-in Sitting creates
the Charge; billed amount and sitting counts are derived from those source
rows. The plan stores no name of its own: its label is derived from the item
descriptions on read. Its free text is the requested next-sitting note and,
once closed, the close reason.

Booking and walk-in creation share one appointment table and one intake UI. They
remain separate server procedures because `createWalkIn` is an atomic financial
transaction that requires `billing:write`, while `book` requires `opd:create`
and may atomically snapshot optional selected services as pending Charges. Those
booked Charges stay outside billing worklists and invoice issuance until check-in.
A merged contract would over-privilege booking staff or weaken the money path.

Each care setting owns its operational billing route and desk workflow, over one
shared finance domain: immutable documents, collection, corrections, accounting,
and authorization (D019). Shared care-setting UI is extracted only after a
second shipped desk proves the same interaction and state model.

The pharmacy owns `products` (the D027 domain master), `stock_batches`,
the append-only `stock_movements` ledger, `goods_receipts`,
`pharmacy_sales`, `pharmacy_returns`, and `pharmacy_return_lines`. A product
with no `catalogItemId` is an internal supply: stocked and issued, never sold.
Opening stock is a goods receipt with `opening` set, not a separate document. `invoices`
and `charges` carry exactly one typed parent, an OPD Appointment or a Pharmacy
sale, matched to `invoices.stream` by a check constraint.

## Writes and concurrency

The database serializes concurrent writes; the application neither retries nor
keeps its own locks (D040).

- **One row decides:** a tenant-scoped conditional `UPDATE … RETURNING` whose
  predicate states the allowed prior state. Zero rows is one `CONFLICT` (D026).
- **A check spans rows:** `SELECT … FOR UPDATE` on every row the check reads,
  then re-read balances in a new statement, because under READ COMMITTED only a
  statement that starts after the lock sees what committed while it waited.
- **Lock order.** A transaction takes locks in this order and skips what it
  does not need: OPD Appointment → Treatment plan item → Treatment plan →
  Charges → Invoice → Products (by `id`) → Stock batches (by `expiryDate`,
  `id`) → Advance Receipts (by `createdAt`, `id`). Receipts and
  product updates both lock the Product before reading or inserting its batches.
  A new record type is placed in this list in the same change that first locks it.
  One exception: a pharmacy sale locks its batches before taking the invoice
  counter, because its Charges and Invoice are created inside that transaction
  and nothing else can wait on them. No writer holds an invoice lock and then
  waits on a batch, so the inverse pair that would deadlock cannot form.
- **Counters are locks.** A counter row stays locked until commit, which keeps a
  series gapless. One transaction takes series in the order token → invoice →
  receipt; every other command takes a single series.
- **Pending money writes stay open.** A form holding a pending money write
  cannot be dismissed.
- **A care record's Charge set** carries `chargeRevision`. Every post-check-in
  change to it (plan posting, void, Invoice issuance) advances it in the same
  transaction; settlement locks the record and must match both the reviewed
  revision and the reviewed grand total after trusted repricing (D020). See
  [OPD](./opd.md#billing-workspace-and-concurrency).
- **One path per effect.** Every void of pending Charges goes through
  `voidPendingCharges`, which also reopens a completed Treatment plan that loses
  delivery (D038). Its caller already holds the Appointment lock.

## Public site

The signed-out site is TanStack routes under `apps/web/src/routes/` rendered
through `PublicPage`. Changelog entries are MDX files in
`src/content/changelog/` whose filename is the slug. `PUBLIC_ROUTES`
(`config/site.ts`) lists indexable pages; `PUBLIC_PATHS`
(`config/public-paths.ts`) adds changelog entries and is the only input to the
sitemap and the `X-Robots-Tag` middleware (D030). Contact is WhatsApp and
`mailto:` from required `VITE_WHATSAPP_NUMBER`/`VITE_CONTACT_EMAIL`; there is no
form or server route. Open Graph images are generated by a script a person runs,
not per request. Public slugs are reserved in `@hms/auth/organization-slug`.

## Audit

`audit()` is fire-and-forget. It records verified role denials centrally and
sensitive/destructive successes such as membership changes, file deletion, and
financial corrections. Do not audit lists, reads, or every ordinary mutation.

A foreign membership claim cannot insert into the claimed tenant's audit log.
Presigned URLs, tokens, and secrets never enter audit metadata. A verified file
deletion records the stored in-scope object key; an unverified or foreign
caller-supplied key is recorded only as a digest. Tests use `eventually` for
positive assertions and `drainAuditWrites()` before negative assertions.

Accounting differs: journals commit atomically with their source financial
document. Audit availability must not fail an operational action; ledger drift
must fail the financial transaction.

## Files

Objects are always private. The browser uploads/downloads directly with
15-minute presigned URLs; bytes never cross the app server. Keys are
`<orgId>/<uuid>/<sanitized-name>` and are validated before database work.

Upload lifecycle: insert `pending` metadata and presign, browser PUT, then scoped
`pending → ready`. Pending objects are neither listed nor readable. Deletion
commits metadata removal first, then best-effort object removal; a storage
failure may leave an unreachable orphan but never a live row pointing at a
missing object. No anonymous bucket policy or unsigned read path is allowed.

## Billing ledger

Invoices, Payments, Advance Receipts, Advance Allocations, Credit Notes, and Refunds post balanced journals in the
same transaction. Stable `systemKey` accounts include Cash, Bank, Patient
Receivables, Patient Advances, GST Output, Round-off, and category revenue
accounts. An Advance Receipt credits Patient Advances. Allocation debits that
liability and credits Patient Receivables. An unused-credit Refund debits the
liability. A unique `(orgId, sourceType, sourceId)` prevents duplicate posting;
storage and all math use `bigint` paise, and the RPC link carries `bigint` end
to end; decimal strings exist only where a person types or reads them (form
inputs, PDF cells, audit meta).
Payments use four methods: Cash, UPI, Card, and Bank transfer.

A pharmacy sale credits Pharmacy Sales Revenue (`4500`). Pharmacy invoices are
tax-inclusive: `unitPrice` is the batch MRP as printed per `priceUnits` stock
units (`mrpUnits` on the batch). Exact line values allocate the rounded subtotal
by largest remainder; taxable value and tax are extracted from discounted gross
per line. The pharmacy grand total alone rounds to the nearest rupee, with
`roundOff` (−49..50 paise) posted to the Round-off account and reversed on the
credit note completing a full return. OPD invoices stay tax-exclusive and
round to the paisa (`roundOff = 0`). Stored money remains `bigint` paise (D031,
D044).

Split collection is one tenant-scoped transaction containing up to four
Payments. Every line gets its own Receipt and journal source; lines
fail before insertion when a non-cash line lacks its reconciliation reference. Catalog
charges selected together are likewise verified under the same organization
and inserted in one transaction rather than one request per item.

A command's journals post through one `postJournalEntries` call: one account
read and two inserts however many entries it writes, each entry still balanced
on its own. Consecutive document numbers for one command come from one counter
upsert (`nextCounter(tx, orgId, key, count)`).

Trial balance and billing-ledger balance sheet read journals. GST reporting
reads immutable invoice/credit-note lines because document numbers, patients,
rates, and HSN/SAC are document facts. The current GST surface is an intra-state
outward register, not a filing-ready GSTR-1 export.

Billing paper is rendered on the server from one guarded domain call —
`billing.getInvoice`, or `billing.getAdvanceReceipt` for an Advance Receipt.
Preview, print, and download share that PDF endpoint, and both document routes
share one response helper; neither repeats the domain query. Templates read only
the immutable source facts for the selected Invoice, Payment, Advance Receipt,
Credit Note, or refund, so later balance activity cannot rewrite an issued
document. The renderer and its WASM stay
behind a server-only dynamic import, and its Unicode fonts are application
assets rather than network dependencies (D021).

Business Date is the calendar date in the Organization timezone with a local
midnight boundary. Invoice, Payment, Advance Receipt, Credit Note, and Refund
rows snapshot it at issuance; paper renders that stored date rather than reinterpreting `createdAt`.
Stored token/document/journal dates do not move when the timezone setting later
changes.
