# Improvement proposals (archive)

Point-in-time proposals derived from the reference-architecture research
([docs/research/01-reference-architecture-danphe-marley.md](../research/01-reference-architecture-danphe-marley.md)).
Every doc has been owner-reviewed; outcomes are in the decision log below and each doc's
`Status:` line. **The forward roadmap lives in [`docs/02-roadmap-decisions.md`](../02-roadmap-decisions.md)**
— nothing here authorizes a build.

The deferred docs are kept because they carry directional design (schema shapes, state
machines) for modules the trigger table in the roadmap may later unlock:

| Doc                                               | Proposal                                    | Revisit when                                             |
| ------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| [02](./02-appointments-encounters.md)             | Appointments + encounters, status machines  | Appointment trigger fires (roadmap decision 4)           |
| [03](./03-orders.md)                              | One generic orders table                    | Lab/radiology fulfillment is sold to the pilot           |
| [06](./06-observations-lab.md)                    | Template-driven typed observations          | Lab result entry is sold to the pilot                    |
| [07](./07-service-units-beds.md)                  | Service-unit tree, beds, occupancy          | IPD trigger fires                                        |
| [08](./08-encounter-finalization-immutability.md) | Finalization immutability + in-txn audit    | Revisit with 02; conflicts with the settled ADR 0005 call |
| [05](./05-patient-master-additions.md)            | Patient master additions                    | Implemented (v0 Slice 3, amended)                        |

## Decision log

| Date       | Doc | Outcome                                                                                                                        |
| ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-08 | —   | 01 (docs drift) and 04 (charges/billing) deleted: both fully executed/superseded by shipped code; outcomes preserved below     |
| 2026-08-07 | 01  | APPROVED — recommendations accepted as written; docs-only pass executed                                                        |
| 2026-08-07 | 05  | APPROVED WITH CHANGES — all additive columns except `status`; sex gains `unknown`; audit stays fire-and-forget                 |
| 2026-08-07 | 02  | DEFERRED — revisit after pilot feedback; v0 keeps `visits` + walk-in queue; appointments can later reference visits additively |
| 2026-08-07 | 03  | DEFERRED — orders are out of v0; carries over denormalized `category` and expected-state cancel predicate                      |
| 2026-08-07 | 04  | REJECTED — superseded by spec Slices 5–6 (snapshot charges, one-transaction issuance settled there; since implemented)         |
| 2026-08-07 | 08  | DEFERRED — revisit with 02; requires in-transaction audit, contradicting the settled audit decision                            |
| 2026-08-07 | 06  | DEFERRED — lab result entry out of v0 scope                                                                                    |
| 2026-08-07 | 07  | DEFERRED — IPD/beds out of v0 scope                                                                                            |
