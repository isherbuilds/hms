# Spec: IPD admission to discharge

Status: active — Slices 1–7 are built (D056, D063, D064, D066): Slices 1–2 on 2026-11-13, Slices 3–7 on 2026-11-17 after the owner's replan from a reference-system study. Browser verification is owed and release to a hospital remains market-gated
Authority: Founder request to replan IPD from running systems, keeping the architecture clean, simple and fast; November 2026.
Supersedes: the October 2026 Slices 3–6 of this spec (reviewed bed days, pro-rata transfer days, the package inclusion engine, the single final Invoice)

## Problem

A 10–50 bed hospital needs to know which Patient occupies each bed, what the stay has earned, how much deposit remains, and what is missing before discharge. Slices 1–2 gave it the bed board, the stay, reservations, inpatient medicine issue, posted services and one `ipd` Invoice. Before Slices 3–7 the bed itself was not charged, a deposit could not be tied to a stay, a wrong discharge could not be undone, and the stay carried none of the facts a discharge paper needs.

## Solution

Keep the stay and its occupancy segments as the single source of truth and derive everything else from them. Bed charges are computed from occupancy when someone looks at the bill or issues it; nothing is posted daily and nothing can go stale. The bill is one repeatable action: it takes every pending Charge and every bed day not yet billed, and an Admission may have more than one. Deposits are existing Advance Receipts tagged to the Admission. Discharge releases the bed independently of collection; anything unbilled or unpaid afterwards is a visible exception.

## Validation / Evidence

### Hospital desire and moat

**Desire: medium, directional rather than validated.** The supplied target-list findings identify 162 tricity prospects and 42 tier-A hospitals; most targets are IPD hospitals, 39 of 42 tier-A appear on insurer or government cashless lists, and two advertise an existing HIS. These are prospect characteristics, not requests for this workflow or evidence of insured volume. Source context: [pilot market report](../../../edernal/reports/Edernal%20Care%20pilot%20go%20to%20market.md). Cashless participation may make a patient-only IPD product insufficient; this spec does not assume otherwise.

The [buyer research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/buyers_market_competitors.md) found no independent study of Indian 10–50 bed HMS buyers. [Cliniqwise](https://cliniqwise.com/hms-for-small-and-mid-sized-hospitals-india) describes IPD/pharmacy/billing and leakage as purchase drivers: **vendor claims**. The [discovery research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/sales_script_motion.md) identifies missed bed days, pharmacy issues and discharge errors as interview hypotheses. [NestorBird's disconnected-workflow complaints](https://nestorbird.com/biggest-gaps-in-indian-hospital-software-and-how-to-fix-them/) are also **vendor claims**; quoted industry leakage percentages are not acceptance baselines.

**Moat contribution: high potential, not demonstrated.** Under the [moat thesis](../../../edernal/reports/Edernal%20Care%20moat.md), linking occupancy, issues, Charges, deposits, corrections and collections extends the trusted revenue system of record. Reconciled history and staff routines could compound operating value; a bed board or module checklist alone is copyable. Claims learning remains a later layer. Exports and source balances remain usable; trapped data is not the mechanism.

**Baseline and target:** before cutover, the billing lead measures 20 consecutive discharges: minutes from completed source review to bill issuance; missed Charge count/value found in independent register reconciliation; and net IPD revenue captured divided by independently reconciled net IPD revenue, counting inpatient medicines once. Proposed 30-day targets are at least 90% revenue coverage, zero unexplained source-to-bill discrepancies, and a 30% reduction in median bill-preparation time. These are founder proposals, not existing results or market benchmarks.

**Validation status:** no customer interviews have happened. The design below is decided, not awaiting founder/accountant consultation. A paying hospital and named operational owner must still supply real facility/tariff data, observe handoffs, measure monthly Admissions/cashless share and the baseline, and record a paid cutover with stable OPD. Existing-HIS hospitals need an operational cutover; no historic Invoice reconstruction or indefinite dual entry.

The [IPD/ADT product gate](../product.md#roadmap-gates) remains a **real market/operational gate**, not an open design question: paying hospital, named owner, stable OPD and a recorded admission-to-discharge/deposit/nursing/billing handoff. D056 accepts the paper-nursing boundary and all four conditional amendments now; it cannot manufacture a customer's adoption or signed operating commitment.

### Reference evidence and its limits

[IPD reference systems](../research/ipd-reference-systems.md) records what Marley Health, OpenMRS, Bahmni, Danphe, Care, GNU Health, Open Hospital and six published Indian hospital policies do, with pinned sources. What it changes here:

- **Kept, because every reference lacks it and suffers:** database-enforced occupancy, a board derived from open stays, issue-creates-the-Charge for inpatient medicine, deposits tied to the stay, discharge independent of payment, and nursing charts and the medication record on paper.
- **Dropped, because no reference or tariff does it:** splitting a transfer day by seconds occupied, a signed review record per bed day, and a package engine with inclusion quantities.
- **Added, because every reference has it:** discharge type, an IPD number, attendant and medico-legal facts, a discharge diagnosis, undoing a wrong discharge, recurring daily lines beside the room, and a pre-admission estimate.

The Indian evidence is six large metro hospitals, not 10–50 bed ones. The defaults under [Defaults chosen without a hospital](#defaults-chosen-without-a-hospital) are ours and change only on pilot evidence.

Tax and accounting sources are unchanged from D056 and D063: [CGST Act §§2(30), 8](https://cbic-gst.gov.in/hindi/CGST-bill-e.html), [CBIC Circular 32/06/2018 §5](https://cbic-gst.gov.in/pdf/circularno-32-cgst.pdf), [Notification 03/2022, entry 31A](https://gstcouncil.gov.in/sites/default/files/2024-05/03_2022-ctr-eng_1.pdf), [ICAI AS 9 §§7, 9](https://resource.cdn.icai.org/27275asb-as-9.pdf) and [NMC medical-ethics regulations §§1.3, 1.8](https://nmc.org.in/storage/cms/Ethics-Regulations-2002.pdf).

## User Stories / Scenarios

1. As reception, I want to admit a Patient and move beds without double occupancy, and to undo a discharge recorded on the wrong Patient.
2. As reception, I want the stay to carry its IPD number, attendant, medico-legal flag, diagnosis and how the Patient left, so the admission and discharge slips are complete.
3. As the cashier, I want the running bill, including the bed, always visible beside the deposit, so I know when to ask for a top-up.
4. As the pharmacist, I want an inpatient issue to reduce the batch and appear once on the bill, and a return before billing to simply take it off.
5. As the cashier, I want one bill action that takes everything unbilled and applies the deposit, and a second bill for anything that arrives late.
6. As the administrator, I want one screen of exceptions: who left with something unbilled, which bills are unpaid, which deposits are owed back.

## Implementation Decisions

### What stays as built

Slices 1–2 stand: `wards`, `bed_categories`, `bed_tariffs`, `beds`, `admissions`, `admission_bed_stays`, `bed_reservations`, the inpatient issue tables, `admissionKind` Charges and the `ipd` Invoice stream. `admissions` owns its own lifecycle (D013/D019): not an Encounter, Visit or Billing Account. States remain `admitted → discharge_ready → discharged`, with `cancelled` only before any delivered work. Admit, transfer and discharge keep their locks, revisions and the reservation contract (D064). Reservations get no further investment until a pilot uses more than "booked for this Patient until a date".

All procedures use `orgProcedure`, explicit `orgSlug`, tenant predicates and scope-proven references. No new grant is needed: `ipd:correct` covers undoing a discharge, `pharmacy:returnAdmission` already exists, and the desk report reuses `report:readFinancial`. Sensitive actions call fire-and-forget `audit()` after commit (D004): undoing a discharge, changing the consultant, a half or uncharged last day, returns and tariff changes.

### One rule per question

| Question                           | Rule                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When does a bed day end?           | At the hospital's checkout time (default 12:00) on the next local calendar date; later days run checkout to checkout. Minimum one day. Leaving exactly at checkout adds none |
| Which bed is charged after a move? | The bed type occupied longest within that day; on a tie, the later one. One day, one bed type, no fractions                                                                  |
| Who posts bed days?                | Nobody. They are derived from occupancy whenever the bill is read and written as Charges only inside the bill                                                                |
| Half day or grace on the last day? | The cashier picks **Full**, **Half** or **Don't charge** for the last day on the bill, with a reason for the last two. No automatic band                                     |
| What does a bed day cost?          | Every daily line of that bed type's tariff: the room plus any nursing, duty-doctor or similar line the hospital lists                                                        |
| How many bills per stay?           | Usually one. Each bill takes everything unbilled; anything later goes on a further bill                                                                                      |
| What does a deposit pay for?       | Only this Admission's `ipd` bills, applied when a bill is issued. A counter Pharmacy sale never draws on it                                                                  |
| Can a discharge be undone?         | Yes, by owner or admin within 24 hours, while the bed is still free                                                                                                          |
| Service price by room type?        | No. One price per Service; a hospital that prices by room lists separate Services                                                                                            |
| Newborn?                           | A well baby is Service lines on the mother's Admission. A baby needing its own care is its own Patient, Admission and cot                                                    |
| No bed free at arrival?            | The hospital keeps extra beds (trolley, extra cot) as real beds in a ward. An Admission always has a bed                                                                     |

### The stay record

`admissions` gains: `admissionNumber` (a per-Organization, per-financial-year running number from the existing `counter`, key `admission:${fy}`, stored and printed as **IPD No.** `${fy}/${n}`, such as `2026-27/1`; the financial year is that of the moment of entry, not of a backdated admission time, and the number is taken inside admit after the domain locks, so a refused admit uses none), optional `attendantName` and `attendantPhone`, `medicoLegal` with an optional `medicoLegalRef` (police intimation or register number), optional free-text `diagnosis`, and `dischargeType` (`normal | against_advice | absconded | referred | death`), set exactly when the stay is `discharged` (a check constraint). `medicoLegalRef` is allowed only with `medicoLegal`, also by a check; turning the flag off clears the reference. Text fields are trimmed and an empty one is stored null. The diagnosis is one line for the bill, the slips and insurer paperwork; it is not a clinical record and there is no coding.

`ipd.updateDetails` edits attendant, medico-legal, diagnosis and the consultant on an active stay (`admitted` or `discharge_ready`); an omitted field is left alone and `null` clears one. A consultant change needs a reason and is audited as `ipd.consultant.change` with the old and new Practitioner (D054). `ipd.discharge` requires `dischargeType`.

`ipd.reopen` reverses a discharge recorded in error. It needs `ipd:correct` and a reason. It is refused (`CONFLICT`, each with its own message) when:

- the Admission is not `discharged`, or `dischargedAt` is more than 24 hours ago;
- the last bed is retired, or blocked for anything other than the cleaning block placed at departure;
- another Patient has used the bed since, or this Patient has a later Admission;
- another Patient holds a live confirmed reservation on the bed.

It reopens the last stay segment, clears `dischargedAt`, `dischargeType` and `readyAt`, returns the Admission to `admitted` and lifts the cleaning block. Issued Invoices are untouched; whatever accrues afterwards goes on a further bill. Outside those conditions the answer is a new Admission. `cancelled` never reopens.

Occupancy gets one stronger guard. Two exclusion constraints on `admission_bed_stays` forbid overlapping intervals for one bed and for one Admission, covering closed as well as open segments: `EXCLUDE USING gist (org_id WITH =, bed_id WITH =, tstzrange(started_at, ended_at) WITH &&)` and the same on `admission_id`. They replace the two partial unique indexes on open stays and make a backdated correction safe at the database. The interval is half-open, so a transfer can close one segment and open the next at the same instant; a cancelled Admission's stay is closed at its start, an empty interval that never blocks a later backdated occupancy. They need `btree_gist` and are hand-authored SQL in their own migration (hard rule 4).

The **admission slip** and **discharge slip** print the IPD No., Patient, MRN, consultant, ward and bed, admission time, and the attendant, diagnosis and medico-legal reference when the stay has them; a fact with no value is left out. The discharge slip adds the departure time and how the Patient left, and a signature panel for the paper clearances: discharge summary handed over, ward nurse, pharmacy and billing.

### Bed charges

A bed type's tariff becomes a short list. `bed_tariffs` keeps the category and `effectiveFrom`; new `bed_tariff_lines` hold `tariffId`, `catalogItemId`, `dailyPrice` and `position`. `setBedTariff` takes one to ten lines, each Service at most once, stored in the given order; a Service that charges GST is refused in a hospital without a GSTIN (D063). A tariff and its lines are never edited, so a stay segment's `tariffId` is the price snapshot; `daily_price` on `admission_bed_stays` and `catalog_item_id`/`daily_price` on `bed_tariffs` are removed. Tax follows each line's Service, and only a hospital with a GSTIN adds GST (D063). The tariff form says once that non-ICU room rent above ₹5,000 a day carries 5% GST on the whole amount, so the hospital sets that rate on the room Service; nothing computes the threshold.

`organization_settings.ipdCheckoutMinutes` (default 720) is snapshotted to `admissions.checkoutMinutes` at admit, with the time zone already snapshotted there.

`bedDays(stays, admittedAt, checkoutMinutes, timeZone, through)` in `packages/api/src/lib/bed-days.ts` is a pure function returning numbered days, each with its bed type and tariff. Day 1 runs from admission to checkout on the next local calendar date; each later day runs checkout to checkout. A day counts when the Patient held a bed for any part of it up to `through`. Examples at noon checkout: admitted Monday 11:00 or 15:00 and left Tuesday 12:00 is one day; Tuesday 12:01 is two; admitted and left the same afternoon is one. A day spent five hours in the ward and sixteen in ICU is an ICU day.

`admissions.bedDaysBilled` counts the days already dealt with. Because a bill always takes every unbilled day in order, billed days are a prefix and one integer is the whole record. Bed-day Charges exist only once billed: `admissionKind: bed_day`, the tariff line's `catalogItemId`, quantity in days, and a description `{Service} · {bed type} · {date}`, or `{first date} to {last date}` for a run, with ` · half day` on a half day; dates print as `5 Nov 2026`. Consecutive days at one tariff share a line: each run gives one line per tariff line, in tariff order. Price is the tariff's; tax rate, tax code and revenue category are the Service's when the bill is read or issued. A daily line priced ₹0 gives no bill line and writes no Charge. No pending bed-day Charge ever exists, so there is nothing to invalidate when a transfer changes the answer.

A backdated transfer that would change the bed type or tariff of a day already billed is refused (`CONFLICT`); the correction is a Credit Note. A departure, or an undone departure, is never refused for it: the time the Patient left is recorded as it happened and billed days stay as billed, because they never move back. A bill issued before the Patient leaves therefore fixes the day in progress at the bed type and last-day choice of that moment; a later move or a longer stay within that day is corrected by Credit Note or a posted Service.

### The bill

`ipd.previewInvoice` returns the pending Charges, the unbilled bed days through `through`, the totals and the issued Invoices of the stay. `through` is the current time while `discharge_ready` and `dischargedAt` once `discharged`. It writes nothing.

`ipd.issueInvoice` takes `expectedChargeRevision`, `expectedGrandTotal`, `lastDay: full | half | none` with `lastDayReason` unless full, `discountAmount` under the existing OPD discount rule, `applyCredit`, up to four `payments` and `outstandingReason`. Under the Admission lock it recomputes the bed days, inserts their Charges, issues the `ipd` Invoice through `issueInvoiceTx`, advances `bedDaysBilled`, applies credit and records Payments, all in one transaction. A clock that crossed checkout between preview and issue changes the total and returns `CONFLICT`. Half is each daily line at half price, rounded half up to the paisa. A half or uncharged last day is audited as `ipd.lastDay.adjust`. A bill with unbilled bed days but nothing chargeable (an uncharged last day, or only ₹0 lines) issues no Invoice, takes no payment and only advances `bedDaysBilled`. A bill with no pending Charge and no unbilled bed day is refused, and so is a half or uncharged last day when no bed day is unbilled.

The one-Invoice rule goes: the unique index on an Invoice's `admissionId` and `requireUnbilled` are deleted, and services, issues and returns may be posted to any Admission that is not cancelled. An Invoice is still issued only when the Patient is ready to leave or has left; during the stay the hospital collects deposits against a printed interim bill.

The **running bill** is the pending Charges plus the unbilled bed days through now, tax included. `ipd.get`, `ipd.list` and `ipd.bedBoard` return it beside the deposit held, from one grouped sum over `charges_org_admission_idx`, the active stays and their tariff lines. Nothing is stored and no job runs.

Two printables come from the same read. The **interim bill** is labelled "Interim bill — not an Invoice or Receipt", shows the running bill and the deposit, and takes no number. The **estimate** is computed in the browser from the facility tariff, expected days and chosen Services, printed with the suggested deposit, and stored nowhere.

### Deposits and settlement

`advance_receipts` gains nullable `admissionId`, mutually exclusive with `treatmentPlanId`. `billing.recordAdvance` accepts it for an active (`admitted` or `discharge_ready`) Admission of that Patient, and the receipt's purpose reads `IPD deposit · IPD No. {number}`; the deposit is the existing immutable Advance Receipt and Patient Advances liability (D035), never a Payment or a balance column. At issue, credit ranks this Admission's receipts first, then the Patient's untagged credit; another Admission's or plan's credit is never spent. No OPD or counter Pharmacy Invoice draws on a receipt tagged to an Admission, and `billing.patientCredit` leaves those receipts out of usable credit. A discount needs a reason and cannot exceed the subtotal; it is spread over the lines by the existing Invoice math. The bill screen pre-fills `applyCredit` with all of this Admission's unused deposit up to the amount due. What is left over stays held or goes back through `billing.recordAdvanceRefund`.

Nothing blocks care for money. A running bill above the deposit shows **Deposit short by ₹X** on the board and the Admission; that is the whole control.

Cash received for one Admission stays under ₹2,00,000: its cash deposits plus cash Payments on its `ipd` Invoices, less cash refunded from those receipts and Invoices. Other methods are not counted. Three commands check it under the Admission lock and refuse (`BAD_REQUEST`, naming ₹2,00,000) a cash amount that would reach the limit: `billing.recordAdvance` with an `admissionId`, `ipd.issueInvoice`, and `billing.recordPayments` on an `ipd` Invoice. The limit is a constant, not a setting.

Preserve D029: the bill addresses the Patient and Sponsor remains measurement only. Patient-only IPD ships for self-pay Admissions; the [Claims contract](./cashless-claims.md) adds its allocation to the same `ipd.issueInvoice`.

### Returns and corrections

`pharmacy.returnFromAdmission` names issue lines and quantities, each line once, checks net issued quantity (issued less earlier returns) under the Admission lock and moves the goods to quarantine (D041). For a line not yet billed it voids the pending Charge and reposts the remaining quantity at the same price through the shared void path. For a billed line it creates a linked Credit Note in the same transaction for the returned quantity's share of the line, the last unit taking the exact remainder, and never more than earlier Credit Notes left on the line; a line with nothing left to credit still takes its goods back, with no Credit Note. Billed lines returned together must sit on one Invoice. Returns cannot grant discounts and never restock by deleting a Charge.

Credit Notes open on `ipd` Invoices for service, bed-day and medicine lines, through the existing Credit Note path and grants. A bare Credit Note on a medicine line corrects money only and moves no goods; the goods come back through a return, which then credits no more than is left on the line. A bed day billed in error is corrected by a Credit Note; `bedDaysBilled` does not move backwards.

### The desk report

`report.ipdDesk({asOf})` lists three exceptions, each linking to its Admission: Patients discharged on or before `asOf` with a pending Charge or an unbilled bed day; `ipd` Invoices dated on or before `asOf` with an outstanding balance, whatever the stay's state; and stays discharged or cancelled on or before `asOf` that still hold deposit. `asOf` decides who is listed, by hospital date; every amount is the current balance, so a row reconciles to its Admission or Invoice today. It is not a historical balance. [Reports](../reports.md#ipd-desk-report) owns the read and its export.

### Supply classification

Unchanged from D056 and D063. Inpatient healthcare and its naturally bundled medicines are exempt composite healthcare; an issue line is `bundled` unless the pharmacist of a GST-registered hospital marks it `independent`. `priceBasis` is arithmetic, not classification: services are exclusive, medicines MRP-inclusive, and one bill mixes both. IPD `roundOff = 0`. Document particulars follow D052.

### Locks

D040's order holds: Patient (admit only) → OPD Appointment → Admission → Beds by id → Treatment, Charge, Invoice, Product, batch, Advance Receipt. The cash limit locks the Admission before a deposit receipt or an `ipd` Invoice's Payments; a return locks the Admission, then its live Charges, then the Invoice, then the batches. Numbering series are taken after domain locks, invoice then receipt, with the admission series taken inside admit. No new replay keys or automatic retries (D039).

## Test Seams

The module interface is guarded `ipd.*`, the inpatient pharmacy procedures and the extended billing procedures; `clientFor` tests exercise the same permissions and transactions as HTTP. `bedDays` gets pure unit tests for the boundary cases above, a multi-move day, a tie, a time zone other than the default and a tariff change mid-stay. Integration tests follow `tests/integration/ipd-billing.test.ts` and `ipd.test.ts`: a stale total across checkout is refused, a second bill takes only what the first left, an uncharged last day issues no Invoice, credit never crosses Admissions, the cash limit refuses, reopen is refused once the bed is taken, and the exclusion constraints reject an overlapping backdated transfer. New procedures join `GUARDED_CALLS`.

## Task Plan

Slices are sequential: each touches the Admission schema, `ipd.ts` and the bill. One integration owner controls `access.ts`, schema and router indexes, migrations, billing helpers and navigation, and one session at a time owns a database-wiping test run.

- [x] Slice 1: Inpatient issue to a mixed-basis Invoice (built 2026-11-13; see the [work registry](../README.md#ipd-admission-to-discharge))
- [x] Slice 2: Facility, bed board, lifecycle and reservations (built 2026-11-13, D064)
- [x] Slice 3: The stay record, undo and the repeatable bill (built 2026-11-17, D066; see the [work registry](../README.md#ipd-admission-to-discharge))
- [x] Slice 4: Bed charges and the running bill (built 2026-11-17, D066)
- [x] Slice 5: Deposits and settlement (built 2026-11-17, D066)
- [x] Slice 6: Returns and corrections (built 2026-11-17, D066)
- [x] Slice 7: The IPD desk report (built 2026-11-17, D066)

## Defaults chosen without a hospital

Each is ours, taken from the nearest reference practice, and changes only when a paying hospital shows otherwise. None becomes a setting until then.

- The transfer-day rule (longest-occupied bed type) and the manual last-day choice instead of an automatic half-day band.
- One price per Service regardless of room type.
- A well newborn billed on the mother's Admission.
- Deposits spent only on the stay's own bills.
- The estimate's suggested deposit is its total rounded up to a multiple of ₹100; a total already on a multiple stays as it is.
- The ₹2,00,000 cash limit as a refusal. Its basis is believed to be Income Tax Act s.269ST; the hospital's accountant confirms it before release, including whether cash taken as an ordinary Patient advance and later applied to the stay's bill should count (today it does not).
- Whether a separately listed nursing line counts toward the ₹5,000 room-rent threshold is a question for the hospital's tax adviser; the product takes whatever rate the Service carries.

## Out of Scope

Claims and TPA tariffs, Emergency, lab and radiology order-result workflows, supplier accounts, general accounting, ABDM, payment gateway, bulk historic import, offline writes and cross-hospital analytics. IPD charges a verified Service for delivered work and does not create a clinical ordering system.

## Explicitly Deferred

Evidence-gated work gets no table, route or permission until its gate is met.

- **Packages.** Wait for a pilot hospital that quotes them. The shape then is small: the package is a priced Service on the Admission with a number of included days; while it is attached, posted lines default to included at zero price unless the cashier marks them extra. No inclusion quantities and no matching engine.
- **Typed discharge summary.** The first clinical candidate, because it is the longest wait at discharge, but it needs a clinician login. Until then the summary is paper and the discharge slip has a line for it.
- **Nursing charts, vitals, the medication record and clinical orders** stay on paper. Registered clinicians and nurses sign them; pharmacy records issue and return, not administration; reception records movement after the signed handoff.
- **Room-type pricing, an automatic half-day band, a selectable transfer rule, admission without a bed, bed swaps and a consultant history** wait for a hospital that asks.

## Open Questions

Only market gates remain: a paying hospital and named operational owner satisfying the [IPD/ADT product gate](../product.md#roadmap-gates), and measured insured volume or a signed cashless scope to choose self-pay-first or IPD with Claims. The defaults above are confirmed with that hospital, not before.
