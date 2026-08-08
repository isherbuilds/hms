# 03 — Generic clinical orders

Status: DEFERRED — revisit after v0. Orders are not part of paper prescription capture; if a
future workflow adopts this proposal, retain the denormalized `category` and the
expected-current-state predicate on cancellation.
Depends on: 02
Blocks: 04

## Problem

The application has no order domain after the front-desk flow: the local router and permission
surfaces stop at patients, catalog, and staff
(`docs/research/01-reference-architecture-danphe-marley.md:87-105`). Creating separate lab,
radiology, and procedure order tables would repeat lifecycle and billing logic, reproducing the
cross-module synchronization problem in Danphe's `VisitBL` rather than giving all modalities one
clinical contract (`docs/research/01-reference-architecture-danphe-marley.md:75-85`).

## Evidence

- Research §A identifies Marley's `service_request` as its generic order. Its `template_dt` and
  `template_dn` dynamically identify the orderable template, while `order_group` links the
  encounter and `billing_status` remains explicit
  (`docs/research/01-reference-architecture-danphe-marley.md:35-52`). **Inference:** our typed
  equivalent is an `orders.catalogItemId` FK, because the catalog is already the single registry
  for priced services.
- Marley's request materializes modality-specific `Lab Test`, `Clinical Procedure`, or
  `Observation` records instead of making those records the request itself
  (`docs/research/01-reference-architecture-danphe-marley.md:47-52`). **Inference:** future
  execution-detail tables should reference `orderId`; they should not duplicate who ordered what,
  its encounter, or its shared lifecycle.
- The local catalog already defines `consultation | procedure | lab | radiology | other` and
  enforces that category set (`packages/db/src/schema/catalog-items.ts:15-23,30-54`). It also
  soft-deactivates items so historical references do not dangle
  (`packages/db/src/schema/catalog-items.ts:25-48`).
- Clinical and billing progress are independent. Marley stores `service_request.billing_status`,
  and can gate execution on payment, while Danphe hand-synchronizes requisition billing state
  across lab and radiology in visit code
  (`docs/research/01-reference-architecture-danphe-marley.md:47-52,75-85`). **Inference:** an order
  may be clinically cancelled after being charged, completed while charging is pending, or waived
  without changing its clinical result; one status field cannot represent those combinations.
- Research improvement #2 explicitly recommends one generic table with encounter, patient,
  catalog, category, clinical status, billing status, practitioner, and order time
  (`docs/research/01-reference-architecture-danphe-marley.md:153-164`).

## Proposed change

Use `encounter` as the working name from proposal 02; if proposal 02 chooses `visit`, rename the
FK and relation consistently. Add one org-scoped table and keep modality-specific execution data
outside it:

```ts
export const ORDER_STATUSES = ["ordered", "in_progress", "completed", "cancelled"] as const;
export const ORDER_BILLING_STATUSES = ["pending", "charged", "waived"] as const;

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    catalogItemId: text("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    category: text("category", { enum: CATALOG_CATEGORIES }).notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("ordered"),
    billingStatus: text("billing_status", { enum: ORDER_BILLING_STATUSES })
      .notNull()
      .default("pending"),
    orderedByPractitionerId: text("ordered_by_practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "orders_category_check",
      sql`${table.category} in
      ('consultation', 'procedure', 'lab', 'radiology', 'other')`,
    ),
    check(
      "orders_status_check",
      sql`${table.status} in
      ('ordered', 'in_progress', 'completed', 'cancelled')`,
    ),
    check(
      "orders_billing_status_check",
      sql`${table.billingStatus} in
      ('pending', 'charged', 'waived')`,
    ),
    index("orders_org_encounter_ordered_idx").on(
      table.orgId,
      table.encounterId,
      table.orderedAt.desc(),
      table.id.desc(),
    ),
    index("orders_org_patient_ordered_idx").on(
      table.orgId,
      table.patientId,
      table.orderedAt.desc(),
      table.id.desc(),
    ),
  ],
);
```

`category` is copied from the selected catalog item at creation. The enum CHECK protects its
shape; the create transaction protects equality with the catalog row. A PostgreSQL CHECK cannot
safely enforce a cross-table equality. `patientId` is likewise a query projection: creation must
prove it equals the scoped encounter's patient. Every referenced encounter, patient, catalog item,
and practitioner lookup includes `eq(row.orgId, context.scope.orgId)`; IDs and practitioner
attribution never establish tenant scope.

The proposed clinical transitions are `ordered -> in_progress`, `ordered -> cancelled`,
`in_progress -> completed`, and `in_progress -> cancelled`. `completed` and `cancelled` are
terminal. Billing transitions are owned by proposal 04: `pending -> charged | waived`; a clinical
status transition never changes billing status. Illegal or stale transitions fail loudly.

Add the dependency-free statement in `packages/auth/src/access.ts`:

```ts
order: ["create", "read", "update"],
```

Explicitly grant those three actions in each current `member`, `admin`, and `owner` role, matching
the present patient grant shape (`packages/auth/src/access.ts:16-68`). This is a recommendation
under the current coarse role model, not a decision to pre-empt future clinical roles.

Expose the following through the registered `orders` router:

```ts
orders.create       orgProcedure({ order: ["create"] }, createOrderInput)
orders.list         orgProcedure({ order: ["read"] }, listOrdersInput)
orders.updateStatus orgProcedure({ order: ["update"] }, updateOrderStatusInput)
```

- `orders.create` runs one transaction. It proves the encounter is open and belongs to the scoped
  patient, and proves the catalog item and ordering practitioner are in the same org. The catalog
  item must be active. It derives `category`, sets both initial states, inserts the order, and
  inserts the compliance audit row in that same transaction.
- `orders.list` requires exactly one of `encounterId` or `patientId`, always adds
  `eq(orders.orgId, context.scope.orgId)`, and uses `(orderedAt, id)` keyset pagination.
- `orders.updateStatus` performs one scoped conditional `UPDATE ... RETURNING` whose predicate
  includes `orgId`, order ID, and the allowed current status. It updates `updatedAt` and inserts
  the patient-data audit row in the same transaction. A missing or stale row fails without a
  select-then-write race.

Add the compact order list and create/status controls under
`apps/web/src/routes/org/$orgSlug/encounters/$encounterId/orders.tsx`, using the `packages/ui`
base-lyra conventions. The route passes `orgSlug` in every call and tenant-specific cache key.
Future lab results, radiology reports, and procedure execution tables use a scoped `orderId` FK;
they do not become alternate order tables.

## What we are NOT doing

- No lab, radiology, or procedure execution-detail schema yet; those workflows need their own
  reviewed contracts and attach to an order when introduced.
- No medication prescribing in this table yet; Marley's separate `medication_request` indicates
  materially different dose, frequency, substitution, and dispense semantics
  (`docs/research/01-reference-architecture-danphe-marley.md:44-52`).
- No charge or invoice columns on `orders`; money is represented by proposal 04's `charges` rows,
  while `billingStatus` is only the order's charging workflow marker.
- No billing side effect inside `updateStatus`; that would recreate the clinical/billing lifecycle
  coupling explicitly rejected by research
  (`docs/research/01-reference-architecture-danphe-marley.md:187-196`).
- No generic polymorphic execution payload or JSON result blob; modality detail remains typed and
  hangs off `orderId`.

## Decision points

1. **When should an order produce a charge?** Options: auto-create a charge with the order; create
   one when the order completes; or require an explicit proposal 04 operation. **Recommendation:**
   create the order as `billingStatus: "pending"`, then let an explicit proposal 04 transaction
   create the charge and atomically mark it `charged`. Completion must not charge implicitly.
   This keeps pricing/waiver authorization in the billing domain, avoids Danphe-style lifecycle
   synchronization, and leaves a visible pending work queue. The owner must accept the operational
   risk that explicit charging requires a billing workflow rather than an invisible side effect.
2. **Should `category` be stored or always joined from catalog?** Options: join on every read, or
   denormalize the catalog category with an enum CHECK and creation-time scoped equality guard.
   **Recommendation:** denormalize it. Category drives modality queues and future detail-table
   dispatch, and preserving the ordered-as category prevents a later catalog edit from silently
   reclassifying historical work. The cost is one deliberate duplicate plus a transactional guard;
   the database CHECK validates the enum, not cross-table equality.
3. **Are medication orders included on day one?** Options: treat medication as another catalog
   category now, or exclude it until pharmacy exists. **Recommendation:** explicitly exclude it.
   Marley separates `medication_request` from `service_request`, and medication needs dosage,
   route, frequency, substitution, dispensing, and safety semantics absent here. Adding a thin
   medication-shaped category now would promise a workflow this table cannot represent.
4. **From which states may an order be cancelled?** Options: only from `ordered`, or from both
   `ordered` and `in_progress`. **Recommendation:** allow both non-terminal states, require the
   caller to supply the expected current status, and audit the transition transactionally. This
   supports stopping work already begun without permitting completed clinical records to be
   reopened; whether cancellation reasons become mandatory can be decided with the execution
   workflows rather than overloaded into free-text notes now.

## Rough size

M — touches `packages/db`, one generated migration, `packages/auth`, `packages/api`, the org-scoped
web route, and tenancy/integration coverage; one new route and one new table. Proposal 04 adds the
separate charge operation and billing-state transition.
