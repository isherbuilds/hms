# 04 — First-class charges and billing seam

Status: REJECTED — superseded by spec Slices 5–6 (2026-08-07: spec already defines
first-class snapshot charges with `sourceType consult_fee|order|manual`, `pending|invoiced|voided`,
`invoiceId`, and one-transaction invoice issuance; `occupancy` becomes an additive enum value
if doc 07 is ever scheduled)
Depends on: 02 (encounter), 03 (order source)
Blocks: nothing

## Problem

Billable events have no durable representation after the catalog price is selected. The local
catalog and practitioner schemas anticipate snapshot pricing and an automatic consultation
charge, but no charge domain or permission exists
(`packages/db/src/schema/catalog-items.ts:25–28`,
`packages/db/src/schema/practitioners.ts:27–28`,
`docs/research/01-reference-architecture-danphe-marley.md:89–101`). Without a first-class row,
invoicing would have to rediscover billable clinical events and join their current catalog
prices, making billing both coupled and historically unstable.

## Evidence

- Marley must enumerate six sources—appointments, encounters, labs, procedures, inpatient
  occupancies, and service requests—in `get_healthcare_services_to_invoice` before normalizing
  invoice lines. The research concludes that one `charges` table makes invoicing one query
  (`docs/research/01-reference-architecture-danphe-marley.md:67–70,165–169`).
- Danphe's `VisitBL.cs` synchronizes requisition billing state across modules. The research
  identifies that coupling as the counter-example and argues for one billing seam
  (`docs/research/01-reference-architecture-danphe-marley.md:80–85,161–169`).
- The catalog already stores `unitPrice` as `numeric(12,2)` and `taxRatePercent` as
  `numeric(4,2)`. Its comment explicitly says charges snapshot both values so later catalog
  edits cannot reprice history (`packages/db/src/schema/catalog-items.ts:25–28,41–43`).
- The practitioner schema already names the first producer: the practitioner's catalog item is
  snapshotted into an automatic consultation-fee charge when a visit is created
  (`packages/db/src/schema/practitioners.ts:27–28`). The working name here is `encounter`,
  subject to the naming decision in proposal 02.
- [INFERENCE] A normalized charge ledger keeps clinical producers independent of the future
  invoice lifecycle: producers insert charges; invoicing consumes eligible charge rows.

## Proposed change

Add an org-scoped `charges` table. This sketch shows the recommended status-flip void model;
the nullable encounter and money representation remain owner decisions below.

```ts
export const CHARGE_SOURCE_TYPES = ["consultation", "order", "occupancy", "manual"] as const;
export const CHARGE_STATUSES = ["pending", "invoiced", "void"] as const;

export const charges = pgTable(
  "charges",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: text("encounter_id").references(() => encounters.id),
    catalogItemId: text("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    sourceType: text("source_type", { enum: CHARGE_SOURCE_TYPES }).notNull(),
    sourceId: text("source_id"),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    unitPriceAtCharge: numeric("unit_price_at_charge", {
      precision: 12,
      scale: 2,
    }).notNull(),
    taxRateAtCharge: numeric("tax_rate_at_charge", {
      precision: 4,
      scale: 2,
    }).notNull(),
    status: text("status", { enum: CHARGE_STATUSES }).notNull().default("pending"),
    voidReason: text("void_reason"),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("charges_source_type_check", sql`${table.sourceType} in (...)`),
    check("charges_status_check", sql`${table.status} in ('pending', 'invoiced', 'void')`),
    check("charges_qty_check", sql`${table.qty} > 0`),
    check("charges_unit_price_check", sql`${table.unitPriceAtCharge} >= 0`),
    check(
      "charges_tax_rate_check",
      sql`${table.taxRateAtCharge} >= 0 and ${table.taxRateAtCharge} <= 99.99`,
    ),
    check("charges_void_metadata_check", sql`/* void iff reason/by/at are present */`),
    index("charges_org_patient_created_idx").on(
      table.orgId,
      table.patientId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("charges_org_encounter_created_idx").on(
      table.orgId,
      table.encounterId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("charges_org_status_created_idx").on(
      table.orgId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
```

`unitPriceAtCharge`, `taxRateAtCharge`, and `description` are copied from the catalog item in
the same transaction that creates the charge. They are never derived by a live catalog join
when reading totals or preparing an invoice. Catalog price, tax, name, or active-state changes
therefore cannot rewrite an existing money row. Every referenced patient, encounter, catalog
item, and concrete source is verified against `context.scope.orgId` before insertion; the
polymorphic `sourceId` cannot provide that guarantee through a foreign key.

Add `charge: ["create", "read", "void"]` only in `packages/auth/src/access.ts`. The proposed
explicit grants are owner/admin `create, read, void` and member `create, read`; this lets staff
produce and inspect charges while reserving correction of money rows for administrators.

Register a `charge` router with these procedures:

- `charge.list` — `orgProcedure({ charge: ["read"] }, ...)`; keyset-list by patient and
  optionally encounter, always including `eq(charges.orgId, context.scope.orgId)`.
- `charge.createManual` — `orgProcedure({ charge: ["create"] }, ...)`; validate the patient,
  optional encounter, and catalog item in the same org, then snapshot catalog fields and insert
  a `manual` pending charge in one transaction.
- `charge.void` — `orgProcedure({ charge: ["void"] }, ...)`; one scoped
  `UPDATE ... WHERE org_id = scope.orgId AND id = input.id AND status = 'pending' RETURNING`,
  requiring a non-empty reason. Insert the compliance audit row inside that same transaction;
  a missing or non-pending row fails loud and no charge is deleted.

The first non-manual producer is `encounter.create`: after resolving the practitioner's
`consultFeeItemId` within the org, it inserts one `consultation` charge in the encounter
transaction and snapshots the catalog values. The encounter procedure must require both
`encounter:create` and `charge:create`; absence of a configured consult-fee item means no fee,
while an invalid or cross-org configured item is a data-integrity error, not a silent fallback.
Proposal 03's order producer follows the same seam with `sourceType: "order"` and the order ID.

Add a compact charge list to the existing patient detail route at
`apps/web/src/routes/org/$orgSlug/front-desk/patients.$patientId.tsx`, and show the same list in
the encounter view from proposal 02. It displays description, quantity, snapshotted unit price,
tax, status, and created time; the void action is permission-gated. It uses `packages/ui`
base-lyra conventions and includes `orgSlug` in every query, mutation, and invalidation key.

The next billing step would add an `invoices` header and `invoice_lines` rows with an immutable,
unique `chargeId` reference, then atomically move selected charges from `pending` to `invoiced`.
That is only a boundary sketch: invoice numbering, payment, credit notes, invoice permissions,
schemas, routers, routes, and migrations are explicitly outside this proposal. Charges must
land first so invoice creation consumes one stable source instead of six clinical domains.

## What we are NOT doing

- No invoice or invoice-line implementation; their lifecycle and numbering need a separate
  proposal after charges exist.
- No payment, settlement, refund, insurance, or accounting ledger model; none is required to
  establish the producer-to-charge seam.
- No live catalog joins for historical price, tax, or description; that would permit catalog
  edits to rewrite money history.
- No deleting or editing charge economics after creation; corrections use the chosen void
  model, and invoiced-charge correction belongs with the future invoice design.
- No per-source charge tables or six-doctype invoice aggregator; both recreate the coupling
  this proposal removes.
- No generic billing-hook framework; encounter and order producers call the narrow charge
  insertion seam directly.
- No hand-written migration; the accepted schema would be generated with `bun run db:generate`.

## Decision points

1. **How should money be represented?** Options: (a) `numeric(12,2)` for unit price plus
   `numeric(4,2)` for tax rate, matching the catalog; or (b) integer minor units for price,
   deliberately migrating/converting the catalog boundary. **Recommendation: (a).** PostgreSQL
   `numeric` is exact, existing prices already use it, and consistency avoids conversion and
   rounding rules in the first billing slice. Choosing integers should be a deliberate catalog
   migration, not a mixed representation introduced only for charges.
2. **How should a charge be voided?** Options: (a) atomically flip `pending` to `void`, record
   required `voidReason`, `voidedBy`, and `voidedAt`, and insert the audit row in the same
   transaction; or (b) keep the original row unchanged and append a negative reversal charge.
   **Recommendation: (a).** It is simpler before invoices/payments exist, preserves the original
   economics and correction evidence, and avoids negative-quantity semantics. Reversal/credit
   rows should be decided with invoice corrections, where double-entry behavior has context.
3. **May a charge exist without an encounter?** Options: (a) make `encounterId` nullable now,
   allowing patient-level manual charges and a later walk-in pharmacy sale; or (b) require an
   encounter until a real encounter-free producer lands. **Recommendation: (b).** The first
   producers—consultation and order—are encounter-bound, and the repo's YAGNI rule outweighs a
   hypothetical future workflow. If the owner chooses (b), add `.notNull()` to the sketch; the
   later migration to nullable is safe and explicit.
4. **What quantities must day one support?** Options: (a) decimal `numeric(12,3)` for fractional
   services/occupancy, or (b) positive integer quantities until such a producer exists.
   **Recommendation: (b).** Consultations and initial orders are countable units; accepting
   fractions early creates rounding questions without a current workflow. The schema sketch
   shows (a) only to surface the likely occupancy need; owner approval of (b) changes it to an
   integer with `qty > 0`.
5. **Who may create manual charges?** Options: (a) any member with `charge:create`, matching
   front-desk operation, or (b) owner/admin only while automatic producers use an internal
   path. **Recommendation: (a), with `void` reserved for owner/admin.** One permission covers
   both automatic and staff-entered producers without bypassing `orgProcedure`; audit and the
   immutable snapshot retain accountability. If manual entry is financially restricted in the
   target hospital, choose (b) and split its permission before implementation.

## Rough size

M — touches `packages/db` (one generated migration), `packages/auth`, `packages/api`, the
encounter transaction from proposal 02, the order producer from proposal 03, tenancy/integration
coverage, and two existing org-scoped patient/encounter views; no new top-level route.
