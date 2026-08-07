# 05 — Patient master additions

Status: APPROVED WITH CHANGES — see decision points (2026-08-07: sex `unknown`, blood-group
check, free-text allergies/history, opaque org-scoped `uid` accepted; `status` column dropped
until a workflow consumes it; audit stays fire-and-forget `audit()` per the settled 2026-08-07
decision — no in-transaction audit)
Depends on: none
Blocks: nothing

## Problem

The patient master currently stores only MRN, name, phone, sex, age/date of birth, and
address (`packages/db/src/schema/patients.ts:19–63`). The register and update contracts expose
that same narrow shape (`packages/api/src/routers/patient.ts:12–36`), leaving common front-desk
facts outside the record. Research improvement #4 recommends a small additive change the next
time the patient table is migrated, without importing Marley's ERP coupling
(`docs/research/01-reference-architecture-danphe-marley.md:170–174`).

## Evidence

- Marley `patient.json` includes status, email, blood group, UID, allergy history, and medical
  history; §A identifies these fields while distinguishing its unrelated ERP and relations
  fields (`docs/research/01-reference-architecture-danphe-marley.md:35–43`).
- The local table is already correctly tenant-scoped with `orgId NOT NULL`, a per-org MRN
  constraint, and org-led indexes
  (`docs/research/01-reference-architecture-danphe-marley.md:87–96`).
- The research recommendation says these additions require no new infrastructure and reserves
  UID for a later national-ID use such as ABDM ABHA
  (`docs/research/01-reference-architecture-danphe-marley.md:170–174`).
- ABDM support is not established by the donor repository; it must be verified if it becomes a
  target (`docs/research/01-reference-architecture-danphe-marley.md:200–209`).
- [INFERENCE] The donor proves field precedent, not that every field belongs in this product or
  that Marley's exact labels and validation rules fit local front-desk workflows.

## Proposed change

Use the following as the working Drizzle shape for one generated migration. These are additive
columns on `patients`; the existing `orgId`, attribution, timestamps, and tenant-led indexes
remain unchanged.

```ts
status: text("status", { enum: ["active", "inactive"] })
  .default("active")
  .notNull(),
email: text("email"),
bloodGroup: text("blood_group", {
  enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
}),
allergies: text("allergies"),
medicalHistory: text("medical_history"),
uid: text("uid"),

// In the table callback:
check("patients_status_check", sql`${table.status} in ('active', 'inactive')`),
check(
  "patients_blood_group_check",
  sql`${table.bloodGroup} is null or ${table.bloodGroup} in
    ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`,
),
uniqueIndex("patients_org_uid_idx")
  .on(table.orgId, table.uid)
  .where(sql`${table.uid} is not null`),
```

`bloodGroup` is proposed as the closed eight-value ABO/Rh enum rather than free text. The set is
small and stable, invalid spellings have no clinical value, and nullable preserves “not
recorded” without inventing an `unknown` blood group. The CHECK constraints are the database
boundary; the inline enums provide TypeScript inference.

Each proposed column has a donor and a concrete UI consequence:

| Column           | Evidence and UI impact                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`         | Marley has Active/Disabled status (§A, lines 40–43). Register creates `active` by default without a choice; the detail page shows an Active/Inactive control and visibly labels inactive records. |
| `email`          | Marley patient demographics include email (§A, lines 40–43). Add an optional email input to register and an editable email field on patient detail.                                               |
| `bloodGroup`     | Marley has `blood_group` (§A, lines 40–43). Add the same optional eight-value select to register and patient detail; an empty choice persists `null`.                                             |
| `allergies`      | Marley carries allergy history text (§A, lines 40–43). Add an optional compact textarea to register and an editable, clearly labelled section on patient detail.                                  |
| `medicalHistory` | Marley carries medical history text (§A, lines 40–43). Add an optional compact textarea to register and an editable history section on patient detail.                                            |
| `uid`            | Marley has UID (§A, lines 40–43), and improvement #4 reserves it for national IDs (lines 170–174). Add an optional “National ID / UID” input to both pages, without claiming ABHA validation yet. |

The affected UI stays under
`apps/web/src/routes/org/$orgSlug/front-desk/`: update `register.tsx` and
`patients.$patientId.tsx`, using the existing compact, zero-radius controls. Search remains by
MRN/name/phone unless the owner separately approves UID lookup; displaying these fields does
not require a new route.

No new permission statement is proposed. Extend the existing procedures and retain their
current declarations:

- `patient.register`: `orgProcedure({ patient: ["create"] }, registerInput)` accepts the five
  optional values; `status` is omitted and receives the database default.
- `patient.get`: `orgProcedure({ patient: ["read"] }, ...)` returns the added columns for the
  detail page.
- `patient.update`: `orgProcedure({ patient: ["update"] }, updateInput)` accepts the optional
  values and, if retained, `status`; its update remains scoped by
  `eq(patients.orgId, scope.orgId)` and patient ID.

Registration, edits to clinical-history text, UID changes, and status changes are sensitive
patient mutations. The working direction is to record their `auditLog` row inside the same
database transaction as the patient write, rather than relying on the current fire-and-forget
`patient.register` / `patient.update` calls
(`packages/api/src/routers/patient.ts:47–77,147–170`). The audit target remains
`patient:<id>`; status changes should include old and new status if the audit schema permits it.

## What we are NOT doing

- No ERP fields such as customer, territory, customer group, or price list: billing belongs to
  local charge and catalog domains, not patient identity.
- No photo upload: private-object lifecycle and consent rules are disproportionate to this
  additive patient-master change.
- No patient relations table: it introduces a new domain and relationship semantics that the
  current front-desk workflow has not requested.
- No portal accounts: a patient record is not an authenticated user, and account linking needs
  its own authorization design.
- No ABHA verification, lookup, or formatting: `uid` is only a reserved secondary identifier
  until ABDM requirements and donor support are verified.
- No structured allergy terminology in this change: the proposed text captures current
  front-desk input without pretending to be coded clinical data.

## Decision points

1. **Should `sex` remain `male | female | other`, or align now to FHIR
   administrative-gender `male | female | other | unknown`?** Option A keeps the current enum
   and treats absent knowledge as impossible. Option B adds `unknown` to the schema CHECK,
   router schemas, and both forms. **Recommendation: Option B.** The research flags the
   mismatch, the migration cost is trivial before downstream clinical tables depend on it, and
   changing a shared demographic enum later is materially harder. This is an alignment choice,
   not a claim of full FHIR conformance.

2. **Should allergies and medical history start as free text or wait for structured coded
   rows?** Option A adds nullable text now. Option B designs terminology-backed allergy and
   condition tables first. **Recommendation: Option A.** It matches the evidenced donor fields
   and the small front-desk scope. Preserve a later migration path by treating the text as a
   legacy narrative: coded allergy rows can be introduced alongside it, the narrative can be
   copied into a note/source field, and the old columns can be retired only after review.

3. **Is `status` justified before a workflow reads it?** Option A includes it now so front desk
   can soft-deactivate duplicate, deceased, or otherwise non-current records without deleting
   identity history. Option B omits it until search, registration, or scheduling has explicit
   inactive-patient behavior. **Recommendation: include it only if the owner confirms a real
   soft-deactivation need now.** The schema cost is small, but an unread status is dead state
   and violates YAGNI; if included, search and downstream selectors must deliberately hide or
   label inactive patients rather than silently ignoring the field.

4. **Should blood group be constrained to eight ABO/Rh values or remain free text?** Option A
   uses the proposed nullable enum plus CHECK. Option B accepts arbitrary text for uncommon or
   qualified results. **Recommendation: Option A.** The patient master needs a concise summary,
   not a transfusion-lab result; qualified or disputed results belong in future observations.

5. **What identity does `uid` represent initially?** Option A keeps one optional, opaque,
   per-org unique value labelled “National ID / UID.” Option B names it `abhaNumber` and adds
   ABDM-specific validation now. **Recommendation: Option A.** The research explicitly reserves
   UID for later national IDs while warning that ABDM support is unverified. Normalize only
   surrounding whitespace at the router boundary; do not invent ABHA semantics.

## Rough size

**S** if `status` is omitted; **M** if it is included with real deactivate/filter behavior.
Touches `packages/db` (one generated migration), `packages/api` (patient schemas and mutation
audit transaction), and two existing front-desk routes in `apps/web`; no new permission or
route is proposed.
