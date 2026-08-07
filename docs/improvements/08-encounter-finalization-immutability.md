# 08 — Encounter finalization immutability

Status: DEFERRED — revisit together with doc 02 (2026-08-07: premise requires in-transaction
audit, contradicting the settled fire-and-forget decision; v0's critical immutability already
holds by construction — issued invoices have no update path, invoiced charges immutable,
signed notes take addenda only)
Depends on: 02
Blocks: nothing

## Problem

The proposed encounter, order, charge, and observation domains need one finalization boundary;
without it, a completed clinical record could still be rewritten by an ordinary child mutation.
The current repo has no encounter or child-domain router in which to enforce that boundary
(`docs/research/01-reference-architecture-danphe-marley.md:89-101`). Patient data also requires
an audit entry that commits atomically with the mutation, rather than the default asynchronous
audit path (`AGENTS.md:34`; `docs/contributing/architecture/audit.md:42-48`).

## Evidence

- Marley encounters have an explicit `Completed` status, and its clinical DocTypes are
  submittable: `docstatus` makes the submitted document append-only
  (`docs/research/01-reference-architecture-danphe-marley.md` §A, lines 44-55 and 71-73).
- Research improvement #7 maps that behavior to status-guarded read-only encounters and calls
  for the completion audit entry to share the mutation transaction
  (`docs/research/01-reference-architecture-danphe-marley.md:182-185`).
- Marley models final observation corrections as an `Amended` state rather than treating a
  final result as ordinary editable content (research doc §A, lines 53-55). The proposed doc 06
  contract sharpens this into an append-only amendment row. [INFERENCE: this preserves the
  clinically relevant predecessor while making the correction explicit.]
- ADR 0008 deliberately keeps tenant enforcement in application code so HTTP, SSR, and tests
  share one guard (`docs/contributing/decisions/0008-app-level-isolation.md:19-29`). A router
  helper follows that precedent; a trigger would introduce a second enforcement convention.
- The audit architecture reserves in-transaction `auditLog` inserts for patient records where
  the domain write and evidence must exist together
  (`docs/contributing/architecture/audit.md:42-48`).

## Proposed change

Treat `completed` as a clinical-content finalization boundary. Doc 02 owns the encounter table
and exact naming (including whether `encounter` becomes `visit`); its relevant schema contract
should remain a text status with a database CHECK, not a free-form string:

```ts
export const encounters = pgTable(
  "encounters",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"open" | "ordered" | "completed" | "cancelled">()
      .notNull()
      .default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: text("completed_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "encounters_status_check",
      sql`${table.status} in ('open', 'ordered', 'completed', 'cancelled')`,
    ),
  ],
);
```

Add one shared helper in `packages/api`, named
`assertEncounterOpenForMutation(tx, orgId, encounterId)`. It must query with both encounter ID
and `eq(encounters.orgId, orgId)`, take a row lock inside the caller's transaction, return
`NOT_FOUND` when the scoped encounter does not exist, and throw a loud oRPC `CONFLICT` when the
encounter is `completed`. Under the doc 02 state machine, `cancelled` is also terminal; `open`
and `ordered` are the mutable states. The message should direct the caller to an explicit
amendment or void procedure rather than imply that retrying can work.

All ordinary encounter mutations and encounter-child mutations run in a transaction and call
the helper before their write. The lock matters: `encounter.complete` must lock the same
encounter row, so a child write cannot pass the check concurrently and commit after completion.
This is a shared domain guard, not copied status logic in each router.

```ts
await db.transaction(async (tx) => {
  await assertEncounterOpenForMutation(tx, context.scope.orgId, input.encounterId);
  // The child UPDATE/INSERT still includes eq(child.orgId, context.scope.orgId).
  await mutateChild(tx, input);
});
```

The affected permission and procedure contracts are:

- Doc 02 adds `"complete"` to `encounter: ["create", "read", "update", "complete"]`.
  `encounter.update` and any status mutation other than completion call the helper;
  `encounter.complete` uses `orgProcedure({ encounter: ["complete"] }, input)`. `member`,
  `admin`, and `owner` state that grant explicitly in `packages/auth/src/access.ts`, consistent
  with the current three-role model. No `reopen` action is added unless decision point 2 chooses
  it.
- Doc 03 keeps `order: ["create", "read", "update"]`. `orders.create` and
  `orders.updateStatus` use their existing permission strings and call the helper. Completed
  and cancelled orders remain terminal under doc 03; encounter completion does not add an
  order-reopen shortcut.
- Doc 04 keeps `charge: ["create", "read", "void"]`. `charge.createManual` calls the helper.
  Ordinary edits, new charges, and deletion are rejected after encounter completion.
  `charge.void`, guarded by `orgProcedure({ charge: ["void"] }, input)`, is the explicit
  exception: it performs the scoped `pending → void` transition, requires a reason, and inserts
  `charge.void` into `auditLog` in the same transaction.
- Doc 06 ordinary `observation.createPreliminary`, `observation.updatePreliminary`, and
  `observation.finalize` writes call the helper. `observation.amend`, guarded by
  `orgProcedure({ observation: ["amend"] }, input)`, is the explicit exception: it inserts a
  new immutable `amended` row pointing to the prior final/amended row, never updates the
  predecessor, and inserts `observation.amend` into `auditLog` in the same transaction.

The legal-after-completion list is deliberately closed:

1. read and list procedures;
2. `charge.void` as the doc 04 financial correction path; and
3. `observation.amend` as the doc 06 append-only clinical correction path.

Invoice, payment, or settlement rows may continue their own financial lifecycle because they
do not rewrite encounter clinical content. No order mutation, encounter edit, charge creation,
charge deletion, preliminary observation edit, or final observation replacement is legal.
Future encounter-owned domains must either call the helper or propose a named, audited
exception; they do not silently expand this list.

`encounter.complete` runs as one transaction: lock and scope the encounter, check the chosen
completion invariants, perform an atomic allowed-state-to-`completed` update, set
`completedAt`/`completedByUserId`, and insert an `encounter.complete` row into `auditLog`. A
failed invariant or stale status rolls back both writes. This directly applies AGENTS.md hard
rule 3 rather than calling fire-and-forget `audit()`.

The org encounter detail route from doc 02, under
`apps/web/src/routes/org/$orgSlug/`, should show a confirmation for Complete and a persistent
read-only banner afterward. It should remove or disable ordinary edit controls and expose only
permission-allowed Void Charge and Amend Observation actions in their respective sections.
There is no new standalone route for this proposal.

## What we are NOT doing

- No per-router status checks: duplicated guards will drift as child domains are added.
- No silent no-op on a completed encounter: stale writes return `CONFLICT` and preserve data.
- No generic “admin can edit anything” bypass: privileged corrections use the same explicit,
  attributed amendment or void procedures.
- No deletion or in-place replacement of clinical history: the predecessor remains readable.
- No financial-lifecycle freeze: charge voiding and downstream invoicing/payment are distinct
  from rewriting clinical content.
- No workflow engine or generalized state-machine framework: one helper and explicit router
  transitions are enough for the proposed domains.

## Decision points

1. **Where should finalization be enforced?** Options: (a) the shared router helper only, or
   (b) the helper plus PostgreSQL triggers on every encounter-owned table. **Recommendation:
   (a), router-only.** It matches accepted ADR 0008's application-level enforcement, produces
   intentional oRPC errors, and keeps one convention. A trigger is a stronger belt-and-braces
   option, but it duplicates transition knowledge, needs custom SQL migrations, and would need
   updating for every legal exception. Revisit it if regulation or an actual bypass justifies
   database defence in depth.

2. **Can a completed encounter be reopened?** Options: (a) no generic reopen; corrections are
   explicit append-only amendments/voids, or (b) add `encounter.reopen` for selected roles with
   a required reason. **Recommendation: (a) initially.** Reopening makes the supposedly final
   record mutable and obscures which content changed. If the owner chooses (b), add the action
   only to `admin` and `owner`, require a reason, transition `completed → open` in a scoped
   transaction, and insert `encounter.reopen` into `auditLog` atomically; member must not gain
   it implicitly.

3. **What must be true before completion?** Options range from status-only to a comprehensive
   clinical checklist. **Recommendation: keep the first checklist minimal:** the encounter is
   currently `open` or `ordered`; no doc 03 order remains in `ordered`; and the completion
   update and audit insert both succeed. Do not require a diagnosis, observation, payment, or
   zero balance: those rules are specialty- and workflow-specific, and payment is not clinical
   finality. The “no ordered orders” rule prevents completion from making required downstream
   result work illegal.

4. **What error contract should callers receive?** Options: (a) `CONFLICT` with a clear
   finalization message, or (b) `BAD_REQUEST`. **Recommendation: (a).** The request shape is
   valid but conflicts with current persisted state; `NOT_FOUND` remains reserved for a missing
   or foreign-scoped encounter. Tests should assert the oRPC code, not message text.

## Rough size

M — touches `packages/api` (one shared helper plus encounter/order/charge/observation callers),
`packages/auth` (the doc 02 `complete` action and explicit role grants), the existing doc 02 org
encounter route, and integration coverage for finalization, concurrency, tenancy, and the two
legal exceptions. No additional migration beyond doc 02's encounter finalization columns and
CHECK is expected; choosing a DB trigger or reopen history would add migration scope.
