# 0023: Charges and invoices hang off the Clinical Encounter

- **Status:** superseded by [ADR 0026](0026-one-opd-appointment-record.md)
- **Date:** 2026-08-21
- **Amends:** [ADR 0022](0022-care-settings-are-separate-destinations.md) §3 and §5

## Context

ADR 0022 established that each care setting owns its own operational table, with
two shared rows underneath: `clinical_encounters` for clinical identity and
`billing_accounts` for financial identity. Charges and invoices pointed at the
Billing Account; clinical records pointed at the Clinical Encounter.

Shipped, the Billing Account turned out to carry nothing:

- It was strictly 1:1 with the Clinical Encounter, enforced by
  `billing_accounts_org_clinical_encounter_idx`, and created in the same
  transaction as it. Nothing could ever produce a second one.
- Its only columns beyond the primary key were `orgId`, `createdBy`, and a
  `patientId` already stored on the Clinical Encounter it pointed at.
- Every money read paid for it. `billing.listPendingCharges`,
  `billing.addCharge`, `billing.issueInvoice`, `billing.listInvoices`, `opd.get`
  and `opd.transition` each joined or looked up the account purely to translate
  one id into another.

The shape it would grow into is also not this one. FHIR's `Account` is scoped to
a patient and a period, with `Encounter.account` pointing _at_ it —
one account, many encounters. A container created per encounter is the inverse
relationship, so it was not a head start on deposits, advances, or insurance; it
was a table that would have to be re-pointed before it could hold any of them.

The same review found the Clinical Encounter had the opposite problem: the only
clinical record that existed, the scanned paper prescription, attached to
`opd_encounters.id` under the target type `opd_prescription`. The shared identity
row carried nothing shared.

## Decision

**One shared row per care interaction. Charges, invoices, and clinical
attachments all point at `clinical_encounters.id`.**

1. `billing_accounts` is deleted. `charges.billingAccountId` and
   `invoices.billingAccountId` become `clinicalEncounterId`, referencing
   `clinical_encounters`. This matches `ChargeItem.context` in FHIR R4, and the
   attachment point Danphe and Marley both use.
2. Clinical attachments target the Clinical Encounter. The attachment target type
   `opd_prescription` becomes `prescription`, so admissions and emergency reuse
   the attach path rather than adding a target type per setting. Prescription
   audit entries name `encounter:{id}` for the same reason.
3. **A patient-level Account is still expected, and is additive when it arrives.**
   Deposits, IPD advances, patient credit, and insurance payors need an account
   that outlives one encounter. That is one row per patient with encounters
   pointing at it — a nullable `accountId` on `clinical_encounters`, not a
   container between the encounter and its charges. Build it against a real
   workflow, not ahead of one.
4. **The staff-facing vocabulary loses one word.** "Billing Account" is removed
   from the glossary. Money belongs to an encounter; `Billing` remains the name
   of the destination where it is worked.
5. **`clinical_encounters.setting` goes too, with its CHECK and its index.**
   ADR 0022 §3 rules out a generic setting discriminator, and the column had no
   reader — with only OPD built, every row carried the same value, so it stored
   zero information. It returns with its first reader, when a cross-setting
   patient timeline needs to know which board owns a row.

## Consequences

- One insert fewer per registration, and one join fewer in every billing read
  and in `opd.get`. Both are small; the reason to do it is that the indirection
  had no reader, not that it was slow.
- ADR 0022 §3 ("Charges and invoices point to a Billing Account, never directly
  to a care-setting table") holds in spirit and changes in wording: they point to
  the Clinical Encounter, still never to a care-setting table. §5's convergence
  claim is unchanged — every setting's money converges on shared rows and one
  organization ledger.
- Adding a care setting is unchanged in cost: a table, a permission subject, a
  route, a sidebar line. Its charges use `clinicalEncounterId` like OPD's.
- The migration was regenerated rather than added to. Nothing is deployed and
  this branch already squashes to a single migration. Any database that ran an
  earlier `0000` must be reset before `db:migrate`.

## Alternatives considered

- **Keep the Billing Account and wait for it to earn its place.** Rejected: the
  relationship it would need (many encounters to one account) is the reverse of
  the one it had, so waiting would still mean rewriting it. Deleting now and
  adding a patient-scoped account later is strictly less work than migrating a
  per-encounter container into a per-patient one.
- **Delete `clinical_encounters` instead and let each setting own its charges.**
  Rejected: charges, invoices, labs, and files would each need a polymorphic
  target or a foreign key per setting, which is the exact cost ADR 0022 avoided.
  Exactly one shared identity row is the right count — the question was only
  whether it was one row or two.
