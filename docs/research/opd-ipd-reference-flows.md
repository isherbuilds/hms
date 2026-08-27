# OPD/IPD reference flows — Marley and OpenMRS O3

**Question.** How do Marley (earthians/marley, ex-Frappe Health) and OpenMRS 3
design the screens our console lives in — patient search/registration, the OPD
day view, intake-to-billing, draft protection, concurrency, keyboard speed —
and what does their IPD surface look like, as ground for our core-screen
refinement and future roadmap?

**Answer.** Both references converge on the shape we already have: one dated
day board with search and status filters, registration reachable inline from
intake, and a single settlement step. Where they are stronger than us is
_infrastructure honesty_: both protect unsaved work (Frappe dirty-state +
`beforeunload`; O3 `BeforeSavePrompt`) and Frappe detects concurrent edits with
an optimistic timestamp check — two things our intake and patient-edit flows
lack. Where they are weaker than us: duplicate-patient defense (both have
essentially none at registration) and billing atomicity (both settle via
separate invoice/payment documents; our D015 single transaction is tighter).
Their IPD surfaces show the territory is event-derived state + a bed
assignment table, and that even mature projects ship it half-built.

## Pins

- Marley `develop` @ `e24bc491` (2026-08-19, v17.0.0-dev); Frappe @ `5003fc56`;
  `earthians/marley_frontend` @ `387570b9` (2026-06-22, v0.0.1).
- OpenMRS `openmrs-esm-patient-management` main @ `29696858` (packages
  v11.1.0); `esm-core` main @ `9f0c6aa8` (framework v10);
  `openmrs-esm-billing-app` @ `fdd1b56b`; bed module @ `6d4b70bf`; EMR API @
  `f644b9cb`. Per-claim `file:line` citations are inline below and resolve
  against these pins.

## Evidence by question

### Q1 Patient search & duplicate defense — both weaker than us

- Marley `Patient.validate()` does **no** duplicate query; duplicate names get
  a ` - N` suffix (naming collision, not identity). UID is the only unique
  field. Phone is syntax-validated, never normalized
  (`healthcare/doctype/patient/patient.py:30-37,140-164`; Frappe
  `base_document.py:1210-1244`).
- Marley's kiosk searches **exact mobile**; several patients on one number get
  a disambiguation dialog (`marley_frontend/api.py:304-320`).
- O3 search sends the raw string to `GET /patient?q=`; no phone normalization.
  The REST API supports `attributesToFindDuplicatesBy`, but the registration
  app never calls it — duplicate defense exists in the platform and is unused
  by the UI (rest.openmrs.org `#search-patients`; grep of
  esm-patient-registration-app found no usage).

### Q2 Registration — minimal required fields, submit-time validation, both

- Marley requires first name + gender only; mobile optional. O3 requires
  given/family name, gender, DOB **or estimated age in years** (Yup schema,
  validated on submit with a warning snackbar). Post-save: O3 redirects to the
  patient chart (configurable `afterUrl`); Marley stays on the form.
- O3's estimated-age pattern stores one birthdate plus an `estimated` flag —
  a single source of truth instead of parallel age/DOB fields.

### Q3 OPD day view — one dated board, statuses as tabs/filters, row actions

- Marley core is appointment-form-centric (statuses
  Scheduled/Open/Confirmed/Checked In/Checked Out/Closed/Cancelled/No Show,
  date-derived, terminal preserved; `patient_appointment.py:120-147`). The
  real desk lives in `marley_frontend`'s Waitlist: today-by-default, filters
  (patient/mobile/department/practitioner), status tabs, and rows showing
  patient, mobile, time, token, status, **patient balance**, with actions
  check-in, vitals, encounter, reschedule, print pass, invoice
  (`Waitlist.vue:145-236`, `WaitlistTabs.vue:1-260`). Tokens are a linked-list
  journey with WebSocket displays — a station-routing system, not just a number.
- O3 service queues: queue per service+location with statuses/priorities,
  Carbon table, 60s poll; actions call/serve/move/requeue. Notably check-in on
  an appointment does **not** auto-enqueue — a separate add-to-queue step the
  clerk must remember (no queue import in esm-appointments-app).

### Q4 Intake → billing

- Marley's appointment payment popup (mode, charge, discount %/amount, one
  submitted Sales Invoice with POS payment) is the closest analog to our
  settlement overlay (`patient_appointment.py:531-596`). Fee Validity encodes
  free-follow-up windows as a first-class record (`fee_validity.py:123-181`).
- O3 billing is a separate app: bill → invoice finalization → payment call —
  multi-screen, multi-actor. Neither reference has our single-transaction
  walk-in settle (D015); both would let a half-billed visit exist.

### Q5 Draft protection — both have it, we do not

- Frappe: any dirty form sets `__unsaved`, adds `beforeunload`, shows an
  orange "Not Saved" indicator, and warns "modified after you have loaded it"
  when stale (`form.js:1632-1647`, `toolbar.js:873-895`).
- O3: registration has `BeforeSavePrompt` (touched fields → single-spa route
  guard + `beforeunload`); the workspace framework takes
  `hasUnsavedChanges` and prompts before closing.

### Q6 Concurrency — Frappe has the model worth copying

- Frappe `save()` carries `_original_modified`; `check_if_latest()` raises
  `TimestampMismatchError` — "has been modified after you have opened it,
  refresh" (`document.py:830-845,1384-1414`). Optimistic, no locks. (Caveat:
  Frappe/Marley bypass it in `db.set_value` fast paths.)
- O3 patient save has no ETag/version — not found in the registration app.

### Q7 Keyboard speed

- Frappe ships global Ctrl+K awesomebar, Ctrl+S primary action, form/grid
  shortcuts, and a shortcut cheat-sheet dialog (`keyboard.js:156-238`).
- O3 gives autofocus + arrow/Enter in search and focus restoration; no global
  clerk shortcuts. Neither has barcode-first flows in the paths read.

### Q8 IPD territory (roadmap only — evidence-gated per docs/product.md)

- **Marley:** Inpatient Record lifecycle `Admission Scheduled → Admitted →
Discharge Scheduled → Discharged/Cancelled`; wards are a service-unit tree
  with leaf occupancy status; stays bill from occupancy child rows (hours ×
  service-unit-type rate, manual or scheduler-generated); nursing-task
  checklists can gate admit/discharge; discharge blocks on unbilled work.
  Notably **no dedicated bed board page** — a doctype tree view not even
  linked from the IPD sidebar; plus schema/UI drift
  (`discharge_ordered_datetime` sent but not in schema) and beta duplication
  (Medication Request vs IMO/IME). A mature project ships IPD half-polished.
- **OpenMRS:** ward app renders bed cards + unassigned list; the
  awaiting-admission "queue" is **derived** from disposition obs via HQL, not
  a queue table; ADT is admission/transfer/discharge encounters; bed module is
  a plain assignment table (AVAILABLE/OCCUPIED, no optimistic locking, bed
  sharing allowed). Officially "IPD Support V1 active" with open crash PRs.
  Even here, admission+bed assignment is two non-atomic writes (bed failure
  warns but keeps the admission).

## What this proves / does not prove

- Proves: the patterns our refinement themes proposed (leave-guard on intake,
  optimistic version check on patient edit, digit-normalized phone matching,
  single age/DOB source, autofocus + Enter discipline) are not inventions —
  each exists in at least one mature reference, and their absence is treated
  there as a defect class. Also proves our settled choices (single day list,
  atomic settlement, few statuses) are _simpler than both references without
  losing anything they guarantee_.
- Does not prove: operator demand for any specific refinement (that needs the
  pilot desk, not source code), nor that Marley/O3 IPD models fit our tenancy
  and money rules. Reference breadth is an inventory, not permission to build.

## What this means for us

1. Adopt (fits existing conventions): intake leave-guard (mirrors our existing
   patient-form discard guard), `updatedAt`-based conflict check on
   `patient.update` surfaced as a refresh prompt, digits-only phone
   normalization for duplicate matching and picker seeding, O3-style single
   DOB+estimated flag to replace the age/DOB pair, focus chaining and Enter
   semantics in intake.
2. Keep rejecting: multi-stop token journeys, WebSocket displays, command
   palette (midday spec already excludes it), separate bill/invoice/payment
   screens for OPD.
3. IPD stays evidence-gated; this memo is the territory map for when the
   product gate opens, not a build permit.

## Next falsification

Walk the refined intake and patient-edit flows with pilot reception staff;
count corrections and abandoned drafts per shift before/after. For duplicate
defense: measure duplicate-patient rate in pilot data once volume exists.

## Sources

Pinned repos above carry every per-claim citation inline.
Docs: o3-docs.openmrs.org, rest.openmrs.org, openmrs.atlassian.net IPD squad
pages, docs.frappe.io.
