# EMR Navigation & Information Architecture

> **Partly superseded, 2026-08-21.** The four navigation prescriptions in
> [What this means for us](#what-this-means-for-us) — census classes as filters,
> "OPD appears in zero sidebars", Visits as the post-check-in home with class
> filters inside it, and emergency staying a visit class — are **superseded by
> [ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md)**,
> which makes each care setting its own destination and its own table.
>
> Two reasons, both recorded in the ADR. The convergence claim overstates this
> document's own comparison table: Bahmni ships a top-level "InPatient" tile and
> Danphe ships Admission and Emergency as separate modules, so two of the five
> systems here already split. And
> [12-patient-flow-end-to-end.md](12-patient-flow-end-to-end.md) §Δ1 shows the
> three settings have different exit conditions, which one status column cannot
> carry.
>
> **Everything else in this document stands**, including the finding this pass
> is most useful for: _check-in is a status transition, not a screen_, and money
> is its own module reached from patient context.

Date: 2026-08-21. Question: how do established open-source EMRs structure
navigation for appointments, visits, OPD/IPD, emergency — and where does the
arrival/check-in moment live? Sources: primary repo reads (file paths cited)
plus the Danphe/Marley OPD-flow reads in `04-danphe-marley-entity-deep-dive.md`.

## Answer (lead)

No system ships a "Front desk" nav item. The arrival workflow exists everywhere,
but it is named after the **domain objects** — Appointments, Queues, Flow,
Registration — and it is always split from billing. Scheduling (future) and
arrival (today) are separate surfaces in most systems; census classes (IPD, ER)
are filters or boards, never top-level departments of the menu.

## The five systems compared

| Concern                    | Bahmni                                                                                                  | OpenEMR                                                                                           | CARE (ohcnetwork)                                                                                      | Danphe EMR                                                                                  | Marley (Frappe)                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Nav shape                  | Home launcher of app tiles, privilege-gated (`default-config/openmrs/apps/home/extension.json`)         | Menu modules + role presets (`interface/main/tabs/menu/menus/standard.json`, `front_office.json`) | One facility sidebar, permission-gated (`care_fe/src/components/ui/sidebar/facility/facility-nav.tsx`) | Module-per-domain Angular SPA (~40 modules)                                                 | ERPNext workspaces (`workspace/outpatient/outpatient.json`) |
| Appointments               | Own app, `app:appointments`; calendar + daily list                                                      | **Calendar** module IS scheduling                                                                 | Top-level "Appointments"; board/list toggle                                                            | Appointment module → converts to Visit page                                                 | Patient Appointment doctype + calendar view                 |
| Arrival / check-in / queue | Check-in = status action inside the appointments day list (`CheckinAction.jsx`)                         | **Flow** board (`patient_tracker.php`) — statuses `@ Arrived`, `< In exam room`, `> Checked out`  | Separate top-level **"Queues"** — per-practitioner token queues, service points                        | Queue Management module flips `Visit.QueueStatus`; token via stored proc after visit commit | `position_in_queue` column set at check-in                  |
| Where money lives          | — (billing via ERPNext/OpenMRS modules)                                                                 | **Fees** module: Fee Sheet, Payment, Checkout, Billing Manager                                    | **Billing ▾**: Accounts, Invoices, Payments                                                            | Billing module + counter/day-close                                                          | Sales Invoice print formats                                 |
| IPD                        | "InPatient" tile = bed grid + ADT queues To Admit / Admitted / To Discharge (`apps/ipd/extension.json`) | **Absent entirely** — no inpatient/bed/ward code in core                                          | Encounter-class filter: Patients ▾ Inpatient; beds = Locations tree (`form:"bd"`)                      | Admission module + IP billing controllers                                                   | Inpatient Record doctype + occupancy                        |
| Emergency                  | Visit type seeded alongside OPD/IPD (`banyan-config` migrations)                                        | Absent                                                                                            | Encounter-class filter: Patients ▾ Emergency                                                           | Auto-creates EmergencyPatient when department = ER param                                    | Emergency Record doctype + triage queue report              |
| Role-based nav             | Yes — every tile declares `requiredPrivilege`, filtered client-side (`appDescriptor.js:124-136`)        | Yes — per-item `acl_req` + whole-menu roles (`src/Menu/MenuRole.php`)                             | Yes — `visibility:` permission checks per link                                                         | Session user drives module access                                                           | Frappe roles                                                |

## Convergent patterns

1. **The desk is not a place; it is two domain lists.** Future book
   (Appointments/Calendar) and today's arrival flow (Queues/Flow/check-in
   status) are distinct surfaces in OpenEMR and CARE. Bahmni merges them inside
   one appointments app; nobody names either after the staff role.
2. **Check-in is a status transition, not a screen.** Bahmni
   (`Scheduled → CheckedIn`), OpenEMR (`apptstat` list values), CARE
   (`booked → checked_in`), Marley (`Checked In` + position_in_queue). The
   screen is the day's list; the action is a row button.
3. **Token/queue follows check-in, payment trails it.** CARE attaches a token
   slot at check-in; Marley computes position among checked-in rows; Danphe
   mints the number after the visit transaction commits. Receipts exist only
   where payments exist (OpenEMR `front_payment.php`, Danphe invoice print).
4. **Money is its own module**, reached from patient context or batch views —
   never fused into the arrival surface's nav identity.
5. **IPD, when present, is beds + three queues** (admit / discharge / rounds),
   i.e. a board, not a form. Emergency is a class/type everywhere except
   full-ED systems (Danphe).
6. **OPD appears in zero sidebars.** OPD is what registration +
   appointments + queue jointly serve.

## What this means for us

- Drop the "Front desk" label. The honest name is the domain: **Appointments**
  (owning schedule → check-in → token → collect), matching CARE/Bahmni naming
  and this repo's glossary rule that an Appointment may create a Visit.
- Keep one entry owning schedule + queue initially; split a "Queue" entry only
  when the day board outgrows it (CARE's split is the precedent to copy).
- Visits stays the post-check-in home; OPD/IPD/ER become class filters inside
  it (CARE pattern), which the sidebar-history note in
  `apps/web/src/lib/navigation.ts:46-52` already points toward.
- Emergency: stay a visit class; build an ER triage board only if/when the ER
  service actually runs.
- Money stays where it is (Billing); the check-in surface _collects_, it does
  not become the billing module.

## Next falsification

Watch the first real deployment's role list: if a receptionist's permission set
forces Appointments + Billing + Patients to be the entire visible sidebar, the
single-entry choice holds; if nurses start living in the queue view, split it.

## Sources

- Bahmni: `Bahmni/default-config/openmrs/apps/{home,ipd,adt,orders,ot}/extension.json`;
  `openmrs-module-bahmniapps/ui/app/common/app-framework/models/appDescriptor.js`;
  `openmrs-module-appointments-frontend/src/.../CheckinAction.jsx`;
  `Bahmni/banyan-config/openmrs/migrations/openmrs-visits-liquibase.xml`;
  docs.bahmni.org (Manage Appointments, List View pages).
- OpenEMR: `interface/main/tabs/menu/menus/{standard,front_office}.json`;
  `interface/patient_tracker/patient_tracker.php`; `library/patient_tracker.inc.php`;
  `src/Services/AppointmentService.php` (check-in/checkout status flags);
  `sql/database.sql` (apptstat seed, default_open_tabs); `src/Menu/{MenuRole,MainMenuRole}.php`.
- CARE: `care_fe/src/components/ui/sidebar/facility/facility-nav.tsx`,
  `src/Routers/routes/ScheduleRoutes.tsx`, appointments/queues pages,
  `care.config.ts` (encounter-class env filter), `pluginTypes.ts`.
- Danphe/Marley: see `04-danphe-marley-entity-deep-dive.md` and the 2026-08-21
  OPD-flow reads (VisitController.cs QuickVisitVM; patient_appointment.py
  `set_position_in_queue`).
