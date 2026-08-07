# 07 — Service units, beds, and occupancy

Status: DEFERRED — revisit at the IPD increment (2026-08-07: IPD/beds/ADT in v0's Out of
Scope; aligns with doc 02's naming decision when revived)
Depends on: 02 (encounters), 04 (charges)
Blocks: nothing

## Problem

The app currently stops at the front desk; beds, inpatient occupancy, and the clinical domains
needed to support them have no implementation (`docs/research/01-reference-architecture-danphe-marley.md:18-26`).
A flat bed list would not represent wards, rooms, or later non-bed locations, while putting
billing state directly on a bed would couple facility configuration to a stay. This is a
later-stage, directional proposal for when IPD lands, not an approved implementation spec.

## Evidence

- Marley models the facility as a parent-linked service-unit tree, with billing shape on the
  unit type and occupancy represented as check-in/check-out rows
  (`docs/research/01-reference-architecture-danphe-marley.md:59-66`).
- Marley's scheduler hook `add_occupied_service_unit_in_ip_to_billable` turns open occupancies
  into billables (`docs/research/01-reference-architecture-danphe-marley.md:64-66`). This proves
  nightly production is a real pattern, not that it is the right first implementation here.
- The research recommendation is a service-unit tree plus occupancy rows, with bed charges
  produced at discharge or by a nightly job
  (`docs/research/01-reference-architecture-danphe-marley.md:178-181`).
- Marley's billable entities ultimately point to one ERP item
  (`docs/research/01-reference-architecture-danphe-marley.md:67-70`). We should preserve that
  useful shape while using this repo's catalog as the single chargeable-item registry.
- [INFERENCE] Separate occupancy intervals retain bed history and make a transfer a pair of
  bounded state changes; a mutable `currentBedId` on the encounter would erase that history.

## Proposed change

Use three org-scoped tables. `service_unit_types` describes behavior and billing;
`service_units` is the facility tree; `occupancies` records immutable stay intervals. The
`encounter` name below is the working name owned by proposal 02 and may be renamed there.

```ts
export const serviceUnitTypes = pgTable(
  "service_unit_types",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isOccupiable: boolean("is_occupiable").default(false).notNull(),
    isBillable: boolean("is_billable").default(false).notNull(),
    catalogItemId: text("catalog_item_id"),
    billingBasis: text("billing_basis", { enum: ["per_day", "per_hour"] }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_unit_types_org_name_idx").on(table.orgId, table.name),
    uniqueIndex("service_unit_types_org_id_idx").on(table.orgId, table.id),
    // Requires catalog_items to expose a unique (orgId, id) key.
    foreignKey({
      columns: [table.orgId, table.catalogItemId],
      foreignColumns: [catalogItems.orgId, catalogItems.id],
      name: "service_unit_types_org_catalog_item_fk",
    }),
    check(
      "service_unit_types_billing_basis_check",
      sql`${table.billingBasis} is null or ${table.billingBasis} in ('per_day', 'per_hour')`,
    ),
    check(
      "service_unit_types_billable_shape_check",
      sql`(${table.isBillable} and ${table.catalogItemId} is not null and
          ${table.billingBasis} is not null) or
          (not ${table.isBillable} and ${table.catalogItemId} is null and
          ${table.billingBasis} is null)`,
    ),
  ],
);

export const serviceUnits = pgTable(
  "service_units",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    typeId: text("type_id").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_units_org_id_idx").on(table.orgId, table.id),
    uniqueIndex("service_units_org_parent_name_idx").on(table.orgId, table.parentId, table.name),
    index("service_units_org_parent_idx").on(table.orgId, table.parentId),
    foreignKey({
      columns: [table.orgId, table.parentId],
      foreignColumns: [table.orgId, table.id],
      name: "service_units_org_parent_fk",
    }),
    foreignKey({
      columns: [table.orgId, table.typeId],
      foreignColumns: [serviceUnitTypes.orgId, serviceUnitTypes.id],
      name: "service_units_org_type_fk",
    }),
  ],
);

export const occupancies = pgTable(
  "occupancies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    serviceUnitId: text("service_unit_id").notNull(),
    encounterId: text("encounter_id").notNull(),
    checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
    checkOut: timestamp("check_out", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.serviceUnitId],
      foreignColumns: [serviceUnits.orgId, serviceUnits.id],
      name: "occupancies_org_service_unit_fk",
    }),
    // Proposal 02 must expose a unique (orgId, id) key for this tenant-safe FK.
    foreignKey({
      columns: [table.orgId, table.encounterId],
      foreignColumns: [encounters.orgId, encounters.id],
      name: "occupancies_org_encounter_fk",
    }),
    check(
      "occupancies_checkout_after_checkin_check",
      sql`${table.checkOut} is null or ${table.checkOut} > ${table.checkIn}`,
    ),
    // At most one open encounter may hold a service unit, even under concurrent check-in.
    uniqueIndex("occupancies_one_open_per_unit_idx")
      .on(table.orgId, table.serviceUnitId)
      .where(sql`${table.checkOut} is null`),
    // An encounter cannot occupy two units at once; transfers close then open in one transaction.
    uniqueIndex("occupancies_one_open_per_encounter_idx")
      .on(table.orgId, table.encounterId)
      .where(sql`${table.checkOut} is null`),
    index("occupancies_org_encounter_history_idx").on(
      table.orgId,
      table.encounterId,
      table.checkIn.desc(),
    ),
  ],
);
```

The composite `catalogItemId` foreign key requires `catalog_items` to expose a unique
`(orgId, id)` key. Creation and update still query the item with
`eq(catalogItems.orgId, context.scope.orgId)`; the database constraint is defense in depth.
All migrations are generated with `bun run db:generate`, never hand-edited.

Add dependency-free permission statements in `packages/auth/src/access.ts`:

```ts
serviceUnit: ["create", "read", "update"],
occupancy: ["create", "read", "update"],
```

`owner` and `admin` explicitly receive every listed grant. The initial recommendation is that
`member` receives `serviceUnit: ["read"]` and `occupancy: ["create", "read", "update"]`, so
clinical staff can perform ADT work but cannot reconfigure the facility tree. Owner review must
confirm whether the broad `member` role is acceptable before implementation.

Add the following procedure-to-permission contracts:

```ts
serviceUnitType.list; // orgProcedure({ serviceUnit: ["read"] }, ...)
serviceUnitType.create; // orgProcedure({ serviceUnit: ["create"] }, ...)
serviceUnitType.update; // orgProcedure({ serviceUnit: ["update"] }, ...)
serviceUnit.tree; // orgProcedure({ serviceUnit: ["read"] }, ...)
serviceUnit.create; // orgProcedure({ serviceUnit: ["create"] }, ...)
serviceUnit.update; // orgProcedure({ serviceUnit: ["update"] }, ...)
occupancy.listOpen; // orgProcedure({ occupancy: ["read"] }, ...)
occupancy.checkIn; // orgProcedure({ occupancy: ["create"] }, ...)
occupancy.transfer; // orgProcedure({ occupancy: ["update"] }, ...)
occupancy.checkOut; // orgProcedure({ occupancy: ["update"] }, ...)
```

Every lookup or mutation includes `eq(table.orgId, context.scope.orgId)`, including parent,
type, catalog item, encounter, and occupancy lookups. `checkIn` rejects inactive units and
types where `isOccupiable` is false. The partial unique indexes are the concurrency authority;
a conflict fails loudly rather than selecting a different bed.

`transfer` closes the current row and opens the destination row in one transaction.
`checkOut` (or proposal 02's encounter-discharge orchestration) closes the final occupancy and,
for a billable type, inserts a doc-04 charge with `sourceType: "occupancy"`,
`sourceId: occupancy.id`, and the type's `catalogItemId`. The initial direction is one charge
computed at discharge. A later nightly producer may improve long-stay visibility, but it needs
an explicit idempotency/period contract in proposal 04 before it can safely create repeated
rows.

Facility configuration mutations emit fire-and-forget `audit()` events. Check-in, transfer,
and check-out change patient-location history, so their `auditLog` rows are inserted inside the
same transaction as occupancy changes. At-discharge charge creation and its audit row are in
that transaction as well; a charge or audit failure rolls back the discharge rather than
leaving contradictory state.

Add compact, zero-radius org pages under
`apps/web/src/routes/org/$orgSlug/facility.tsx` (type and tree configuration) and
`apps/web/src/routes/org/$orgSlug/ipd.tsx` (open occupancy board and ADT actions). Both use the
singleton oRPC client, pass `orgSlug` on every call, and key invalidation by tenant.

## What we are NOT doing

- No generic FHIR `Location` model: the current need is facility hierarchy and occupancy, not
  interoperability metadata.
- No fixed ward/bed tables: separate tables make later room, theatre, chair, or bay hierarchy
  changes needlessly expensive.
- No mutable `encounter.currentBedId`: it loses interval history and weakens transfer auditing.
- No scheduler in the first slice: discharge-time production covers completed stays without a
  new operations subsystem.
- No rates copied onto service-unit types: `catalog_items` remains the single chargeable-item
  registry, and charges snapshot price under proposal 04.
- No silent repair of overlapping stays or broken trees: integrity conflicts fail loudly.

## Decision points

1. **How deep may the facility tree be?** Options: a free-form `parentId` tree, or fixed
   ward → bed rows. **Recommendation: free-form tree, while initially allowing occupancy only
   on units whose type is the configured `Bed` type (`isOccupiable = true`).** This matches
   Marley's proven parent-link shape, accommodates ward → room → bed without a migration, and
   still keeps the check-in rule narrow. Owner must decide whether multiple occupiable types
   (for example chair or bay) are allowed from day one.
2. **When are bed charges produced?** Options: one charge at discharge, or nightly accrual for
   every open occupancy. **Recommendation: at discharge first; add a nightly job only when
   long-stay provisional visibility is an observed billing need.** Discharge is simpler and
   naturally idempotent per occupancy. Nightly accrual matches Marley's scheduler and exposes
   long stays earlier, but requires retry-safe period identity, correction rules, and job
   operations that the current app does not otherwise need.
3. **Do ADT transfers need their own record?** Options: a first-class `transfers` table, or
   close the old occupancy and open the next one atomically. **Recommendation: occupancy rows
   only.** The two intervals already preserve from/to unit and time; the transactional audit
   event records actor and intent. Add a transfer entity only if workflows later require a
   requested/approved/in-transit state, cancellation, or transport ownership.
4. **What exactly does `per_day` mean?** Options: elapsed 24-hour blocks, hospital-local
   calendar days, or configurable cutoff rules; `per_hour` likewise needs a rounding rule.
   **Recommendation: elapsed duration with a documented rounding rule for the first release,
   stored as the charge quantity.** It is deterministic without introducing facility calendars;
   owner review must choose floor/ceiling/minimum quantity before implementation.
5. **Who may perform ADT actions?** Options: all `member` users, administrators only, or a new
   dedicated role. **Recommendation: retain existing roles and grant occupancy actions to
   `member` initially.** A new role would be speculative, but the owner should restrict this if
   non-clinical members commonly share an organization.

## Rough size

L — later-stage/directional. Touches `packages/db` (one generated migration with three tables
and supporting tenant-safe keys), `packages/auth`, `packages/api`, `apps/web`, and tenancy/
transaction integration coverage; adds two org routes. Nightly accrual is explicitly outside
the initial size.
