# 02 — Appointments and encounters

Status: DEFERRED — revisit after pilot feedback (2026-08-07: pilot is walk-in; v0 keeps the
`visits` aggregate and queue-first flow per spec — an `appointments` table can later point at
a visit created on arrival without reshaping visits)
Depends on: none
Blocks: 03, 04, 08

## Problem

The front desk can register and find patients, but there is no appointment or clinical
encounter row after registration; the live domain surface stops before either concept
(`docs/research/01-reference-architecture-danphe-marley.md:14-21`). Departments already say
visits will reference them (`packages/db/src/schema/departments.ts:5-8`), and practitioners
already reserve a catalog item for a visit-time consult fee
(`packages/db/src/schema/practitioners.ts:27-28`). Without explicit lifecycle rows, later
orders, charges, observations, and encounter finalization have no tenant-scoped parent.

## Evidence

- Research §A records Marley's appointment target fields and eight states: `Scheduled`,
  `Open`, `Confirmed`, `Checked In`, `Checked Out`, `Closed`, `Cancelled`, and `No Show`
  (`docs/research/01-reference-architecture-danphe-marley.md:35-58`).
- The same section records Marley's encounter as patient + practitioner + date/time with
  `Open`, `Ordered`, `Completed`, and `Cancelled` states
  (`docs/research/01-reference-architecture-danphe-marley.md:44-46`).
- Danphe exposes separate appointment and visit controllers, including walk-in `NewVisit`
  and appointment conversion through `VisitFromOnlineAppointment`; this supports both entry
  paths rather than requiring every encounter to have an appointment (research §A,
  `docs/research/01-reference-architecture-danphe-marley.md:75-84`).
- The local patient table establishes text IDs, mandatory cascading `orgId`, timestamped
  rows, and org-leading keyset indexes (`packages/db/src/schema/patients.ts:19-63`). FKs do
  not prove tenancy; the practitioner schema requires handlers to verify referenced rows in
  the same org (`packages/db/src/schema/practitioners.ts:7-12`).
- [INFERENCE] Marley's scheduling distinctions are valuable in a mature booking operation,
  but they add transitions without enabling a day-one front-desk action. Its `Ordered` state
  describes downstream work, not whether an encounter itself is open or finished.

## Proposed change

Use `encounter` as the working term; the owner may choose `visit` at the decision point
below. Add two Drizzle tables in one generated migration (`bun run db:generate`, never a
hand-edited migration). The sketch deliberately uses text columns with database CHECKs so
invalid states are rejected below the router as well as by its transition guards.

```ts
export const appointments = pgTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["scheduled", "checked_in", "completed", "cancelled", "no_show"],
    })
      .notNull()
      .default("scheduled"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "appointments_status_check",
      sql`${table.status} in
      ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show')`,
    ),
    index("appointments_org_scheduled_idx").on(table.orgId, table.scheduledAt, table.id),
    index("appointments_org_patient_idx").on(
      table.orgId,
      table.patientId,
      table.scheduledAt.desc(),
    ),
  ],
);

export const encounters = pgTable(
  "encounters",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["open", "completed", "cancelled"] })
      .notNull()
      .default("open"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("encounters_status_check", sql`${table.status} in ('open', 'completed', 'cancelled')`),
    check(
      "encounters_completion_check",
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    index("encounters_org_started_idx").on(table.orgId, table.startedAt.desc(), table.id.desc()),
    index("encounters_org_patient_idx").on(table.orgId, table.patientId, table.startedAt.desc()),
    uniqueIndex("encounters_org_appointment_idx").on(table.orgId, table.appointmentId),
  ],
);
```

The nullable unique appointment index allows many walk-in encounters while preventing two
encounters from consuming one appointment. Every create must prove patient, practitioner,
department, and optional appointment ownership with `eq(row.orgId, scope.orgId)`; a bare FK
is insufficient. Every read or status update also includes
`eq(table.orgId, scope.orgId)`, including lookups by ID. Migrations remain generated.

The proposed transition machines are:

```text
appointment:
  scheduled -> checked_in | cancelled | no_show
  checked_in -> completed | cancelled
  completed, cancelled, no_show -> terminal

encounter:
  open -> completed | cancelled
  completed, cancelled -> terminal
```

Compared with Marley's eight appointment states, keep `scheduled` (booking exists),
`checked_in` (patient is physically present), `completed` (front-desk lifecycle ended),
`cancelled`, and `no_show` (operationally distinct terminal outcomes). Drop `open` because it
is ambiguous beside an open encounter, drop `confirmed` until confirmation/reminder workflow
exists, and collapse `checked_out` plus `closed` into `completed`; two post-service terminal
states add no day-one action. For encounters, keep `open`, `completed`, and `cancelled`, but
drop Marley's `ordered`: orders will be child rows with their own status, not a phase that
prevents encounter completion.

Add dependency-free statements in `packages/auth/src/access.ts` and state every grant in
each role block. The working recommendation gives all existing org members the same clinical
surface, matching today's patient grants; the owner can narrow this when clinical roles exist.

```ts
appointment: ["create", "read", "update"],
encounter: ["create", "read", "update"],

// member, admin, and owner — repeated explicitly in each role
appointment: ["create", "read", "update"],
encounter: ["create", "read", "update"],
```

Expose these initial procedures, all through `orgProcedure(permission, input)`:

```ts
appointment.create; // { appointment: ["create"] }
appointment.list; // { appointment: ["read"] }; keyset by scheduledAt + id
appointment.updateStatus; // { appointment: ["update"] }; guarded scoped UPDATE ... RETURNING
encounter.start; // { encounter: ["create"] }; appointmentId optional
encounter.get; // { encounter: ["read"] }
encounter.complete; // { encounter: ["update"] }; open -> completed only
encounter.cancel; // { encounter: ["update"] }; open -> cancelled only
```

`appointment.create` and `encounter.start` validate every referenced ID in scope inside the
mutation transaction. Starting from an appointment requires `checked_in`, creates at most one
encounter, and does not accept patient or practitioner values that disagree with that
appointment. Status handlers issue one scoped conditional update rather than select-then-write;
invalid transitions fail loud. Because these rows contain patient data, successful create and
status mutations insert the compliance audit row inside the same transaction. Read operations
do not emit audit events.

Add compact base-lyra screens under the existing org-scoped front-desk area:

- `apps/web/src/routes/org/$orgSlug/front-desk/appointments.tsx`: date queue, create form,
  check-in, cancel, and no-show actions.
- `apps/web/src/routes/org/$orgSlug/front-desk/encounters.$encounterId.tsx`: encounter summary,
  completion, and cancellation actions.
- Extend `apps/web/src/routes/org/$orgSlug/front-desk/index.tsx` with “Start walk-in” and
  checked-in appointment entry points.

Every call passes `orgSlug`, uses the singleton `orpc`, and includes the tenant in query and
invalidation keys. A tenancy integration test must cover cross-org invisibility, concurrent
org claims, foreign-org rejection, and immediate removed-member rejection for both routers.

## What we are NOT doing

- No recurrence, waitlists, reminders, overbooking, slot capacity, or practitioner calendars;
  none is required to record the first front-desk lifecycle.
- No `confirmed`, `open`, `checked_out`, or `closed` appointment compatibility aliases; a clean
  cutover avoids two meanings for the same stage.
- No encounter `ordered` state; doc 03 owns order lifecycle and an encounter can have zero or
  many orders without changing its own state.
- No consult-fee insertion in these router hooks unless decision point 4 explicitly pulls the
  doc 04 charge contract forward.
- No clinical notes, diagnosis, prescriptions, observations, billing fields, or delete paths;
  later domains reference the encounter rather than expanding this table.
- No FHIR API or claim of FHIR conformance; `encounter` is domain vocabulary, not an
  interoperability layer (research limitations,
  `docs/research/01-reference-architecture-danphe-marley.md:126-138`).

## Decision points

1. **Should the domain be named `visit` or `encounter`?** Options: (a) `visits`, matching the
   existing department and consult-fee comments; or (b) `encounters`, matching Marley/FHIR
   vocabulary and the working contracts. **Recommendation: `encounters`.** It distinguishes a
   clinical episode from an appointment and aligns the donor model; update the stale “visits”
   comments when implemented rather than preserving terminology solely because it was
   anticipated in `packages/db/src/schema/departments.ts:5-8`.

2. **Are appointments day-one, or should front desk start only walk-in encounters?** Options:
   (a) ship both tables and both paths; (b) defer appointments and start every encounter
   directly; or (c) require an appointment. **Recommendation: (a).** Danphe exposes both
   `NewVisit` and appointment-to-visit conversion (research §A,
   `docs/research/01-reference-architecture-danphe-marley.md:80-82`), while the nullable
   appointment link keeps walk-ins first-class without making scheduling mandatory.

3. **Which states survive the trim, and is encounter `ordered` needed before orders exist?**
   Options: (a) the proposed five appointment and three encounter states; (b) copy Marley's
   full eight/four; or (c) add `ordered` only when doc 03 lands. **Recommendation: (a), with no
   later `ordered`.** Confirmation and separate checkout/close stages have no current action,
   and order presence belongs to child-order queries. Adding `ordered` before orders exist
   creates an unprovable transition and later creates synchronization coupling.

4. **Should encounter creation auto-create the consult-fee charge here or defer to doc 04?**
   Options: (a) make `encounter.start` atomically insert a charge now; or (b) defer the producer
   until doc 04 defines charge identity, pricing snapshot, status, and idempotency.
   **Recommendation: (b).** The practitioner comment explicitly anticipates a visit-time
   snapshot (`packages/db/src/schema/practitioners.ts:27-28`), but implementing it before the
   single charges contract is approved would couple clinical lifecycle to an unsettled billing
   shape. Doc 04 should add the atomic producer at this seam.

5. **Can one appointment create more than one encounter?** Options: (a) enforce one with the
   proposed nullable unique index; or (b) allow repeats for reopened/rescheduled care.
   **Recommendation: (a).** Retries and double-clicks must not create duplicate clinical
   episodes; a genuinely new episode should receive a new appointment or be a walk-in.

6. **Who receives the new permissions initially?** Options: (a) grant create/read/update to
   member, admin, and owner like `patient`; or (b) reserve mutations to admin/owner pending
   clinical roles. **Recommendation: (a).** It preserves the current explicit role model and
   lets front-desk members operate; narrower receptionist/clinician roles should be proposed as
   a coherent authorization change rather than inferred from generic membership.

## Rough size

L — two schema files plus exports, one generated migration, two permission statements across
three role blocks, two routers plus registration, three front-desk route changes, transactional
audit writes, and tenancy/lifecycle integration coverage.
