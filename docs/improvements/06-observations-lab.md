# 06 — Template-driven observations for lab

Status: DEFERRED — revisit when lab result entry is sold to the pilot (2026-08-07: in v0's
Out of Scope; reconcile the in-transaction-audit premise with the settled audit decision
before any build)
Depends on: 03 (orders)
Blocks: nothing

## Problem

The application has no order-result model after the front-desk layer; the current router surface
ends at patient, catalog, and staff (`docs/research/01-reference-architecture-danphe-marley.md:87-105`).
Lab is later-stage scope, and this document is deliberately directional rather than a settled spec.
Before lab lands, we should choose a result shape that preserves SQL constraints, indexing, and
amendment history without importing a full laboratory information system.

## Evidence

- Marley uses observation templates plus typed `result_*` columns selected by a permitted data
  type, rather than EAV or a result JSON blob
  (`docs/research/01-reference-architecture-danphe-marley.md` §A, lines 53-55).
- The same typed-column pattern sits within Marley's roughly 130-DocType clinical model. The
  research therefore treats it as a credible schema donor, not proof of workflow fit
  (`docs/research/01-reference-architecture-danphe-marley.md:14-26,126-138`).
- Marley's ten-state result lifecycle includes operational states we do not yet need. Its relevant
  integrity states are preliminary, final, and amended; its submitted clinical documents become
  append-only (`docs/research/01-reference-architecture-danphe-marley.md:53-55,71-73`).
- The local catalog already distinguishes lab items and is intended as the chargeable-item
  registry (`packages/db/src/schema/catalog-items.ts`, summarized in the research doc at
  lines 97-101). A template can therefore link to `catalogItemId` without a second item master.
- [INFERENCE] A local `resultType` snapshot on each observation is necessary because a PostgreSQL
  `CHECK` cannot inspect the linked template row. A same-org composite foreign key can ensure the
  snapshot agrees with the template while the row-local `CHECK` enforces the populated value.

## Proposed change

This is a directional Drizzle-style shape. Both tables use text primary keys, `orgId NOT NULL`
with organization cascade, and timezone-aware `createdAt`/`updatedAt`. Cross-domain foreign keys
are same-org composite references so a patient, order, template, or amended result from another
organization cannot be attached accidentally.

```ts
const resultTypes = ["numeric", "text", "boolean", "select"] as const;
const observationStatuses = ["preliminary", "final", "amended"] as const;

export const observationTemplates = pgTable(
  "observation_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    name: text("name").notNull(),
    resultType: text("result_type").notNull(),
    unit: text("unit"),
    referenceLow: numeric("reference_low"),
    referenceHigh: numeric("reference_high"),
    selectOptions: text("select_options").array(),
    catalogItemId: text("catalog_item_id"),
    createdByUserId: text("created_by_user_id").notNull(), // attribution, never scope
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "observation_template_result_type_check",
      sql`${t.resultType} in ('numeric', 'text', 'boolean', 'select')`,
    ),
    check(
      "observation_template_range_check",
      sql`${t.referenceLow} is null or ${t.referenceHigh} is null or
        ${t.referenceLow} <= ${t.referenceHigh}`,
    ),
    // CHECK: selectOptions is non-empty only for select; ranges/unit belong to numeric.
    // UNIQUE (orgId, id, resultType) supports the observation composite FK.
  ],
);

export const observations = pgTable(
  "observations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    patientId: text("patient_id").notNull(),
    orderId: text("order_id").notNull(),
    templateId: text("template_id").notNull(),
    resultType: text("result_type").notNull(), // immutable template type snapshot
    status: text("status").notNull().default("preliminary"),
    valueNumeric: numeric("value_numeric"),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    valueSelect: text("value_select"),
    amendsObservationId: text("amends_observation_id"),
    recordedByUserId: text("recorded_by_user_id").notNull(), // attribution only
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("observation_status_check", sql`${t.status} in ('preliminary', 'final', 'amended')`),
    check(
      "observation_typed_value_check",
      sql`
    (${t.resultType} = 'numeric' and ${t.valueNumeric} is not null and
      ${t.valueText} is null and ${t.valueBoolean} is null and ${t.valueSelect} is null) or
    (${t.resultType} = 'text' and ${t.valueNumeric} is null and
      ${t.valueText} is not null and ${t.valueBoolean} is null and ${t.valueSelect} is null) or
    (${t.resultType} = 'boolean' and ${t.valueNumeric} is null and
      ${t.valueText} is null and ${t.valueBoolean} is not null and ${t.valueSelect} is null) or
    (${t.resultType} = 'select' and ${t.valueNumeric} is null and
      ${t.valueText} is null and ${t.valueBoolean} is null and ${t.valueSelect} is not null)
  `,
    ),
    // Same-org FKs: patient, order, (templateId, resultType), and amendsObservationId.
    // UNIQUE (orgId, amendsObservationId) prevents two amendment successors.
    index("observations_org_order_idx").on(t.orgId, t.orderId, t.createdAt, t.id),
    index("observations_org_numeric_idx").on(t.orgId, t.templateId, t.valueNumeric),
  ],
);
```

The linked order is the panel boundary: a CBC order may have many flat observation rows. The
router verifies that order, patient, template, and catalog linkage agree within the scoped
organization. It also validates `valueSelect` against the template's text-array options. Every
query, including lookups by ID, includes `eq(observations.orgId, scope.orgId)` (and the equivalent
template predicate); `recordedByUserId` and `createdByUserId` never establish scope.

Add one dependency-free permission statement in `packages/auth/src/access.ts`:

```ts
observation: ["read", "create", "finalize", "amend", "manage_templates"];

member: {
  observation: ["read", "create", "finalize", "amend"];
}
admin: {
  observation: ["read", "create", "finalize", "amend", "manage_templates"];
}
owner: {
  observation: ["read", "create", "finalize", "amend", "manage_templates"];
}
```

The working router surface is `list`, `byOrder`, `createPreliminary`, `updatePreliminary`,
`finalize`, `amend`, `listTemplates`, `createTemplate`, and `updateTemplate`. Each is declared via
`orgProcedure()` with the matching permission string. Scoped updates include
`status = 'preliminary'` in the mutation predicate: `preliminary -> final` is the only in-place
transition. The ten-state Marley machine is intentionally trimmed because registration and order
queueing belong to orders, cancellation belongs to the order, and result integrity only needs a
working state, a signed state, and an explicit correction state.

A final row is immutable. `amend` inserts a new immutable row with `status = 'amended'` and
`amendsObservationId` pointing to the preceding final or amended row; it never edits or relabels
the predecessor. The chain head is the effective result, while every prior clinical statement
remains queryable. Predecessor validation, successor insertion, and an `auditLog` insert occur in
the same transaction because this is patient data. Template mutations use fire-and-forget
`audit()`; result creation, finalization, and amendment use the transactional audit path.

The later org UI would live at `apps/web/src/routes/org/$orgSlug/lab.tsx` for pending/completed
orders and `apps/web/src/routes/org/$orgSlug/lab/$orderId.tsx` for entry and review. It uses the
singleton oRPC client and compact, zero-radius `packages/ui` components; no separate lab API
surface is proposed.

## What we are NOT doing

- **No EAV result table.** Splitting `(attribute, value)` across rows loses type-specific database
  constraints, complicates reference-range comparisons, and makes common result indexes indirect.
- **No JSON result blob.** JSON can hold heterogeneous values, but cannot express the same simple
  exactly-one-typed-value invariant, efficient numeric indexes, or direct low/high comparisons.
  `selectOptions` is template metadata stored as a text array, not a patient-result blob.
- **No full laboratory information system.** Specimen accessioning, analyzers, work queues,
  external lab interfaces, and diagnostic reports need workflow evidence before they are added.
- **No copy of Marley's ten statuses.** States owned by ordering, billing, or queue workflows do
  not belong on the result row in the first lab slice.
- **No in-place correction of final data.** Overwriting destroys who asserted what and defeats the
  compliance value of transactional audit history.

## Decision points

1. **How should panels be represented?** Options: (a) flat observations sharing one `orderId`, or
   (b) add a panel/report grouping table immediately. **Recommendation: (a), flat plus order
   grouping.** It answers CBC-style panels without another lifecycle. Marley's
   `diagnostic_report` wrapper remains a compatible later option if sign-off, narrative findings,
   or report-level delivery cannot be represented by the order.
2. **Who authors templates?** Options: (a) a fixed centrally seeded library, (b) organization-
   defined templates only, or (c) organization-defined templates with a starter seed copied into
   each organization. **Recommendation: (c).** Local units, names, and ranges vary, while a small
   starter set avoids a blank first-run experience and leaves ownership with the tenant.
3. **How rich are reference ranges initially?** Options: (a) one optional low/high pair on the
   template, or (b) a child range table keyed by sex, age band, and other conditions.
   **Recommendation: (a).** It supports basic flagging with enforceable numeric columns. A later
   `observation_reference_ranges` table can reference the template without changing observation
   values or amendment history when real age/sex-dependent requirements appear.
4. **Can a used template's clinical meaning change?** Options: (a) mutate result type, unit,
   options, and ranges in place, or (b) freeze semantic fields after first use and clone a new
   template version. **Recommendation: (b).** Historical values otherwise acquire a new meaning;
   the composite type foreign key also makes result-type mutation fail loudly. Display-name-only
   edits may remain allowed.
5. **Are the current organization roles sufficient for lab authorization?** Options: (a) use the
   explicit member/admin/owner grants above, or (b) first introduce laboratory-specific roles.
   **Recommendation: (a) for the first slice, subject to owner review.** The repo currently defines
   only these three roles (`packages/auth/src/access.ts:33-68`); adding a clinical role system
   before a proven workflow would be speculative. The separate `finalize` and `amend` actions
   preserve a clean migration path if finer roles become necessary.

## Rough size

L — later-stage clinical slice touching `packages/db`, `packages/auth`, `packages/api`, `apps/web`,
and tenancy/integration tests; one generated migration with two tables, two org routes, one router,
and transactional patient-data audit paths.
