# Patient-flow prototype UX review — Split, Spine, and a better operational model

Date: 2026-08-21. Branch: internal prototype review plus external UX guidance.
Builds on [13-operational-ui-for-non-technical-staff.md](13-operational-ui-for-non-technical-staff.md),
which compares the two information architectures from the literature. This note records what the
rendered prototypes themselves prove and proposes the smallest stronger alternative.

## Question

After exercising both variants at `http://localhost:3004/prototypes-flow` with OPD/IPD/ER,
appointments, and the 12-doctor fixture enabled, which interface is clearer for a non-technical
hospital operator? Is there a better option than either prototype?

## Answer

**Choose Split as the foundation. Do not ship Spine. The better production direction is Split
plus a role-aware “Today” home and a separate Appointments destination.**

Spine removes two sidebar entries but does not remove their complexity. It moves that complexity
into a single row shape where a token can be real or blank, “age” can mean minutes or hospital
days, and the same primary action says “New visit” for a walk-in, an admission, and an emergency
arrival. The filtered IPD and ER states also lose the task-specific bed and acuity boards. This is
shorter navigation at the cost of weaker recognition, weaker next-action cues, and more scanning.

Split preserves the operator's real workspaces: an OPD queue, an inpatient bed board, and an
emergency triage board. Its weakness is appointments: future scheduling has no permanent home;
only “Expected today” appears as a rail inside OPD. The smallest improvement is therefore not a
third unified model. It is this stable, permission-gated navigation:

1. **Today** — exceptions and handoffs only: arrivals waiting to check in, longest waits,
   discharge blockers, unassigned emergency beds, and payments needed before checkout.
2. **Appointments** — future schedule, booking, rescheduling, arrival and no-show status.
3. **OPD Queue** — today’s checked-in patients and walk-ins, with “Expected today” retained as a
   compact rail or collapsible panel.
4. **Inpatient Beds** — occupancy, admission, transfer and discharge work.
5. **Emergency** — acuity, time in department, bed and disposition.
6. **Patients** and **Billing** — unchanged; patient identity and money remain independent
   domains.

This is a role-aware shell, not a role-named “Front desk” module. A receptionist may see Today,
Appointments, OPD Queue, Patients and Billing; a ward operator may see Today and Inpatient Beds;
an emergency operator may see Today and Emergency. Stable destinations remain stable for each
role.

## Evidence

### E1 — The rendered Split boards match the job; the Spine filters match a database abstraction

In Split, each destination owns the information and actions required by that job:

- OPD groups queue tokens by practitioner and exposes “New walk-in”
  (`apps/web/src/prototypes/patient-flow/boards.tsx:84-184`).
- Inpatients preserves ward and bed position, including vacant beds, advance state, and the
  “Admit patient” action (`apps/web/src/prototypes/patient-flow/boards.tsx:232-290`).
- Emergency sorts by acuity and time and exposes “Unidentified arrival,” “Register arrival,”
  “Assign bed,” and “Disposition” (`apps/web/src/prototypes/patient-flow/boards.tsx:297-361`).

In Spine, those same patients become one shared row whose columns must tolerate three unrelated
classes (`apps/web/src/prototypes/patient-flow/variant-spine.tsx:227-281`). IPD and ER rows render a
placeholder where OPD has a token; the last column alternates between “Day 6,” “68m,” and “40m.”
The page action remains “New visit” in every filter (`variant-spine.tsx:195-205`). [INFERENCE]
That label is structurally unable to tell a novice whether the next screen registers a walk-in,
admits a patient, or begins emergency triage.

Spine's own source accurately states the cost: an inpatient on day 6 and an OPD token holder share
one table, with no bed grid or acuity board (`variant-spine.tsx:43-58`). The rendered filters confirm
that this is not merely an implementation detail; the operator loses the spatial information and
domain actions needed to do the job.

### E2 — Split's extra destinations improve recognition for repeated work

The Split navigation permanently exposes OPD, Inpatients and Emergency
(`apps/web/src/prototypes/patient-flow/variant-split.tsx:35-47`). Spine exposes “Visits” and makes
the three familiar domains a second decision inside the page
(`variant-spine.tsx:73-89, 209-220`).

Nielsen Norman Group advises that interfaces should use the user's language and real-world
conventions, and should keep actions and options visible so people recognize rather than recall
them. It also recommends shortcuts and personalization for repeated users. These are heuristics,
not a direct hospital trial, but they point toward stable, role-gated destinations rather than a
generic noun plus a remembered filter: [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/).

Existing research 13 adds the stronger spatial-memory and mode-error comparison. Its conclusion
is Split for speed, vocabulary and scale, while explicitly declining to claim a proven patient-
safety benefit (`docs/research/13-operational-ui-for-non-technical-staff.md`).

### E3 — Appointments and today's queue need both separation and a visible handoff

Spine gives Appointments a proper destination and clear row actions (“Check in,” “Mark arrived”),
but its explanatory copy asks the operator to understand that check-in “creates their visit and
mints the token,” then sends walk-ins elsewhere (`variant-spine.tsx:128-169`). This is internal
system language, not task language.

Split keeps the most useful handoff visible: “Expected today” sits beside the live OPD queue and
allows check-in without leaving the board (`boards.tsx:188-227`). But it provides no place for
future booking or rescheduling. [INFERENCE] Keeping the rail and adding a permanent Appointments
destination supports both time horizons without making the operator learn the Appointment/Visit
entity boundary.

### E4 — A cross-domain home is useful only as an exception list

The proposed “Today” page is not another version of Spine. It does not combine entities into one
row shape or replace the domain boards. It answers one question: **what needs attention now?**
Each item deep-links to its owning workspace, and each card uses that domain's vocabulary.

This follows the visibility-of-system-status heuristic while keeping irrelevant information from
competing with the user's primary goal. It is an inference from the rendered workflows and
NN/g's status/minimalism guidance, not evidence that a dashboard will be used. The existing
Dashboard destination is already present in both prototypes, so this recommendation changes its
content and label rather than adding another sidebar item (`variant-split.tsx:35-49`;
`variant-spine.tsx:73-90`).

### E5 — Healthcare usability needs realistic task validation, not an expert-review victory lap

NIST's EHR Usability Protocol combines clinical/human-factors expert review with validation by
representative users performing realistic tasks. That is the appropriate next bar here; this
prototype review is only the expert-review step:
[NISTIR 7804](https://www.nist.gov/publications/nistir-7804-technical-evaluation-testing-and-validation-usability-electronic-health).

## UI and accessibility findings before either prototype becomes production

These are implementation findings from the current prototype, not reasons to choose one
information architecture over the other.

- `apps/web/src/prototypes/patient-flow/chrome.tsx:38` — no `main` landmark or skip link; the
  rendered accessibility tree exposes the sidebar but no main-content landmark.
- `apps/web/src/prototypes/patient-flow/chrome.tsx:60` — sidebar destinations are state-changing
  buttons, not route links; active destination is visual only. Production navigation needs real
  links, URL state, and `aria-current="page"` so back/forward, open-in-new-tab, refresh and assistive
  technology all preserve location.
- `apps/web/src/prototypes/patient-flow/chrome.tsx:328` — segmented controls expose no group role
  or selected state. Use tabs with `aria-selected`, radios, or toggle buttons with `aria-pressed`;
  keep the active state in the URL for shareable/recoverable filters.
- `apps/web/src/prototypes/patient-flow/boards.tsx:111` — the doctor/department `<select>` has no
  visible label or `aria-label`.
- `apps/web/src/prototypes/patient-flow/chrome.tsx:282` — critical status badges use 10px text;
  `chrome.tsx:336` uses 11px for the frequent filter controls. Bring operational labels back to
  the existing design-system body size (`text-xs`) before increasing overall density.
- `apps/web/src/prototypes/patient-flow/variant-spine.tsx:227` — the shared visit rows have no
  column headers and are generic `div`s. If a production screen presents stable columns, use a
  semantic table with sticky headers; if the row shape varies, that is further evidence it should
  be separate boards.
- `apps/web/src/prototypes/patient-flow/variant-spine.tsx:251` — Emergency uses the same alert pill
  treatment as money due (`variant-spine.tsx:269`), so financial urgency competes with clinical
  acuity. On the emergency board, acuity/time/bed/disposition should dominate; billing stays
  secondary.

The measured application controls are 24px (filters) and 28px (navigation/actions) high. They meet
WCAG 2.2's 24-by-24 CSS-pixel minimum target size, but 24px is the floor, not evidence that the
control is comfortable for every operator. W3C specifically notes that a density control can help
users with different motor or vision needs: [Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## What this proves / does not prove

**Proves.** At the tested full-hospital fixture, Split preserves domain-specific information and
actions; Spine removes them. The current Split appointment model lacks a future-schedule
destination. The accessibility issues above are present in the prototype source and rendered
accessibility tree.

**Does not prove.** That the proposed navigation is fastest for the pilot hospital, that the staff
use the words “OPD Queue” or “Inpatient Beds,” or that a Today page deserves to exist. No
representative operator was observed. No task time, error rate, abandonment, or satisfaction data
was collected. The prototype harness and developer tools were excluded from the product UI review.

## What this means for us

1. Retire Spine from product consideration; keep it only until the decision is recorded.
2. Evolve Split into a single “Hybrid” validation prototype: Today, Appointments, OPD Queue,
   Inpatient Beds, Emergency, Patients and Billing, all permission-gated.
3. Keep “Expected today” beside OPD Queue, but limit it to imminent/arrived appointments; future
   schedule work belongs in Appointments.
4. Use domain-specific primary actions. Never reuse “New visit” across OPD, IPD and ER.
5. Fix the production-bound semantics and text-size exceptions listed above before visual polish.

## Next falsification

Run a 30-minute moderated comparison with 3–5 representative operators using realistic data. Ask
each person to complete these tasks without coaching:

1. Check in an arrived appointment and find the resulting token.
2. Register a walk-in and identify who has waited longest.
3. Find a vacant general-ward bed and start an admission.
4. Register an unidentified emergency arrival and assign a bed.
5. Find a discharge blocked by money and open the correct billing work.

Capture first-click destination, task completion, wrong turns, time, and the words participants use
for each workspace. Falsify the Today page separately: if operators bypass it after learning the
sidebar, remove it rather than preserving a dashboard by habit.

## Sources

- Rendered local prototype: `http://localhost:3004/prototypes-flow`, reviewed 2026-08-21 in all
  domain, booking, and clinic-size states.
- Local source: `apps/web/src/routes/prototypes-flow.tsx` and
  `apps/web/src/prototypes/patient-flow/`.
- Local research: [10-emr-navigation-ia.md](10-emr-navigation-ia.md),
  [12-patient-flow-end-to-end.md](12-patient-flow-end-to-end.md), and
  [13-operational-ui-for-non-technical-staff.md](13-operational-ui-for-non-technical-staff.md).
- Nielsen Norman Group, [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/),
  last reviewed 2024-01-30.
- NIST, [NISTIR 7804 — Technical Evaluation, Testing and Validation of the Usability of Electronic Health Records](https://www.nist.gov/publications/nistir-7804-technical-evaluation-testing-and-validation-usability-electronic-health), 2012.
- W3C WAI, [Understanding Success Criterion 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
  updated 2026-05-11.
- Vercel Labs, [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md),
  fetched 2026-08-21.
