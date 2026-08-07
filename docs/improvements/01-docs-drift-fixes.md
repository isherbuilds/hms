# 01 — Documentation drift fixes

Status: APPROVED — decisions recorded (2026-08-07; recommendations accepted as written)
Depends on: none
Blocks: nothing

## Problem

The contributor docs still describe a generic B2B SaaS base whose first domain is
`settings`, while the code now exposes an HMS front-desk layer: patient, catalog, staff,
dashboard, and AI. The `/ai` route also sits outside the documented single-`/rpc` rule, and
MRN allocation and the domain relationships have no durable architectural rationale. The
research that found these gaps is itself absent from the contributor-docs entry point
([research §C](../research/01-reference-architecture-danphe-marley.md#c-doc-drift-each-claim-has-both-sides-cited)).

## Evidence

- D1: `project-intent.md:19-23` calls `settings` the first real domain and says the base is
  not opinionated about domain, but the live router exports patient, catalog, staff, and
  dashboard (`packages/api/src/routers/index.ts:12-21`); AI is also a permissioned surface
  (`packages/auth/src/access.ts:27`). See
  [research §C.1](../research/01-reference-architecture-danphe-marley.md#c-doc-drift-each-claim-has-both-sides-cited).
- D2: hard rule 2 says org pages use one `/rpc` client, while `apps/server/src/index.ts:119-163`
  implements `/ai` as a Hono route with its own `authorizeOrg(..., { ai: ["use"] })` call.
  `apps/web/src/routes/org/$orgSlug/ai.tsx:43-53` posts to it through AI SDK's
  `DefaultChatTransport`. No listed ADR covers this exception
  ([research §C.2](../research/01-reference-architecture-danphe-marley.md#c-doc-drift-each-claim-has-both-sides-cited)).
- D3: there is no domain-layer architecture page. The existing layer already has per-org
  MRNs, a priced catalog, and practitioners optionally linked to member users
  (`packages/db/src/schema/practitioners.ts:7-28`), but those relationships are only visible
  in code ([research §B](../research/01-reference-architecture-danphe-marley.md#b-what-we-have-local-verified)).
- D4: `docs/contributing/index.md:8-43` links workflow, architecture, security, and product
  docs but not `docs/research/`; the reference-architecture report identifies its own
  discoverability gap
  ([research §C.4](../research/01-reference-architecture-danphe-marley.md#c-doc-drift-each-claim-has-both-sides-cited)).
- D5: registration reads the settings-backed prefix, increments the org's `mrn` counter, and
  inserts the patient in one database transaction (`packages/api/src/routers/patient.ts:40-70`).
  The composite `(orgId, key)` counter row serializes concurrent callers and rollback returns
  the number (`packages/db/src/counter.ts:9-16`; schema at
  `packages/db/src/schema/counter.ts:5-20`). This is behavior without a recorded decision.
- D6: `AGENTS.md:3-14` still leads with “Multi-tenant B2B SaaS base” and its architecture map
  has no domain-layer or research link. [INFERENCE] Once D1-D3 land, leaving that map unchanged
  will keep steering contributors toward the superseded framing.

## Proposed change

These are documentation-only changes. They add no table, migration, permission, procedure,
route, or audit write. Where the new domain page shows schema, it must label the sketch as a
map of current code rather than a proposed migration:

```ts
// Existing shape, simplified for architecture documentation.
counter: { orgId, key, value } // primary key (orgId, key)
patients: { id, orgId, mrn, createdBy }
catalogItems: { id, orgId, category, unitPrice, active }
practitioners: { id, orgId, departmentId, memberUserId?, consultFeeItemId? }
```

### D1 — Name the HMS direction and live domains

- **Target:** `docs/contributing/project-intent.md`, especially “What this repo is”, “What it
  is not”, and “Who it is for”.
- **Before:** a domain-neutral multi-tenant base whose first real domain is `settings`.
- **After:** an HMS product built on the same multi-tenant spine; explicitly list the live
  patient, catalog, staff, dashboard, and AI domains. State that appointments/encounters,
  orders, results, charging, and beds are not yet live so product direction is not confused
  with shipped scope. Preserve the “ordinary application code”, fail-loud tenancy, and audit
  invariants.
- **Permissions/routes/audit:** describe the live surfaces only; do not add grants, routes, or
  imply new audit behavior.
- **Decision point:** wording only—whether to call the target “hospital management system” or
  “HMS for 20–150-bed hospitals”. Recommendation: use “hospital management system” in the
  lead and keep market-size language out until product positioning is settled.

### D2 — Record the `/ai` transport exception

- **Targets:** new `docs/contributing/decisions/0017-ai-streaming-http-surface.md` and one entry
  in `docs/contributing/decisions/index.md`.
- **Before:** hard rule 2 permits one `/rpc` client, but `/ai` is an undocumented second
  org-authorized HTTP surface.
- **After:** ADR 0017 records either a narrow sanctioned exception or a migration into oRPC.
  Its context must explain that `/ai` currently accepts AI SDK UI messages, calls
  `streamText`, and returns `createUIMessageStreamResponse` directly
  (`apps/server/src/index.ts:142-162`); the web route uses `DefaultChatTransport`, not the oRPC
  client (`apps/web/src/routes/org/$orgSlug/ai.tsx:45-53`). This is why it is outside oRPC
  today: the current path preserves AI SDK's native streaming response contract.
- **Permissions/routes/audit:** both options retain `{ ai: ["use"] }`, verified org scope,
  uncached membership, and equivalent 401/403 behavior. The sanctioned-exception option keeps
  `POST /ai` and its explicit `authorizeOrg` call. The oRPC option proposes an `ai.stream`
  procedure declared as `orgProcedure({ ai: ["use"] }, input)` and must name the streaming
  adapter/client contract before claiming the route can move. Neither option adds an audit
  point merely for sending a prompt; sensitive future AI actions remain separately auditable.
- **Decision point:** choose (A) sanction `/ai` as a documented, streaming-only exception to
  hard rule 2, or (B) fold it into oRPC and replace the native AI SDK transport boundary.
  Recommendation: A. It documents the smallest truthful rule, preserves native streaming,
  and still requires the same central authorization primitive. Revisit B only when oRPC can
  carry the UI-message stream without a bespoke bridge.

### D3 — Add the domain-layer architecture page

- **Targets:** new `docs/contributing/architecture/domain-layer.md`, plus links from
  `docs/contributing/architecture/index.md` and `docs/contributing/index.md`.
- **Before:** architecture docs cover tenancy, authorization, request lifecycle, storage,
  audit, and files, but not the HMS domain model.
- **After:** document three live relationships: MRN allocation uses the settings prefix plus
  a six-digit per-org counter; the catalog is the single registry for chargeable items; and a
  practitioner is a staff record whose optional `memberUserId` links it to a login without
  making that user ID tenant scope. Show the current front-desk boundary: organization setup,
  patient registration/search, catalog setup, and practitioner setup are live; appointment
  onward is future scope. Use `encounter` as the working future name and note that proposal 02
  owns the visit-versus-encounter naming decision.
- **Permissions/routes/audit:** link the existing `patient.register/search/get/update`
  procedures to `patient:create/read/update`, `catalog.list/create/update` to
  `catalog:read/create/update`, and the department/practitioner procedures to
  `staff:read/create/update`; all remain `orgProcedure(...)` calls. Name org routes only where
  they exist. Reiterate `orgId` predicates and that member linkage never authorizes a row.
  Link the audit architecture page rather than inventing events, and do not claim patient
  audit is transactional unless the code is changed to make that true.
- **Decision point:** none beyond page naming. Recommendation: `domain-layer.md`, because the
  page explains relationships and boundaries rather than one workflow.

### D4 — Make research discoverable

- **Target:** `docs/contributing/index.md`.
- **Before:** no route from the contributor-docs home to `docs/research/`.
- **After:** add a “Research” entry linking `../research/`, described as evidence and external
  reference analysis rather than current behavior or accepted decisions.
- **Permissions/routes/audit:** no change.
- **Decision point:** placement only. Recommendation: a separate “Research” section after
  architecture so readers cannot mistake research recommendations for ADRs.

### D5 — Record the MRN strategy

- **Targets:** new `docs/contributing/decisions/0018-org-scoped-mrn-counter.md` and one entry in
  `docs/contributing/decisions/index.md`.
- **Before:** the strategy exists only in router, counter-helper, schema, and settings code.
- **After:** record that the display MRN is
  `settings.mrnPrefix + String(nextCounter(orgId, "mrn")).padStart(6, "0")`; settings are read
  before the transaction through the TTL cache, while counter increment and patient insert
  share one transaction. The `(orgId, key)` upsert lock serializes allocation per tenant, and
  rollback also rolls back the increment, so the committed sequence is gapless under current
  in-database registration. State limits plainly: prefix changes can create multiple visual
  series, “gapless” does not cover deletion or external imports, and this identifier is not a
  national health ID.
- **Permissions/routes/audit:** MRN allocation remains inside
  `patient.register` guarded by `{ patient: ["create"] }`; there is no standalone counter
  endpoint. The ADR changes no audit behavior.
- **Decision point:** choose (A) retain the transactional per-org named counter, (B) use a
  PostgreSQL sequence and accept rollback gaps, or (C) use opaque/random identifiers as the
  displayed MRN. Recommendation: A. It matches shipped behavior, isolates contention by
  `(orgId, key)`, and provides human-friendly per-hospital numbering without making MRN the
  primary key. Separately decide whether prefix changes should be forbidden after first use;
  recommendation: do not assert that policy in this ADR until the workflow is specified.

### D6 — Refresh the agent map after D1-D3

- **Target:** `AGENTS.md` only, after D1-D3 are accepted and landed.
- **Before:** the lead describes a generic B2B SaaS base, and the map omits the domain-layer
  page and research evidence.
- **After:** use the same concise HMS-plus-platform-spine framing as `project-intent.md`; add
  links to the domain-layer architecture page and research index. Do not duplicate domain
  details or weaken any hard rule. If ADR 0017 sanctions `/ai`, hard rule 2 must link to it and
  say the exception is narrow rather than silently claiming every org call uses `/rpc`.
- **Permissions/routes/audit:** preserve every non-negotiable rule verbatim except the minimum
  truthful clarification for `/ai`.
- **Decision point:** none independent. Recommendation: treat D6 as a synchronization edit,
  with wording derived from the owner-approved D1 and D2 outcomes.

## What we are NOT doing

- Changing runtime behavior, schema, migrations, permissions, routes, or audit writes; these
  six fixes document current behavior and explicit open choices.
- Presenting the proposed ADR outcomes as accepted before owner review.
- Claiming appointments, encounters, orders, observations, charges, service units, or
  occupancies are live; their working names belong to later proposals.
- Turning research into normative architecture; ADRs and current-behavior docs remain the
  authority.
- Expanding the domain page into an implementation plan or copying reference-repo models.
- Solving prefix-change policy, national-ID integration, or MRN merging in this hygiene pass.

## Decision points

1. **`/ai` surface:** sanction the native streaming endpoint (A) or fold it into oRPC (B)?
   Recommend A now, because it preserves the AI SDK stream contract while retaining the same
   `authorizeOrg` permission guard; ADR 0017 makes the exception narrow and reviewable.
2. **MRN allocator:** retain the transactional per-org counter (A), accept sequence gaps (B),
   or expose opaque identifiers (C)? Recommend A because it accurately records the shipped,
   tenant-isolated behavior and rollback semantics.
3. **MRN prefix changes:** make immutability part of ADR 0018 now (A), or record it as an open
   operational policy (B)? Recommend B; the code currently permits settings changes, and this
   docs-only pass must not manufacture a restriction.
4. **Product wording:** generic “hospital management system” (A) or a specific hospital-size
   segment (B)? Recommend A until positioning is approved separately.
5. **Research placement:** a separate section after architecture (A) or a workflow bullet (B)?
   Recommend A so evidence is discoverable without looking normative.

## Rough size

S — documentation only. Eight files when executed: one project-intent rewrite, two new ADRs,
one ADR-index update, one new architecture page, one architecture-index update, one
contributing-index update, and one `AGENTS.md` map refresh. No packages, migrations, runtime
routes, or tests are touched.
