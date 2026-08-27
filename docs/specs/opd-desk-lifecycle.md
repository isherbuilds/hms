# Spec: OPD desk lifecycle and day view

Status: ready
Authority: Product decisions of 2026-08-23 recorded in `docs/decisions.md` D016, evidenced by
`docs/research/25-opd-status-mutation-in-reference-systems.md`
Supersedes: the `waiting → in_consult → completed` lifecycle and the two-view **Queue** /
**Appointments** staff interface recorded in `docs/specs/opd.md`. Everything else in that spec —
the catalog-led intake contract and its completed task record — remains in force; the restatement
below is a pointer, not a second copy.

## Problem

OPD asks reception to record events they cannot observe. The pilot's doctors have no application
logins, so nobody is positioned to press "start consult" or "complete". The two statuses therefore
go unset, which has three consequences: the queue displays a state that is false for most rows for
most of the day, staff learn to distrust the screen, and follow-up pricing silently fails — it keys
on `status = 'completed'` with a `completedAt` inside the follow-up window, so a returning patient
whose prior visit was never closed is charged the full consultation fee.

Separately, the day view splits one day's work across a **Queue** tab and an **Appointments** tab.
Reception must cross that tab to do half of one job: checking in a booked arrival and then managing
the line it joins. The view also has no way to find a person — its filters are department and
practitioner dropdowns, so answering "where is Mrs Nair" means scanning a hundred-row table.

## Solution

Reduce the OPD record to states a receptionist can observe, and make the day one screen they can search. The day has one plus-leading action labelled **New appointment** into one intake screen.

An appointment is `booked`, `checked_in`, `cancelled` or `no_show`. Check-in is the only step
reception performs on a row; it already creates the token and the configured attendance Charge, so
the transition rides work the desk was doing anyway. `checked_in` is terminal on the happy path and
stays true all day.

Follow-up eligibility keys on attendance rather than completion: a prior appointment for the same
Patient and Practitioner that reached `checked_in`, is still `checked_in`, and whose `arrivedAt`
falls inside the configured window. A cancelled appointment never earns the follow-up price.

The Queue and Appointments tabs collapse into one day view: a single list ordered by time, with a
booked slot and an arrived walk-in as rows in the same place. The one **New appointment** action
opens one intake screen. Its Date and time minute selects immediate or scheduled work. One day-list
search field over patient name, MRN, phone and token replaces both dropdowns. A row carries at most
one action — Check in — plus a read-only balance flag. Cancel and no-show live on the full record
opened directly from the row.

## Validation / Evidence

**Owner-funded pilot work, not market-validated.** This is the pilot hospital's own workflow, and
no external demand or adoption claim is made or needed.

The lifecycle removal is evidenced against first-party reference source, not inference:
`docs/research/25-opd-status-mutation-in-reference-systems.md` reads Marley @ `e24bc49` and Danphe @
`9963822` and finds that neither expects a receptionist to drive a consultation lifecycle. Marley
makes appointment `status` read-only and derives `Closed` from saved clinical work; Danphe's OPD
queue has only `pending`/`checkedin`/`skipped` and no completion concept at all.

**Unproved risk, preserved:** no evidence says reception will keep even this reduced model current.
The falsification step is in that memo and repeated under Explicitly Deferred — after a week of live
use, measure what fraction of a day's appointments ever leave `booked`. If that is low, check-in is
decoration too and the day view should become a register over the billing record.

## User Stories / Scenarios

1. As front-desk staff, I see today's booked slots and today's arrivals in one list, so checking
   someone in and then finding them again does not cross a tab.
2. As front-desk staff, I type a name, MRN, phone or token into one field and find that person in
   today's OPD, so I can answer a question at the counter without scanning.
3. As front-desk staff, I check a booked patient in, and that is the only routine step a row asks of
   me.
4. As front-desk staff, I open a row to cancel it or mark it a no-show, so those actions exist
   without crowding every row.
5. As front-desk staff, I see at a glance which arrived patients still owe money, and opening the
   record is how I act on it.
6. As a returning patient seen by the same practitioner inside the follow-up window, I am charged the
   configured follow-up price because I attended and paid last time, not because someone remembered
   to close my previous appointment.
7. As front-desk staff, I cancel a checked-in patient who gave up and left; the appointment closes
   and the refund is an administrator's separate decision on the invoice.
8. As an operator opening a past date, appointments that were left `booked` on that day read as
   No Show, and stay that way.

## Implementation Decisions

### Record and lifecycle

- One `opd_appointments` row remains one scheduled or walk-in outpatient attendance (D013). No
  second Visit, Encounter or Clinical Encounter row.
- `arrivalMode` remains `scheduled | walk_in`, independent of lifecycle state.
- `OPD_APPOINTMENT_STATUSES` becomes `booked | checked_in | cancelled | no_show`. `in_consult`,
  `completed` and `left_unseen` are removed outright, with no compatibility alias, inferred
  replacement, or permanent default.
- `waiting` is renamed `checked_in`. Staff copy is **Checked In**, pairing with the check-in action
  that produces it. The label must stay true for a row all day, including after the patient has gone
  home, which `waiting` did not.
- `left_unseen` folds into `cancelled`. "Patient left before being seen" is a cancel reason, carried
  by the `cancelReason` field that already exists.
- Columns `consultationStartedAt` and `completedAt` are dropped. Nothing reads them once follow-up
  eligibility keys on `arrivedAt`.
- `startConsultation`, `complete` and `markLeftUnseen` are removed from the OPD router.
- `cancel` accepts `booked | checked_in` as its from-states and keeps its mandatory reason.
  `markNoShow` keeps `booked` alone. Both continue voiding pending Charges and emitting their audit
  events.
- Scheduled work starts `booked` and may hold caller details before a Patient is linked. **Later**
  reveals an organization-local minute and calls `opd.book`. It has no consultation Charge, services, quote, or
  settlement until check-in. Check-in atomically links or validates the Patient, records `arrivedAt`,
  allocates the daily practitioner token, and creates the server-selected attendance Charge,
  idempotently under concurrency.
- **Now** calls `opd.createWalkIn` without a client time claim. It requires a Patient and starts
  `checked_in` with the fresh server arrival time, token, known
  Charges, itemized document, Payments/Receipts, and ledger posting created atomically (D015). The
  API requires the settlement object. If the role cannot settle, the screen explains the permission
  block and keeps **Now** selected. It never silently schedules the appointment. A **Later** value
  that is not later than the fresh server organization-local minute is rejected before mutation.

### Stale booked rows

- A read of a **past** business date closes that date's leftover `booked` rows to `no_show` before
  returning them, and persists the change. Today's read — the overwhelmingly common case — performs
  no such write.
- There is no scheduled job, cron, or background worker. The repository has no such infrastructure
  and this change does not introduce it; organizations also carry their own `timeZone`, so a single
  nightly sweep would need per-organization midnights.
- The write carries the tenant predicate like any other, and is a no-op when a concurrent request
  already closed the row.

### Follow-up pricing

- `chooseConsultFee` selects the configured follow-up catalog item when a prior appointment exists
  for the same organization, Patient and Practitioner with `status = 'checked_in'` and `arrivedAt`
  at or after `now - followUpValidityDays`.
- `opd_appointments_org_patient_completed_idx` is keyed on `completedAt`, a column this change drops,
  so it is replaced by an index on `(orgId, patientId, practitionerId, arrivedAt)` partial on
  `status = 'checked_in'` — matching the new predicate exactly.
- A cancelled or no-show appointment never satisfies the predicate, whatever was paid against it.
- Practitioner-level `followUpValidityDays` still overrides the organization default. An intentional
  zero-price follow-up item remains valid.

### Billing boundary

- `BILLABLE_STATUSES` becomes `["checked_in"]`. The meaning is unchanged — arrived, and not closed —
  because `checked_in` is now the terminal happy state and post-intake Charges stay possible for as
  long as the appointment is open.
- Cancelling does **not** issue a credit note or refund. Reception holds `billing: ["read", "write"]`
  and deliberately does not receive `billing: ["creditNote"]`; an automatic refund would either
  escalate that grant for a daily action or bypass the guard internally. An administrator issues the
  credit note and refund from the existing billing screens using the existing `issueCreditNote` and
  `recordRefund` procedures.
- Intake and later invoice collection both support up to four split Payment
  lines in one transaction. Each non-cash line requires a reference and creates
  its own Receipt. An issued Invoice remains immutable: the collection dialog
  routes a later discount to the existing Credit Note workflow.
- The server quote selects the trusted care fee and catalog prices once. The
  intake applies discount allocation, tax, payable and payment-balance arithmetic
  immediately in the client from that quote; `createWalkIn` re-reads prices and
  validates the final settlement inside its transaction.
- Post-intake catalog search is server-side, tenant-scoped, and capped at six
  active non-consultation matches. Staff may stage multiple results and create
  their Charges in one request; the server re-reads every catalog row and price.

### Day read

- `opd.queue` and `opd.appointments` merge into one `opd.day` procedure returning a keyset page over
  a single business date, ordered by `(coalesce(arrivedAt, scheduledFor), id)` so booked slots and
  arrivals interleave on one timeline.
- Input gains an optional trimmed `q` (max 100 chars). When present, the paging subquery joins
  `patients` and matches case-insensitively on name, MRN or phone, or exactly on `tokenNumber` when
  `q` is all digits. When absent, paging stays on `opd_appointments` alone as today.
- Ordering needs a stored column. Today's three ordering indexes are all **partial** — two require
  `tokenNumber is not null`, the third `arrivalMode = 'scheduled'` — so none of them serves one
  merged, unfiltered day list, and none can order a `coalesce(...)` expression. The table gains a
  generated stored column `dayOrderAt = coalesce(arrived_at, scheduled_for)` and one index
  `(orgId, businessDate, dayOrderAt, id)`. The keyset cursor becomes `(dayOrderAt, id)`.
- The three superseded ordering indexes are dropped in the same migration. Write cost was
  deliberately budgeted for this table, so one merged index replaces three rather than joining them.
- No further index for search. The new index prunes to one organization-day before the search
  predicate applies, so the filtered set is a day's rows rather than a table scan. Asserted by plan
  inspection, not assumed.
- The page returns each row's outstanding `balanceDue`, resolved with the existing batched
  `invoiceBalancesFor` helper over the page's invoices — one extra query per page, not per row.
- `includeClosed` is retained: unchecked shows `booked` and `checked_in`, checked adds `cancelled`
  and `no_show`.
- Queue ordering, polling every 10 seconds, refetch on focus, and existing exact invalidation are
  otherwise unchanged.

### Staff interface

- Navigation label and URL remain **OPD** and `/$orgSlug/opd`; the page title uses
  the expanded **Outpatient** label.
- The `view` search param and the Queue/Appointments tab are removed. The date param stays, and the
  day stepper lives in the header as the screen's active date context; the title does not repeat a
  passive formatted date. Previous day, the native date field and next day are three independent
  focus stops; each changes the register's single business date directly.
- The day page has one text-first primary action, labelled **New appointment**, which opens
  `/$orgSlug/opd/new`; compact screens show **New**. The dashboard does not repeat it. The intake has no
  `mode` route or search state.
- The intake page and meta title use **Appointment**. Successful intake navigates
  directly to the Clinical record so the patient slip is immediately available,
  with no success-only page.
- One search input over name, MRN, phone and token replaces the department and practitioner
  dropdowns. It is debounced client-side using the existing `useDebouncedValue` hook, as
  `patients/index.tsx` already does.
- Search and the closed-appointment filter form one toolbar. The appointment panel expands to hold
  the remaining viewport when the day is empty instead of collapsing above unused whitespace.
- Immediate settlement uses one header/content/footer composition in both its Dialog and Sheet
  presentations. Summary, discount, payment lines, validation and note stay in the same order and
  use the same compact type scale at every width.
- A row leads with token, then patient name and MRN, time, practitioner, state, and a read-only balance flag.
  There is no Action column; **Check in** replaces the state badge on `booked` rows.
- The day is one flat list ordered by time, with no grouping. With the lifecycle gone there is no
  flow to visualise and no "next" to point at, so grouping would add structure that carries no
  information. Grouping by practitioner is the named alternative, deferred below.
- Superseded on 2026-08-25: clicking a row now opens the full record directly at
  `/$orgSlug/opd/$appointmentId`. Cancel and no-show live on that record. The OPD visit
  Sheet was removed.
- Motion follows `AGENTS.md` §UI: the day has no row or list-update animation, because this is a
  frequent all-day list. Existing dialog and Sheet enter/exit behavior stays as-is.
- Staff copy uses OPD, appointment, walk-in, check in, token, **Checked In**, **Cancelled** and
  **No show**. It does not expose table names or invented umbrella terms.

### Unchanged by this spec

`docs/specs/opd.md` remains authoritative for all of the following. Listed here only so an
implementer of this spec does not assume they are open:

- Appointment `kind` does not exist. `arrivalMode` and `status` are the OPD dimensions.
- Catalog item `category` remains `consultation | procedure | lab | radiology | other`. For immediate intake, the server-selected consultation or follow-up item appears in **Services** and materializes as a `consult_fee` Charge unless omitted. A zero-value walk-in is valid and creates no financial document. A scheduled appointment gets its consultation line only at check-in but may keep selected non-consultation services as dormant pending Charges from booking.
- `ServicePicker` keeps `All categories | Procedure | Lab | Radiology | Other`
  filter, conjunctive with text search, not persisted anywhere, resetting with a new intake form.
- Intake order is Patient search or inline registration → Department/Practitioner → **When** →
  Date and time for **Later** → optional searchable services in either mode → financial confirmation for non-zero **Now**,
  at `/$orgSlug/opd/new`. The client never supplies a time for **Now**.
- Only services known at intake go on the initial itemized document; later services become Charges on
  the same appointment. A billing line is never proof that clinical work was ordered, performed or
  resulted.

### Documentation ownership

- `docs/product.md` carries the canonical status vocabulary and points here for OPD behaviour.
- `docs/decisions.md` gains **D016** for the lifecycle removal, which is the choice a future reader
  will question.
- `docs/research/25-opd-status-mutation-in-reference-systems.md` is a temporary memo per the research
  ledger's own convention; its conclusion is already promoted into `docs/research/README.md`, and the
  memo is deleted in the final slice.

## Test Seams

1. **Real-Postgres oRPC integration seam — `tests/integration/opd.test.ts`.** The primary seam. It
   already owns lifecycle, fee selection, token allocation, concurrency and settlement coverage.
   Verifies: the four-status machine and every rejected transition; that `startConsultation`,
   `complete` and `markLeftUnseen` no longer exist; that follow-up pricing fires from a prior
   `checked_in` attendance inside the window and does not fire from a cancelled one; that `cancel`
   accepts both open states and voids pending Charges; that a past-date read closes leftover `booked`
   rows to `no_show` and a same-day read does not; that `opd.day` pages stably, interleaves booked
   and arrived rows by time, searches by name, MRN, phone and token, and returns `balanceDue`.
2. **Tenancy seam — `tests/integration/tenancy.test.ts`.** Existing prior art. Verifies that
   `opd.day`'s search predicate and the past-date `no_show` write both carry the tenant predicate,
   and that neither leaks or mutates another organization's rows.
3. **Billing seam — `tests/integration/billing.test.ts`.** Verifies that post-intake `addCharge`
   succeeds against `checked_in` and is refused against `booked`, `cancelled` and `no_show`, and that
   cancelling a paid appointment issues no credit note and leaves the invoice for an administrator.
4. **Generated Drizzle migration seam.** A clean migrated database has the four-value status enum, no
   `consultation_started_at` or `completed_at` columns, and its remaining OPD constraints and indexes
   intact.
5. **Query-plan seam — `EXPLAIN (ANALYZE, BUFFERS)`,** as established by the earlier keyset work.
   Verifies that a searched `opd.day` page still prunes on the tenant/day index rather than scanning.
6. **Typed client/API seam — `bun run check-types`.** The web app compiles only once every removed
   status and procedure is gone from the client, proving the inferred oRPC contract changed end to
   end.
7. **UI behaviour seam — production build plus browser inspection.** There is no component-test
   harness for these screens and this spec does not add one. Verifies on desktop and mobile, light
   and dark: no tab, search finds by all four keys, a `booked` row offers only Check in, the Sheet
   opens with cancel and no-show, the balance flag is read-only, and keyboard focus works throughout.

## Task Plan

- [x] Slice 1: Reduce the status model and re-key follow-up pricing
  - Acceptance: `OPD_APPOINTMENT_STATUSES` is exactly `booked | checked_in | cancelled | no_show`;
    `consultationStartedAt` and `completedAt` columns are gone; `startConsultation`, `complete` and
    `markLeftUnseen` are gone from the router; `cancel` accepts `booked | checked_in` and
    `markNoShow` accepts `booked`, both still voiding pending Charges and auditing; follow-up pricing
    selects the follow-up item from a prior `checked_in` attendance whose `arrivedAt` is inside the
    window and does **not** select it when that prior appointment was cancelled or no-showed;
    `BILLABLE_STATUSES` is `["checked_in"]` and post-intake `addCharge` behaves accordingly; the
    dashboard reports one checked-in count plus booked-not-arrived; the follow-up lookup index is
    rebuilt on `(orgId, patientId, practitionerId, arrivedAt)` partial on `status = 'checked_in'`,
    because the index it replaces was keyed on the dropped `completedAt`; partial-index predicates
    naming removed statuses are updated; the generated migration changes no unrelated constraint or
    index.
  - Verify: `bun run db:generate` then inspect the generated migration and metadata without editing
    them; `bun run db:up`; `bun run db:migrate`;
    `bun test --max-concurrency 1 --timeout 15000 tests/integration/opd.test.ts tests/integration/billing.test.ts tests/integration/tenancy.test.ts`;
    `bun run check-types`.
  - Depends on: none.
  - Owns/Touches: `packages/db/src/schema/opd-appointments.ts`; generated files under
    `packages/db/src/migrations/`; `packages/api/src/routers/opd.ts`;
    `packages/api/src/routers/billing.ts`; `packages/api/src/routers/dashboard.ts`;
    `apps/web/src/components/opd-appointment.tsx`;
    `apps/web/src/routes/$orgSlug/opd/$appointmentId/index.tsx`;
    `apps/web/src/routes/$orgSlug/dashboard.tsx`; `tests/integration/opd.test.ts`;
    `tests/integration/billing.test.ts`; `tests/integration/tenancy.test.ts`.
    `apps/web/src/routes/$orgSlug/opd/index.tsx` is edited only as far as compilation demands; its
    redesign is Slice 3's.
  - Interfaces: exports `OPD_APPOINTMENT_STATUSES = ["booked", "checked_in", "cancelled", "no_show"]`;
    removes `opd.startConsultation`, `opd.complete`, `opd.markLeftUnseen`; `opd.cancel` keeps
    `{ orgSlug, appointmentId, reason }`; `opd.markNoShow` keeps `{ orgSlug, appointmentId }`;
    every appointment output loses `consultationStartedAt` and `completedAt`.

- [x] Slice 2: Merge the two day reads into `opd.day` with search and balance
  - Acceptance: one procedure returns a keyset page over a single business date ordered by
    `(coalesce(arrivedAt, scheduledFor), id)`, interleaving booked and arrived rows; complete
    traversal and stable ordering hold across pages; `q` matches case-insensitively on patient name,
    MRN and phone and exactly on `tokenNumber` for all-digit input, and is absent from the query when
    unset; each row carries `balanceDue` resolved by one batched query per page; `includeClosed`
    toggles `cancelled`/`no_show` into the page; a read of a past business date persists `no_show` on
    that date's leftover `booked` rows while a same-day read performs no write; every query and the
    stale-row write carry the tenant predicate; the generated stored column `dayOrderAt` exists with its
    `(orgId, businessDate, dayOrderAt, id)` index and the three superseded partial ordering indexes
    are dropped; a searched page's plan uses that index rather than scanning or sorting the day.
  - Verify: `bun run db:generate` then inspect the generated migration without editing it;
    `bun run db:migrate`;
    `bun test --max-concurrency 1 --timeout 15000 tests/integration/opd.test.ts tests/integration/tenancy.test.ts`;
    `EXPLAIN (ANALYZE, BUFFERS)` on a searched and an unsearched page, recorded in the PR;
    `bun run check-types`.
  - Depends on: Slice 1.
  - Owns/Touches: `packages/api/src/routers/opd.ts`; `packages/db/src/schema/opd-appointments.ts`;
    generated files under `packages/db/src/migrations/`, generated not hand-written;
    `tests/integration/opd.test.ts`; `tests/integration/tenancy.test.ts`.
  - Interfaces: produces
    `opd.day({ orgSlug, date?, q?, includeClosed?, cursor?, limit? })` returning
    `{ items: (appointment & { patientName, patientMrn, patientPhone, practitionerName, departmentName, balanceDue })[], nextCursor: { dayOrderAt: Date, id: string } | null }`;
    adds the generated column `opdAppointments.dayOrderAt`; removes `opd.queue` and
    `opd.appointments`. Consumes the status enum from Slice 1.

- [x] Slice 3: Rebuild the day view as one searchable surface
  - Acceptance: the `view` search param and the Queue/Appointments tab are gone and the date param
    still works; one debounced search field replaces both dropdowns and finds by name, MRN, phone and
    token; the day renders as one time-ordered list; a `booked` row offers Check in and nothing else,
    and closed rows show their outcome in its place; the balance flag renders for rows with an
    outstanding balance and is not actionable; clicking a row opens a Sheet with the record summary,
    cancel-with-reason, mark-no-show and a link to the full record; the Sheet behaves identically at
    every width; rows carry no motion; keyboard focus reaches every control; the appointment record
    route is unchanged.
  - Verify: `bun run check-types`; `bun run check`; `bun run build`; browser-inspect
    `/$orgSlug/opd` in light and dark at desktop and mobile widths, covering each search key, a
    no-match query, check-in, cancel, no-show, a past date, and `includeClosed`.
  - Depends on: Slice 2.
  - Owns/Touches: `apps/web/src/routes/$orgSlug/opd/index.tsx`;
    `apps/web/src/components/opd-appointment.tsx`;
    `apps/web/src/components/opd-appointment-dialogs.tsx`; a new
    `apps/web/src/components/opd-visit-sheet.tsx`; `apps/web/src/routeTree.gen.ts` only as
    regenerated, never hand-edited.
  - Interfaces: consumes `opd.day` from Slice 2. Produces `OpdVisitSheet({ orgSlug, appointment,
open, onOpenChange })` following `PatientSheet`'s prop contract.

- [x] Slice 4: Retire the prototype surface and land the documentation
  - Acceptance: `apps/web/src/prototypes/opd-day/` and `apps/web/src/routes/prototype-opd-day.tsx`
    are deleted and the route tree regenerated; `docs/product.md` states the four-status vocabulary;
    `docs/decisions.md` carries D016; the research memo is deleted, its ledger row already in place;
    this spec's checkboxes reflect what landed.
  - Verify: `bun run check-types`; `bun run check`; `bun run test`; `bun run build`.
  - Depends on: Slice 3.
  - Owns/Touches: `apps/web/src/prototypes/opd-day/`; `apps/web/src/routes/prototype-opd-day.tsx`;
    `apps/web/src/routeTree.gen.ts` as regenerated; `docs/product.md`; `docs/decisions.md`;
    `docs/research/25-opd-status-mutation-in-reference-systems.md`; `docs/specs/opd.md` checkboxes
    only. Unrelated failures are reported, not repaired.
  - Interfaces: none produced or consumed.

## Out of Scope

- Any doctor-facing surface, login, or clinical documentation. The pilot stays paper-first.
- Wait duration, queue position, estimated waiting time, or consult-duration analytics.
- Background jobs, schedulers, cron, or per-organization midnight sweeps.
- Automatic credit notes or refunds on cancellation, and any widening of the `creditNote` grant.
- Inline charge editing on the day view.
- This spec did not change intake or its billing boundary when it shipped. The later
  [`core-screen-refinement.md`](./core-screen-refinement.md) supersedes that plan boundary for the
  single entry action and datetime-derived immediate or scheduled path. D015 settlement, invoice,
  receipt, payment, and journal rules remain unchanged.
- Grouping the day by practitioner or department, and a public token display.
- IPD and Emergency.

## Explicitly Deferred

These are accepted omissions. A later review must not promote them into blockers for this spec.

- **Practitioner grouping.** The flat list is right for two or three practitioners. If the pilot
  grows past roughly four, lanes grouped by practitioner become the better shape, matching the
  per-practitioner token counter the schema already enforces.
- **No-show accuracy for reporting.** Because stale `booked` rows only close when somebody opens that
  past date, any no-show-rate report built later will understate reality until a real sweep exists.
  Whoever writes that report owns fixing it.
- **A doctor-driven completion signal.** If doctor logins or clinical documentation ever land,
  Marley's model — completion derived from saved clinical work rather than a button — is the shape to
  copy, and `consultationStartedAt`/`completedAt` can return.
- **Whether reception maintains even this model.** After a week of live use, measure what fraction of
  a day's appointments ever leave `booked`. A low number means check-in is decoration too, and the
  day view should become a register over the billing record.
- **Server-side patient search sharing.** `opd.day`'s search and `patient.search` stay separate; one
  searches today's OPD, the other the patient master. Unifying them needs a reason neither has yet.

## Open Questions

None.
