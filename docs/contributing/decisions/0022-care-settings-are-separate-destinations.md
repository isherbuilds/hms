# 0022: Care settings have separate staff workflows over a Clinical Encounter identity

- **Status:** superseded by [ADR 0026](0026-one-opd-appointment-record.md)
- **Date:** 2026-08-21
- **Amended by:** [ADR 0023](0023-charges-hang-off-the-clinical-encounter.md) — the separate
  Billing Account below was deleted; Charges and Invoices name the Clinical Encounter directly.
  Everything else here stands.

## Context

The product must eventually serve three care settings — outpatient (OPD),
inpatient (IPD) and emergency. Two coherent shapes were live in the repo at the
same time and contradicted each other:

- Earlier product notes defined **one** OPD Encounter entity with a class
  attribute.
  `docs/research/10-emr-navigation-ia.md` argued the matching navigation:
  "census classes (IPD, ER) are filters or boards, never top-level departments
  of the menu", and "OPD encounters stays the post-check-in home; OPD/IPD/ER become
  class filters inside it".
- `docs/research/12-patient-flow-end-to-end.md` §Δ1 argued the opposite from the
  flow side: the three pipelines have different **exit conditions** — OPD closes
  same-day on consult completion, IPD on a billing gate after days, emergency on
  a disposition — so one `status` column cannot carry three state machines.

Both positions were prototyped and compared side by side ("Split" against
"Spine", the latter built to doc 10's prescription without softening it). That
prototype surface was deleted when this decision was taken, per the prototyping
workflow — the reasoning is preserved here, not the code. Doc 10's convergence claim also turned out
to be overstated against its own comparison table: Bahmni ships a top-level
"InPatient" tile and Danphe ships Admission and Emergency as separate modules,
so two of its five systems already split.

`docs/research/13-operational-ui-for-non-technical-staff.md` then examined the
question from the user side, since the operators are non-technical staff doing
the same tasks hundreds of times a day.

## Decision

**Each care setting is its own destination, backed by its own table.**

1. **Navigation follows working domains.** `Care` has `OPD` and `Patients`
   today. `Appointments`, `IPD`, and `Emergency` each gain their own entry when
   their domain trigger is met and the workflow ships. `Finance` has a single
   `Billing` entry, and it is now the organization-wide worklist itself — what is
   unbilled and what is unpaid — rather than the handoff card it shipped as first.

   This keeps the all-day console task-focused and avoids teaching staff to
   ignore dead destinations. Stable placement still matters once a workflow is
   live; it does not justify reserving visible space with roadmap placeholders.

   Sidebar entries keep the existing rule in `apps/web/src/lib/navigation.ts`
   that no entry's path is a prefix of another's.

2. **Naming: labels and URLs match, and both use the desk's words.** The route
   is `/$orgSlug/opd`, not `/$orgSlug/opd_encounters` — a URL that says one thing while
   the sidebar says another is the drift this repo's docs already suffered from.
   `OPD`, `IPD` and `Emergency` are what Indian hospital staff say out loud
   (research 13 §E5), and Danphe uses the same abbreviations in its own UI.

   Marley's vocabulary (`outpatient`, `inpatient`, `emergency` workspaces) was
   the alternative and was rejected: it is clearer to a newcomer and less clear
   to the people who use it daily, and the abbreviations are already defined in
   the [product blueprint](../../product-blueprint.md).

   **The entity keeps its own name.** The table is `opd_encounters`, the router is `opd`, and IDs
   are `opdEncounterId`. `OPD` remains the concise staff-facing label.

3. **Schema.** `opd_encounters`, future `admissions`, and future `emergency_episodes` own their
   operational fields and statuses. `clinical_encounters` supplies shared identity and patient
   context. Charges and invoices point to a Clinical Encounter, never directly to a care-setting
   table (amended by ADR 0023, which deleted the intermediate `billing_accounts` row). A generic
   setting discriminator and universal workflow status encode the wrong abstraction and are not
   part of the model.
4. **Permissions ship with the domain.** `opd` is the current OPD subject.
   `appointment`, `admission`, and `emergency` are added only when their domain
   ships, so the permission vocabulary describes real protected operations.
5. **Money converges through the Clinical Encounter.** OPD creation atomically creates a Clinical
   Encounter, OPD encounter, and optional consult-fee Charge. Future care settings perform the
   equivalent orchestration. Appointments create none of these until check-in. Optional booking
   money is an Advance Receipt and patient-advance liability; it can be allocated after check-in
   creates an Invoice. Posted documents from every setting converge into the same organization
   accounting ledger and Billing destination.

## Consequences

- Adding a care setting is additive for its operational state machine: a table, a permission subject,
  a route, and one sidebar line. Shared clinical _and_ financial records use `clinicalEncounterId`.
- Each board can take the shape its work needs — a token queue, a bed grid, an
  acuity list — instead of three jobs sharing one row shape with empty cells.
- The sidebar grows only when a care setting becomes usable. Once present, its
  location stays stable; staff are never asked to learn that a visible item is
  a placeholder.
- **No safety claim is made.** The mode-error argument against a class filter is
  a design principle we chose to respect, not an outcome we have evidence for —
  the nearest healthcare trial (Adelman et al., JAMA 2019, 3,356 clinicians)
  found no significant difference in wrong-patient errors from a comparable
  context change (research 13 §E4).
- Doc 10's four navigation prescriptions are superseded on this point. Its
  finding that **check-in is a row action, not a screen** is unaffected and
  still holds.
- The OPD queue displays the canonical daily token number unchanged. The same
  row also displays practitioner and department, so staff retain the scope
  needed to distinguish repeated numbers without creating a second, derived
  token identity that changes when a practitioner is renamed.

## Alternatives considered

- **One OPD encounter with a class filter ("Spine").** Rejected on the exit-condition
  argument above, and because the filter is a mode: the same screen means three
  different things depending on invisible state, which is the failure NN/g names
  as a mode slip. Prototyped in full before rejection.
- **A hub screen in front of the three boards.** Rejected: a screen passed
  through on the way to every task, several hundred times a day.
- **A switcher inside one destination.** Rejected for the same mode reason as
  Spine, with the additional cost that it is one level further from a keyboard
  shortcut than a sidebar entry.
- **Visible placeholders for future destinations.** Rejected after review: they
  add navigation choices without enabling a task and train staff to ignore the
  console. The accepted separation applies when each domain ships.
