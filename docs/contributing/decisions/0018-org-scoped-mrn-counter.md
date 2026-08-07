# 0018: Allocate display MRNs with an organization-scoped counter

- **Status:** accepted
- **Date:** 2026-08-07

## Context

Patient registration needs a short, familiar identifier that is unique within a
hospital. The shipped allocator reads organization settings through the TTL
cache before opening the registration transaction, then computes:

```ts
settings.mrnPrefix + String(nextCounter(tx, orgId, "mrn")).padStart(6, "0");
```

Inside the transaction, one upsert of the `(orgId, key)` counter row increments
and returns the value. That row lock serializes concurrent allocations for the
same organization and key. The patient insert uses the resulting MRN in the
same transaction, so a rollback also rolls back the increment.

Alternatives are a PostgreSQL sequence, which would introduce rollback gaps, or
an opaque/random displayed identifier, which would lose familiar per-hospital
numbering.

## Decision

Retain the transactional, per-organization named counter. MRN allocation stays
inside `patient.register`, guarded by `{ patient: ["create"] }`; there is no
standalone counter endpoint. The MRN is a display identifier, not the patient
primary key or a national health ID.

Do not impose a prefix-immutability policy in this decision. Settings currently
permit prefix changes, and that workflow needs a separate product decision.
This ADR changes no audit behavior.

## Consequences

Committed in-database registrations have a gapless counter sequence, with
contention isolated by `(orgId, key)`. Prefix changes can create multiple visual
series even though the numeric counter continues. “Gapless” does not cover
patient deletion or identifiers brought in by external imports. A future
national-ID or record-merge workflow must treat the MRN as a local display
identifier rather than reuse it as global identity.
