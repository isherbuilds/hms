# Client production HMS — accessible sitemap and OPD/accounting comparison

Date observed: 2026-08-10

Scope: the already-authenticated **Reception** account in the client's production HMS, including
department-dashboard labels and navigation that this account could see. Administrator, reporting,
user-management, doctor/consultant, and other role-specific inner pages were not available for
functional inspection.

Method: read-only browser inspection; no patient search, report execution, save, update, upload,
print, submit, or delete action was performed.

> Follow-up: a second session on the same date used a different account (Reception + Pharmacy +
> Nursing) and performed **authorized writes** on the UAT instance (one fake patient, one OPD bill).
> See the **Session 2 addendum** below; the Session 1 ledger (O1–O12) is preserved unchanged.

## Question

Is the client's current HMS more complete or better than accly-hms for OPD, GST, and accounting;
which parts should affect our specification or roadmap; and what surface is visible or usable from
the Reception account?

## Answer

The incumbent is **broader and more operationally complete**, while accly-hms has the stronger
foundation for a safer, clearer product. The incumbent's live OPD surface includes sponsor/MOU
discounting, emergency charges, split tender, advance adjustment, dues collection, appointment
status, item-level cancellation requests, post-discount requests, payment-mode correction,
expenses, and cashier handover. Accly-hms deliberately implements a smaller loop, but its
duplicate-aware registration, separated OPD encounter and billing workspaces, append-only financial
documents, atomic double-entry posting, and tenant-scoped permissions are the better design
direction (`apps/web/src/components/patient-form.tsx`,
`apps/web/src/components/new-opd-encounter-dialog.tsx`,
`apps/web/src/routes/$orgSlug/opd/$opdEncounterId/billing.tsx`,
`docs/contributing/architecture/accounting.md:36`, `packages/auth/src/access.ts:36`).

We can beat the incumbent on UI and financial integrity, but we cannot yet claim to beat its OPD
workflow coverage. Before pilot cutover we should validate four client workflows: shift cash
handover, correction/approval paths, sponsor/credit/split-tender frequency, and the exact GST
handover expected by the chartered accountant. The current appointment deferral should stand:
one snapshot showed zero appointments and feature presence alone does not prove usage. The current
roadmap already requires live evidence before adding appointments (`docs/02-roadmap-decisions.md:26`).

The dashboard directory also confirms that the product spans admission, EMR, inpatient billing,
laboratory, nursing, pharmacy, phlebotomy, purchase, radiology, reception, and administration.
That is evidence of product breadth, not evidence that every workflow is complete or available to
this account. The Administrator shell exposed navigation labels for user security, reports,
policies, data modification, dashboards, PACS, and technical masters, but its inner functions were
not exercised. The client also confirmed that deeper administrator/reporting/application-management
and doctor/consultant surfaces require other accounts. We should therefore plan a role-by-role
discovery session before making parity claims outside Reception.

The current GST page should be described as an **intra-state outward register**, not a GSTR-1
filing export. It contains invoice/credit-note documents plus rate and HSN/SAC summaries, but the
UI explicitly assumes CGST/SGST (`apps/web/src/routes/$orgSlug/reports/gst.tsx:43`,
`apps/web/src/routes/$orgSlug/reports/gst.tsx:170`). Official GST tooling separately models
B2B/B2C, inter-state place of supply, IGST, credit/debit notes, advances, HSN summaries, and the
document series. From the May 2025 return period, the GST portal also makes the documents-issued
table mandatory when B2B or B2C supplies are reported. See the
[GST Returns Offline Tool](https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf),
[GSTN Table 12/13 advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf),
and [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html).

## Evidence

### Observation ledger

These IDs cite direct observations of the client's authenticated production UI. They are the
primary source for incumbent behaviour. URLs, usernames, patient data, and screenshots are not
stored here.

| ID  | Surface                                                                 | Directly observed evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Reception home                                                          | Global **Search Forms**, **Search MR No**, and **Search Screen**; business date; dashboard/menu/reminder/help; counters for appointments, pending orders, cash handover, OPD follow-ups, discharge follow-up, and pending verification. Snapshot counts were 0, 0, 4, 0, 0, 0 respectively.                                                                                                                                                                                                                                                                                                                                                                      |
| O2  | Patients Registration (`wf2929`)                                        | Primary demographics plus local contact, organisation, international-patient, courier-address, other-details, and attachments tabs; camera capture, upload, registration-card print, search, tracking, and info actions.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| O3  | OPD Billing (`wf5296`, estimate; separate live OPD form also inspected) | Old/new-patient search; sponsor/self-pay, doctor/referral details; service grid with rate, quantity, user/MOU/extra discounts, GST, emergency amount, specialization, token and remarks; payment history/identification tabs; cash, debit card, cheque, credit card, advance adjustment and UPI rows; dues and service-performed actions.                                                                                                                                                                                                                                                                                                                        |
| O4  | GST R1 Summary (`rid=170`)                                              | Date/location filters; PDF, Excel, query-Excel, BI and JSON output choices; explanatory reconciliation text. The page itself says this summary covers pharmacy sales and returns. Global search also exposed detailed, summary, HSN-wise, document-series, department-wise and control GST reports.                                                                                                                                                                                                                                                                                                                                                              |
| O5  | Cash Handover (`wf1384`)                                                | Handover date/time, received-by and given-by identities, both parties' password fields, “Collect Data”, total collected amount, payment-mode/amount/scroll detail, Excel export, save, tracking, print and submit. Home showed four pending handovers at the observation time.                                                                                                                                                                                                                                                                                                                                                                                   |
| O6  | Doctor Appointments (`wf3716`)                                          | Date, location, specialization, doctor and availability filters; Excel/print; states for changed doctor, handle-with-care, new, online, paid, admitted and rescheduled appointments. Home showed zero appointments at the observation time.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| O7  | Expenses (`wf2613`)                                                     | Voucher number, group hospital, employee, payee, amount, payment mode, purpose/towards, authorization, returned-expense indicator, remarks, search/tracking and print.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| O8  | Update Financial Details (`wf2310`)                                     | Receipt type/date/number and patient lookup, mandatory update reason, previous/new payment modes, amount/card-or-cheque/date, financial voucher view, save and tracking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| O9  | OPD Bill Cancellation Request (`wf2612`)                                | Date/bill/MRN lookup, item-level selection, “Request To” authority, original totals/GST, refund, advance, post-discount, adjustment and file-charge fields, receiver and remarks, save and tracking.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| O10 | Navigation/search inventory                                             | Role menu and global form-search results listed below. Search exposed more report and import surfaces than the role's visible menu, but no general ledger, voucher-entry, trial-balance or cash-book result was available to this Reception session.                                                                                                                                                                                                                                                                                                                                                                                                             |
| O11 | Department dashboard directory                                          | Visible dashboard choices were Administrator, Admission, Electronic Medical Records, In Patient Billing, Laboratory, Nursing Station, Pharmacy, Phlebotomy, Purchase, Radiology, and Reception. This proves named product domains, not access to or completeness of their inner workflows.                                                                                                                                                                                                                                                                                                                                                                       |
| O12 | Administrator shell/navigation                                          | Selecting Administrator exposed a shell and top-level labels for SMS Server, IT Cloud Masters, Manage Users Security, Neosoft Lite Reports, Certificates, Policies Setup, Data modification, IT Tower, TAT Dashboards, Implementation 3.0, PACS, and policy families covering discount, pharmacy, payroll, inpatient, diagnostics, outpatient, financial, hospital, print activation, and discount margins. No inner form, report, policy, user, or data-modification action was opened. The client stated that deeper administrator, reporting, user-management, application-management, and clinician surfaces require accounts not available in this session. |

### Reception sitemap

The left menu exposed this role-specific surface [O1, O10]:

```text
Reception
├── Dashboards
├── Forms
│   ├── Patients Registration                       [viewed: O2]
│   ├── HWC Registration                            [not viewed]
│   ├── OPD Billing                                 [viewed: O3]
│   ├── OPD Billing Estimation                      [viewed: O3]
│   ├── OPD Bill Cancellation Request               [viewed: O9]
│   ├── OPD Bill Refund Cancellation                [not viewed]
│   ├── OPD Post Discount Request                   [not viewed]
│   ├── OPD Post Discount                           [not viewed]
│   ├── OPD Money Receipt                           [not viewed]
│   ├── Expenses                                    [viewed: O7]
│   ├── Login User Scroll Generation                [not viewed]
│   ├── MRNO WISE BILLS                             [not viewed]
│   ├── Token Display 1                             [not viewed]
│   ├── Update Registration Demographic Data        [not viewed]
│   ├── Update opd bill Demographic Data            [not viewed]
│   ├── Block Registration                          [not viewed]
│   ├── Update Financial Details                    [viewed: O8]
│   ├── Cash Handover                               [viewed: O5]
│   ├── Finance Counselling                         [not viewed]
│   ├── Self Registration                           [not viewed]
│   ├── Dead On Arrival Or Brought Dead Register    [not viewed]
│   ├── Sponsor Receipts                            [not viewed]
│   ├── Credit Bill Settlement Receipt              [not viewed]
│   ├── Patient Files                               [not viewed]
│   ├── Expense Request                             [not viewed]
│   ├── MRNO Wise Prescription print                [not viewed]
│   ├── MRNo Wise Dues Collection                   [not viewed]
│   ├── Leave Certificate                           [not viewed]
│   ├── Fitness Certificate                         [not viewed]
│   ├── Credit Bill Claiming                        [not viewed]
│   ├── Doctor Appointments Cancellation            [not viewed]
│   └── Update OP Transaction Details               [not viewed]
├── Reception Reports                               [submenu not expanded]
├── Appointments
│   └── Doctor Appointments                         [viewed: O6]
├── Master
│   └── Finance Counselling Template                [not viewed]
├── My Reminder                                     [not viewed]
└── Help                                            [not viewed]
```

Global **Search Forms** additionally exposed [O4, O10]:

- GST: item GST update/import approvals; GSTR-1 HSN detailed and summarized; GST R1/R2
  detail and summary; GST document series; department-wise and issue-based GST; patient room
  rent GST; control revenue reports.
- Financial accounts: ledger-group and ledger-master imports were discoverable. Searches for
  `Account`, `Voucher`, `Trial`, and `Cash Book` returned no accessible operational accounting
  screen in this Reception session.
- Cash handover: transaction plus a cash-handover detail report.
- Expenses: transaction, expenses/miscellaneous receipt report, and collection register excluding
  expenses/pharmacy.
- Financial corrections: update transaction plus update register.

### Cross-department dashboard sitemap

The dashboard chooser exposed this product-level directory [O11]:

```text
Client HMS
├── Administrator                       [shell/menu taxonomy viewed: O12]
│   ├── SMS Server                      [not opened]
│   ├── IT Cloud Masters                [not expanded]
│   ├── Manage Users Security           [not expanded]
│   ├── Neosoft Lite Reports            [not expanded]
│   ├── Certificates                    [not expanded]
│   ├── Policies Setup                  [second-level labels viewed]
│   │   ├── Discount / discount-margin policies
│   │   ├── Pharmacy policies
│   │   ├── Payroll policies
│   │   ├── Inpatient policies
│   │   ├── Diagnostics policies
│   │   ├── Outpatient policies
│   │   ├── Financial policy setup
│   │   ├── Hospital policy setup
│   │   └── Activate/deactivate prints
│   ├── Data modification               [not expanded]
│   ├── IT Tower / TAT dashboards       [not opened]
│   ├── Implementation 3.0              [not opened]
│   └── PACS                            [not opened]
├── Admission                           [directory label only]
├── Electronic Medical Records          [directory label only]
├── In Patient Billing                  [directory label only]
├── Laboratory                          [directory label only]
├── Nursing Station                     [directory label only]
├── Pharmacy                            [directory label only]
├── Phlebotomy                          [directory label only]
├── Purchase                            [directory label only]
├── Radiology                           [directory label only]
└── Reception                           [operational sitemap above]
```

The client separately confirmed that doctor/consultant and other role-specific surfaces exist but
are not accessible with the current account. Their exact pages, permissions, worklists, templates,
sign-off steps, and reports remain **confirmed-but-not-mapped**. The same status applies to deeper
administrator, user-management, report, and whole-application configuration pages. A blank HMS
shell occurred while switching dashboards, so inspection stopped rather than repeatedly reloading
the live production session.

### accly-hms implementation evidence

- Registration asks for a smaller clinical/demographic core, accepts DOB or age, and performs a
  debounced phone duplicate search before save (`apps/web/src/components/patient-form.tsx`,
  `apps/web/src/components/new-opd-encounter-dialog.tsx`).
- Billing separates pending charges, invoice issuance, payment, partial/full credit notes, and
  refunds. Current payment methods are cash, UPI, and card; discounts require a reason
  (`apps/web/src/routes/$orgSlug/opd/$opdEncounterId/billing.tsx`).
- Financial documents post atomically to an organization-scoped double-entry ledger and cannot
  double-post; the ledger is explicitly not a full ERP (`docs/contributing/architecture/accounting.md:3`,
  `docs/contributing/architecture/accounting.md:52`).
- Ordinary members may write billing but cannot issue credit notes; admin/owner can. Every role
  currently reads reports (`packages/auth/src/access.ts:36`, `packages/auth/src/access.ts:50`,
  `packages/auth/src/access.ts:65`).
- The product blueprint and operational-report spec require multi-terminal freshness, daily
  collections, an OPD register, unbilled work, and refund-due worklists
  (`docs/product-blueprint.md`, `docs/specs/operational-reports.md`).

## What this proves / does not prove

### Proves

- The incumbent has considerably more **available OPD and cashier workflow surface** than
  accly-hms today [O2–O9].
- Cash handover is not merely a hidden master: it has a dedicated dashboard counter and four
  pending items in the observed snapshot [O1, O5].
- The incumbent models sensitive corrections and cancellation as separate, trackable workflows,
  sometimes with a destination authority [O8, O9].
- The incumbent exposes a much broader GST report catalogue than our single outward register [O4].
- The incumbent is organized as a multi-department suite and centralizes a large policy and
  application-management taxonomy under Administrator [O11, O12].
- Its UI accumulates many fields and unrelated concerns into dense screens, while navigation labels
  and categories are inconsistent (for example, the live OPD Billing result was categorized under
  `ADMIN1`, and some headings did not match their page purpose) [O3, O5, O6].

### Does not prove

- That every exposed form is used, configured correctly, or valued by staff. Feature availability
  is not workflow frequency.
- That the incumbent's accounting entries are balanced, immutable, tenant-safe, or accepted by the
  accountant. The Reception role did not expose a usable general ledger/trial balance [O10].
- That the GST reports are filing-complete or correct. The inspected GST summary explicitly covered
  pharmacy only, and no report was executed [O4].
- That appointments should move forward now. One point-in-time zero count is suggestive, not a
  two-week demand log [O1, O6].
- Anything about patient-search quality, real-data latency, printed output, save-time validation,
  or effective permissions inside the other department shells; those paths were intentionally not
  exercised.
- That administrator, reporting, user-management, doctor/consultant, or other role-specific
  workflows are absent. The client confirms they exist, but this account cannot support a functional
  review of them [O12].

## What this means for us

### Keep — these are competitive advantages

1. Keep the narrow workflow pages and progressive disclosure. Do not reproduce the incumbent's
   single scrolling OPD mega-form.
2. Keep append-only invoices, payments, credit notes and refunds with atomic ledger posting. Do not
   copy direct financial mutation. Model correction as reversal/replacement with reason, authority,
   and a visible link between old and new documents.
3. Keep phone/UID duplicate prevention and make richer demographics optional rather than front-desk
   blockers.
4. Keep the accounting boundary: source-document projection and accountant handoff, not a second
   bookkeeping ERP (`docs/02-roadmap-decisions.md:31`).
5. Keep authorization enforced at the server and make navigation reflect it. The incumbent exposed
   administrator taxonomy to this Reception session even though deeper functions were unavailable;
   our UI should not imply that a user can operate a module merely because its name is discoverable.

### Validate before pilot cutover (P0)

1. **Cash handover:** interview the reception owner using O5's exact fields. If the four pending
   handovers represent a required day/shift close, Slice 11 must produce an acknowledged handover
   record (giver, receiver, terminal/shift, method totals, variance, time), not only a read-only daily
   collections report.
2. **GST boundary:** have the client's CA classify actual supplies and confirm whether the HMS must
   produce only source XLSX or filing-shaped GSTR-1 data. If filing-shaped data is required, model
   recipient GSTIN, recipient state/place of supply, intra/inter-state tax (CGST+SGST vs IGST),
   B2B/B2C classification, HSN/SAC split, and document-series reporting before claiming readiness.
3. **Corrections and approvals:** collect the last 20 real correction/cancellation cases without PHI:
   who requested, who approved, whether only payment mode changed, whether money moved, and expected
   printed artifacts. Then specify an append-only request → approve → reverse/replace workflow.
4. **Sponsor and tender mix:** measure self-pay vs sponsor/credit, MOU discount frequency, advance
   adjustment, and multi-mode payments. These decide whether existing Insurance/TPA triggers fire and
   whether split tender belongs before launch.

### Likely post-pilot additions (P1, only after evidence)

- Optional patient secondary contact, guardian relationship, pin/city/state and attachment capture.
- Split tender and advance/deposit adjustment if transaction sampling shows material use.
- A two-step cancellation/post-discount request when ordinary reception staff need to initiate but
  not authorize credit notes.
- A cashier/shift handover document if confirmed in the pilot SOP.
- Sponsor tariff/MOU rules only with an owner, payer master, and signed examples.

### Do not copy

- Password collection inside ordinary handover forms.
- Arbitrary mutation of receipt/payment facts.
- A universal form exposing dozens of irrelevant required fields.
- Statutory/accounting reports to every reception user by default; the existing permission split
  question remains valid (`docs/02-roadmap-decisions.md:44`).
- Report proliferation before a named reconciliation question exists.

## Next falsification

Run a 60-minute workflow interview with the receptionist/cashier and a separate 45-minute CA
acceptance session. Use anonymized counts and one synthetic transaction bundle covering cash + UPI,
split payment, discount, credit note, refund, payment-mode correction, sponsor bill, and handover.
The result should answer:

1. Are cash handovers shift-bound, terminal-bound, or user-bound, and are variances allowed?
2. Which corrections happen after printing, and which require approval?
3. What proportion of OPD bills are sponsor/credit or split-tender?
4. Does the CA need raw XLSX, Tally import, or GSTR-1-shaped data, and which GST tables are actually
   populated for this hospital?
5. Does the front desk pay any expense from the cash drawer (courier, purchases, vendor COD)?
   If yes, the day-close identity needs a separate petty-float SOP or a decision-5 amendment
   (a real `expense` posting source) — see `docs/02-roadmap-decisions.md`; a non-posting memo
   field is ruled out because ledger Cash in Hand must match the physical drawer.
6. Which tender types occur in real volume (cheque, bank transfer, sponsor credit — the
   incumbent's payment grid has all of them, O14), and does the front desk expect one receipt
   per bill or one per tender? Our `payments.method` CHECK is `cash/upi/card` — cheap to widen
   by an appended migration at any time, so wait for the answer. Receipt granularity is the
   real deadline: it is baked into printed documents, so settle per-payment vs per-bill
   numbering before the first live receipt.

Only then promote the P0 validation items into an implementation spec.

For broader product discovery, obtain temporary read-only test accounts (or supervised screen
shares) for administrator, accountant/reporting, doctor/consultant, admission/IPD, nursing,
laboratory, pharmacy, purchase/store, and radiology roles. Map one synthetic patient/order/bill
through role handoffs; do not use live patient records. For each role record visible pages, allowed
actions, approvals, report outputs, cross-role worklists, and denial behaviour. Until that pass is
complete, the department tree above is a sitemap of **known names and access boundaries**, not a
feature-parity matrix.

## Session 2 addendum (2026-08-10): authenticated Reception + Pharmacy + Nursing account, live OPD write-through

A second session used a different account — a **Reception + Pharmacy + Nursing Station** login
(user id and staff name redacted; "the Session-2 account" below) whose department picker offered
exactly those three departments. This session performed **authorized writes** on the client's UAT
instance (URL, tenant name, and build number redacted): one fake patient was registered and one
OPD bill was posted, with the client's explicit consent. No deletions were performed (the
environment is update-only). O13–O19 extend, and where noted correct, Session 1's ledger.

> Redaction note: per this document's Session-1 rule, account identities, staff and doctor names,
> URLs, and tenant/build identifiers are replaced with role-shaped placeholders throughout.
> Observation IDs (O1–O37) remain the evidence keys.

### What was written (test data, left in place)

- **Patient:** "Mr. Arjun Deshpande", 34/Male/Married, +91 9876500011, Pune address, source
  "Direct Walk-In / Self" → system assigned **Group MR No 2039**. Obviously-fake Aadhar
  `999988887777` and `arjun.deshpande.test@example.com`.
- **OPD bill:** one Consultation line (a General Medicine doctor — "Dr. K" below) at ₹500, Cash ₹500, GST
  ₹0 → system assigned **Bill No 5140** and produced an "OPD Bill Cum Receipt" PDF. Both records
  persist (update-only environment).

### O13 — Patients Registration, exact mandatory surface (extends O2)

Registration is a heavy, blocking front-desk form. Mandatory (\*) fields: Patient Name (+ title from
a 15-entry list: Prof Dr./Mx./Mr./Ms./Mrs./Miss./Master./Baby of/Baby/Dr./Prof./Br./Sr./Fr.),
DOB-or-Age with Gender and **Marital status**, Relative Details (relation + name), Mobile (with
country-code picker), Address, Area (pincode), City/District/State, Country, **Aadhar Card No**,
**Email**, and **Source of Registration**. Notable:

- **Aadhar is mandatory but unvalidated** — `999988887777` (not a real/checksummed Aadhar) saved
  without complaint. Real-PII collection with no verification.
- **Email is mandatory.**
- **Source of Registration is mandatory** and is a marketing-attribution list: Digital
  Promotional/Marketing, Corporate, Referred By Doctor, Others, Direct Walk-In/Self, Instagram,
  Paper Ad, Friend, Relative, International Medical, Hoardings, Camp, Google, Facebook, Patient,
  Practo, Online Medical Tourism Portal, Youtube, TV Ad, Embassy Referral.
- Address masters cascade: typing a **pincode** (or a city fragment) returns a City/District/State
  master; selecting one row fills city, district and state together. Free text that does not match a
  master row is discarded ("No Data Found").
- Selecting title "Mr." auto-set Gender=Male and relation=S/O.

This is precisely the "universal form with dozens of required fields" Session 1 flagged as _do not
copy_; mandatory unvalidated Aadhar + mandatory email + mandatory marketing source at the point of
registration is the sharpest example.

### O14 — OPD Billing (`wf1699`) full form (extends O3)

A single dense screen combining four regions:

- **Patient/visit block:** Search Patient (New/Old + mobile or MR No), title+name, DOB/Age/Gender,
  Mobile/Source, Relative, Mother/Father, Address, Email, **Type/Sponsor** (default
  "General/SelfPaying"), **Doctor Details\*** (attending doctor — mandatory), Referral Doctor,
  Non-Regular/Referral Doctor, Aadhar/Occupation.
- **Service grid (Testgrid):** SN, Code, Service Name (from a **398-row** service master with
  columns Service/Company/ServiceType/Rate), **per-line Doctor (mandatory)**, Rate, Qty, Total,
  **User Disc % / User Disc Amt**, **MOU Disc % / MOU Disc Amt**, **Less Disc %**. Tabs:
  Testgrid / Identification / Payment History.
- **Financial panel:** Total Amount, Final Disc Amount, **Total GST Amount**, Net Amount, Round Off,
  Paid Amount, Credit Amount, Curr Balance, **Disc Reason\***, **Disc Authorization\***,
  **Remarks\***, Package (checkbox), Advance Adjustment.
- **Payment (split tender):** a fixed grid of Cash, Debit Card, Cheque, Credit Card,
  **Adv Adjustment**, UPI (each with amount + card number), plus Opd Due Amount, Total Due Amount,
  and an Advance Search.

Both the header attending doctor and the per-line doctor are separately mandatory. The doctor master
has 11 entries (ten named doctors, redacted here as Dr. A … Dr. K excluding "self", plus a
"self" entry) with specialities. Selecting a
service defaults full payment to Cash and auto-fills Paid = Net.

### O15 — Live GST behaviour on an OPD bill

A ₹500 Consultation computed **Total GST = ₹0.00** and Net = ₹500. The printed **"OPD Bill Cum
Receipt"** (Bill No 5140) carries MR No, Bill No, token, a barcode, patient/doctor/speciality, a
Rate/Qty/Total/Disc/Amount line, the payment split, amount-in-words, and an "Authorised Signature" —
and contains **no GST fields, no GSTIN, and no tax breakup at all**. Consistent with the Indian
healthcare-services GST exemption: clinical OPD carries no GST, so the outward tax register is driven
by pharmacy, not consultations. The bill is a **combined invoice + payment receipt** in one document.

### O16 — GST report catalogue and real R1 Summary data (extends O4)

Global form search for "GST" exposed a full statutory-reporting suite (Reports → Govt Statutory
Reports unless noted):

- GSTR-1 outward: **GST R1 SUMMARY**, GST R1 DETAILS, GST R1 Detail Based On Total, **GST R1
  Summary/Details Department Wise**, GST R1 DETAILS BASED ON ISSUES.
- **GSTR-2 inward** (purchases / input tax credit): **GST R2 SUMMARY**, GST R2 DETAILS.
- **HSN-wise**: GSTR1 HSN Wise Sales Detailed, GSTR1 HSN Wise Sales Summarized.
- **GST Doc Series** (documents-issued table).
- **Individual Patients Room Rent With Gst Report** (In Patient Std) — models GST on IPD room rent.
- **Total Revenue Summarized / Detailed Cloud Control GST Std** (Control Reports Std) — revenue-vs-GST
  reconciliation.
- **Update Items New Gst** / **Update Items New Gst Approve** (Transaction → ADMISSION DESK) — a
  maker/checker workflow to change item GST.

The **GST R1 SUMMARY** page states its own scope verbatim: _"This Report Displays Total Gst amount of
Pharmacy sales and returns for the Selected date range,"_ with a note to tally against GST R1 DETAILS.
It exports to Excel-by-query, Excel, PDF, BI and JSON, with a per-location branch filter. Run for
01/01/2025–31/12/2025 it returned real data (columns **Taxable Amt | CGST Rate | CGST Amt | SGST Rate
| SGST Amt | IGST Rate | IGST Amt | NET**), grouped Location → OP → OPD Pharmacy:

| Group                      | Taxable        | CGST         | SGST         | IGST     | NET            |
| -------------------------- | -------------- | ------------ | ------------ | -------- | -------------- |
| OPD Pharmacy @5% (2.5+2.5) | 105,918.21     | 2,648.13     | 2,648.13     | 0        | 111,214.04     |
| OPD Pharmacy @12% (6+6)    | 1,520.37       | 91.22        | 91.22        | 0        | 1,702.80       |
| OPD Pharmacy @18% (9+9)    | 672.82         | 60.55        | 60.55        | 0        | 793.92         |
| OPD Pharmacy Returns @5%   | −491.73        | −12.29       | −12.29       | 0        | −516.35        |
| **Grand total**            | **107,619.67** | **2,787.61** | **2,787.61** | **0.00** | **113,194.41** |

So the incumbent's GST register is **pharmacy-only**, models **multiple rate brackets (5/12/18%)**,
carries **IGST columns** (inter-state capable, here zero because supplies are intra-state Punjab),
and represents **returns as negative lines** (credit notes reduce GST). Our current GST page is an
intra-state **CGST/SGST-only** outward register with fixed Documents/Rate/HSN sheets and no
IGST/place-of-supply, GSTR-2, or document-series modelling.

### O17 — Accounting boundary confirmed for this role (corroborates O10)

Form search for "account", "trial", and "ledger" returned **no accessible screen** in Reception.
There is no general ledger, trial balance, voucher entry, or cash book here; the accountancy module
is a separate surface this account cannot reach. GST statutory reports are reachable, but
double-entry bookkeeping is not.

### O18 — Reception Reports inventory (extends O10)

The previously-unexpanded Reception Reports submenu holds roughly **fifty** operational reports plus
a "Doctor Performing Reports" sub-submenu. Representative titles: Patient Registration Sourcewise; OP
Consultation Summary/Report/Time-Wise; **All Users Collection (STD/Location-Wise/Time-Wise), UserWise
Collection, User Wise Collection Summary Time Wise, Group User Wise Collection, Login User
Collection**; **OP Revenue Summarized, Organisation Wise Revenue Register, Department Wise Collection
Report**; **Refund/Cancellation, All Refund Report**; **Detailed Cash Dues, User Wise Dues Report**;
**Consultation OPD TAT**; **Cash Handover Details Report**; MRNO Wise Bills, Daily Patient Detail,
Billed Service/Investigation Wise, Package Wise Patient Details, Service Rate Variant Report,
**Corporate Bills Summary**, Appointment Booked, Doctor Schedule Register, and Update
OP-Transaction/Financial/Demographic registers. Far broader than our planned daily-collections +
OPD-register + unbilled/refund worklists (go-live Slices 11–12).

### O19 — OPD Money Receipt (fills a Session-1 gap)

A dues/advance receipt keyed to a bill: Receipt Type (e.g. "OP Due") + MR No, OPD Bill No / Cancel
No, patient, then Receivable Amt + payment-mode, Card/Cheque details + date, and mandatory Remarks.
It records money collected against an existing OPD bill's dues, or an advance — separate from the
bill's own payment capture.

### O20 — Post-discount and refund/cancellation forms (extends O9)

Two more OPD-prefixed correction workflows were opened this session:

- **OPD Post Discount Request** — a retrospective, per-line discount against an existing bill. Grid
  columns: Service, Unit/Doctor, Net Amt, **Post Disc**, **Post Disc Amt**, **Post Net Amt**. The
  financial panel makes **Disc Authority\***, **Disc Reason\***, Disc Remarks\* and **Pay Mode\***
  mandatory and computes a **Due/Refund** line — i.e. an authority-gated discount applied after
  billing, with refund if the bill was already paid. Its counterpart **OPD Post Discount** is the
  approval/execution side (not opened this session).
- **OPD Bill Refund Cancellation** — item-level cancellation with refund. Grid has Select-All plus
  per-line **GST % / GST Amt**, so cancellation reverses GST as well; a **Pharmacy** tab lets it
  include GST-bearing pharmacy items. The financial panel carries Total, Total GST, Net, **Refund
  Amount**, **Advance Adjusted**, File Charges, mandatory **Payment Mode\*/Card No\*/Reason\*/Check
  Date\***, Received By, and Refundable Amount.

Both reinforce Session 1's recommendation: the incumbent models corrections as separate,
authority-and-reason-gated, GST-aware documents with explicit refund payout — which maps cleanly to
our intended append-only request → approve → reverse/replace pattern rather than mutable edits.

### What Session 2 changes about the conclusion

Session 2 does not overturn Session 1's verdict — the incumbent remains broader and more
operationally complete, and accly-hms keeps the better design direction — but it sharpens two things:

1. **GST is a pharmacy/retail concern, not an OPD one.** With clinical OPD exempt, a pure-OPD product
   needs no GSTR-1 at all; our GST outward register only becomes meaningful once we bill taxable goods
   (pharmacy/consumables). When we do, we will need multi-rate, IGST/place-of-supply,
   returns-as-negatives, HSN-wise and document-series modelling — none of which our single CGST/SGST
   register has yet.
2. **The incumbent's registration and billing forms are demonstrably heavier than Session 1 could
   confirm** (mandatory unvalidated Aadhar, mandatory email, mandatory marketing source,
   dual-mandatory doctor, per-line + final discounts requiring reason and authorization). Our narrow,
   progressive-disclosure flows remain the stronger UX; do not import these mandatory-field walls.

## Session 3 addendum (2026-08-10): Pharmacy module walk-through (via omp browser relay)

Access: the same Session-2 account reaches the Pharmacy dashboard. The login
department picker offers only Reception / Pharmacy / Nursing, but the post-login "Multiple Menu"
chooser (`admin/dismulitplemenu.jsp`) navigates to **any** of the 11 dashboards — this session saw
it land on Laboratory and then Pharmacy. This turn was driven through the **omp browser relay**
(Chrome DevTools over the user's own tab), **read-only**: forms were opened and their DOM extracted,
but nothing was saved (no sale, no stock movement). Current UAT pharmacy stock is empty (the sales
item picker returns zero in-stock rows for any query), so a live GST-bearing sale could not be
posted; the GST mechanism is instead evidenced by the POS field model (O23) and the 2025 GST R1 data
(O16).

### O21 — Pharmacy dashboard (formid wf1220)

Counters: Online Indent, IP Indent, **Online Receiving**, OPD Prescriptions, Return indents,
Pharmacy Approval, Indent Approval, Manual Indent Approval, Pending Pharmacy Items. The dashboard is
indent/inventory-centric (requisition → approve → issue/receive), not sales-centric.

### O22 — Pharmacy menu (35 forms + Reports + Master)

Forms: OPD Pharmacy Sales; OPD Pharmacy Returns; OPD Pharmacy Post Discount Request; OPD Pharmacy
Post Discount; IPD Issues; IPD Returns; Online Indent; Online Issues; Online Issues Multiple;
Offline Issues; Stock Adjustment; IP Medicine Indent; Indent Cancellation; IPD Returns Indent; IPD
Return Indent Cancellation; Pharmacy Clearance; Stock Enquiry; Login User Scroll Generation; Ph
Money Receipt; Pharmacy Package; Change MRP and Expiry; Online Indent Closure; Update Pharmacy
Details; Physical Stock Verification; Stock Variance Justification; MRNo Wise Dues Collection; IPD
Issues ward; Update Financial Details; Expenses; **Update Items New Gst** / **Update Items New Gst
Approve** (GST maker/checker); Pharmacy Concession Request; MRNO Wise Prescription print; Update
Pharmacy Transaction Details. Master: IP Medicine Indent Template.

### O23 — OPD Pharmacy Sales POS (formview wf1988)

The retail counter, and the source of all pharmacy GST. Per-line item grid: Item Name (+ **Brand
Replace** generic-substitution checkbox), Rack No, Pack, **Batch No, Stock, BStock (batch stock),
Sale Qty, MRP, Mrp/Pack, Exp Date**, User Disc %/Amt, MOU Disc %/Amt, Disc %/Amt, Net Amt, **Tax(%)
/ Tax Amt** (per-line GST at the item's rate), **SP, MarginAmt, Spaftermargin** (margin capture),
**Highrisk** flag, Rate, Net Rate. Financial panel: Total, Discount %/Amount, **Tax Amount**, Net,
Round Off, Paid/Due/Currbalance, mandatory **Authorized By**, Discount Reason, Amount In Words, an
"Allow With Zero Stock" override, Prescription Copy. Multi-tender payment (Cash/Debit/Credit/Cheque/
Adv Adjustment/UPI) plus a Card Reader button. Print template is literally **"GST OPD Sales"**. So —
unlike the ₹0-GST OPD consultation receipt — the pharmacy invoice is a full **GST tax invoice** with
per-line taxed lines, batch/expiry dispensing, generic substitution, and margin tracking.

> Aside: the form's DOM also leaks an embedded **regression-test harness** — hidden grids with
> "Test case scenario / Input control name / Expected Value / Actual Output / Result" columns —
> i.e. the vendor ships QA scaffolding into production markup.

### O24 — Drug master and Stock Enquiry (formview wf2789)

The sales item picker exposes MEDNM | MEDCODE | STOCK | GENERICNM | CATEGORY (name, code, on-hand,
generic, category). Stock Enquiry shows, per selected item: **department-wise stock, Qty, Day
Consumption, Rack No, Stock Details, Total Quantity**, with a consumption date range and Excel
export. Batch/expiry is maintained through **Change MRP and Expiry** and surfaced by the
Nearing-Expiry reports.

### O25 — OPD Pharmacy Returns (formview wf2690): GST-reversing credit note

A batch-aware return against an OP bill: grid of **Issued Item, Batch No, Exp Date, Total Iss Qty /
Issued Qty / Return Qty**, MRP, each discount layer, **Tax Unit / Tax Amt**, plus Amount/Rate/SP. It
reverses the sale's GST per line and pays a refund (Paid/Due/Current Balance). This is the mechanism
behind the negative "OPD Pharmacy Returns" rows in the GST R1 Summary (O16).

### O26 — Pharmacy Reports catalogue (~60 reports)

A mature retail + hospital-pharmacy reporting suite:

- **GST/tax:** GST R1 Summary, GST R1 Details, GST R1 Detail/Summary Based On Total, GST R1 Details
  Based On Issues, GSTR1 HSN Wise Sales Detailed, HSN Wise Sales Register, plus legacy **VAT Sale
  Register** Summarized/Detailed (evidence of the product's pre-GST age).
- **Inventory analytics:** Nearing Expiry (STD/Day), Non Moving Items, Fast Moving Items (+ Generic
  Name wise), **ABC Analysis Report**, Stock Ledger Std, Stock Adjustment Report, Consumption
  Report, Captive Consumption Register, Current Item List (STD/All/Rack/Category/Manufacture/Pack-size
  wise), Total Emergency Medicine Stock Out List.
- **Sales/revenue:** Sales Register (Summary/Detail/without Rate/Without Type), Item Wise / Item Type
  Wise Sales Register, MRNo Wise Sales, Consultant Wise IP And OP Sales, Day Book Pharmacy (+ based
  on total).
- **Margin:** Detailed Margin Report, Summarized Margin Report.
- **Clinical/regulatory:** **Schedule Register** (Schedule-H drugs), **High Risk And High Alert
  Report**, Formulary, Sale Report Antibiotic-wise, **Antibiotic Consumption Report** (stewardship).
- **Collections/dues:** Login User / Userwise / Group User Wise Collection, Discount Register,
  Detailed Total Outstanding Pharmacy Control Report.
- **Indents/issues:** Online / Offline Issue Register (+ details, + category wise), IPNo-wise
  issue/return summary & detail, Cancellation Indents.

### O27 — Procurement boundary

Pharmacy's inbound is **internal**: Online Indent → approve → Online/Offline Issues, plus an "Online
Receiving" counter (store→pharmacy transfer). **External supplier procurement (purchase order, GRN,
inbound GST / GSTR-2 input-tax-credit) is a separate Purchase department**, not mapped this session;
the GSTR-2 reports seen in O16 belong to that inbound side.

### O28 — GST item configuration (Update Items New Gst, formview wf5365) + maker/checker

How GST attaches to stock: each item carries an **HSN Code** and a tax rate. The "Update Items New
Gst" grid lists **Item Group, Medcode, Item Name, Generic Name, HSN Code, Current Tax, Proposed
Tax**, with **Import/Export Excel** for bulk changes; a proposed rate is then applied through the
separate **Update Items New Gst Approve** step (maker/checker). So the full GST chain is:
per-item HSN + rate (config, bulk-editable, approval-gated) → per-line Tax(%)/Tax Amt at sale (O23)
→ GST-reversing return credit note (O25) → GSTR-1 R1/HSN/doc-series + GSTR-2 inward reporting (O16,
O26). That is a complete, filing-oriented GST pipeline — the shape our single intra-state CGST/SGST
outward register would have to grow into if we ever bill taxable goods.

### What Session 3 means for us

Repo state (verified by RepoPharmacyScout): **no pharmacy/inventory/stock schema or code exists
today** — `charges.sourceType` is only `consult_fee | manual`, the catalog has no pharmacy bucket,
so a pharmacy line today would be a generic `manual` charge; `journal_entries.sourceType` is
free-form, so a future pharmacy module posts additively to the existing ledger without a reporting
rewrite. The roadmap keeps Pharmacy **deferred** behind its explicit trigger (two live weeks + paid
commitment + named owner + clean opening stock + signed-off sale/return/purchase/adjustment).

When that trigger fires, a pharmacy module must match the mechanics the incumbent proves are
non-negotiable — **batch + expiry stock, MRP/margin, per-line GST at the item's HSN rate, returns as
GST-reversing credit notes, and expiry / fast-moving / ABC inventory reporting** — while avoiding
what makes theirs hard to use: one dense mega-grid, QA scaffolding leaking into production markup, and
~60 near-duplicate registers. Our edge is the same as in OPD: narrow progressive-disclosure screens;
append-only documents posting atomically to the existing ledger (new `sourceType`s only, e.g.
`pharmacy_sale` / `pharmacy_return`); and a curated report set answering named questions. This is
genuinely a product of its own (dedicated `pharmacy`/`inventory` schema — item, batch, stock-ledger,
sale, return, indent), consistent with the roadmap's "depth before breadth".

## Session 4 addendum (2026-08-10): full department sweep (all 11 modules)

Read-only relay sweep of every department dashboard reachable from the "Multiple Menu" chooser (`admin/dismulitplemenu.jsp`). The account's login picker lists only Reception / Pharmacy / Nursing, but the chooser opens **all 11** dashboards — so this account can _functionally_ reach Admission, EMR, In Patient Billing, Laboratory, Nursing Station, Phlebotomy, Purchase, Radiology and Administrator too. Per-module analysis was fanned out across parallel subagents, each grounding the incumbent module against our roadmap (`docs/02-roadmap-decisions.md`) and reference-architecture notes. No patient PHI is recorded (Phlebotomy exposed a live collection worklist with real names/bill numbers — deliberately excluded). Cross-module flow confirmed: the Session-2 OPD bill (assigned to "Dr. K") surfaced in that doctor's **EMR** OPD queue, i.e. billing → clinical worklist is wired.

This makes the incumbent's true shape explicit: a **full 11-module hospital suite** (front-desk/OPD, pharmacy retail + inventory, ADT/admission, IPD billing, nursing, EMR, laboratory, phlebotomy, radiology/PACS, purchase/SCM, and an administrator/policy console). accly-hms is deliberately **OPD-only today**; each module below is a _deferred_ slice gated on trigger evidence, not a current gap to close.

### Module map (incumbent scope vs our status)

| Module                     | Incumbent scope                                                                      | Our roadmap status                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Admission                  | IPD ADT — admit/discharge, bed·room·unit, TPA, occupancy, extra-room                 | Deferred — IPD/ADT+beds trigger (`docs/02-roadmap-decisions.md:59`)                     |
| Electronic Medical Records | Clinician desktop — OPD queue, follow-ups, indoor patients, OT list, critical values | Deferred — Stage-2 clinical depth (`docs/02-roadmap-decisions.md:22-25`)                |
| In Patient Billing         | IPD finance — final bill, TPA/credit, doctor-share, gate-pass, post-discount         | Deferred — IPD/ADT+beds trigger (`docs/02-roadmap-decisions.md:59`)                     |
| Laboratory                 | LIS — sample receive → report → tech/consultant approve, machine values, notifiable  | Deferred — in-house lab trigger (`docs/02-roadmap-decisions.md:57`)                     |
| Nursing Station            | Ward ops — medicine indents, handover, assessments, bed transfer, discharge          | Deferred — IPD/nursing (`docs/02-roadmap-decisions.md:59`)                              |
| Phlebotomy                 | Sample collection + reject/transfer + outsourcing worklist                           | Deferred — lab-adjacent (`docs/02-roadmap-decisions.md:57`)                             |
| Purchase                   | Procurement/SCM — PR → PO → GRN → vendor payment, purchase-return credit note        | Deferred — supports pharmacy/stock (`docs/02-roadmap-decisions.md:56`)                  |
| Radiology                  | RIS — accept → receive → scan → report → approve, PACS, outsource                    | Deferred — radiology trigger (`docs/02-roadmap-decisions.md:58`)                        |
| Administrator              | Config/governance — users·security, policies, masters, SMS/integration, TAT          | Not a parity target — minimal audited admin only (`docs/02-roadmap-decisions.md:11-16`) |

### O29 — Admission

**Incumbent:** The incumbent Admission module is more than a single admit/discharge screen: it looks like an inpatient operations hub with live counters for admissions, discharges, occupancy, room status, pending discharges, and pending SLA-sensitive worklists, coupled with finance and authorization surfaces. Forms indicate end-to-end ADT control (admit, cancel, change room/unit/paytype, allot/release extra room), bed/ward/room placement management, and payer-finance intervention points (TPA approvals, IP money receipt, package/application updates). Together, the form names imply both clinical state transitions and inpatient revenue-control workflows are handled in one department rather than split into smaller domain surfaces, while no LIS/RIS sample lifecycle or SCM/GRN mechanics are explicit here.

**Key forms:** Today Admissions; Today Discharges; IP Information; IP Admission; IP Admission Cancellation; IP ChangeRoom; IP Change Unit; IP Change Paytype; IP Allot Extra Room; TPA Approvals; Rooms Under Discharge

**Our status:** Deferred in our roadmap: decision 1 of `docs/02-roadmap-decisions.md` keeps Stage-1 go-live OPD-only and defers department modules until post-live trigger-based sequencing (`docs/02-roadmap-decisions.md:11-16`, `docs/02-roadmap-decisions.md:49-53`). The trigger table then gates IPD/ADT + beds behind stable live evidence and ready operations—roughly four stable weeks, paid IPD scope, service-unit/bed master data, and documented nursing ownership/deposits (`docs/02-roadmap-decisions.md:59-60`).

**Takeaway:** Copy the sequencing discipline and explicit gating, plus clear ADT state transitions and capacity/worklist counters; avoid shipping this as a single dense form cluster. Worth adopting is a narrow, task-oriented flow (admit → assign bed/ward → transfers/movement → discharge) plus compact dashboard signals for risk (overdue transfers, pending requests), tuned for smaller screens and low-context switching. Avoid their dense mega-form/report-sprawl habit, where one module mixes admission, room logistics, billing edits, approvals, and estimates in a single overloaded surface. Our narrow-screen + append-only-ledger posture does it better by modeling each patient action as immutable events feeding Charges/ledger entries (`docs/02-roadmap-decisions.md:31-35`) so finance corrections stay auditable and non-destructive.

### O30 — Electronic Medical Records

**Incumbent:** The EMR surface is a broad clinical operations hub, not just charting. Its form set (`New Patients`, `Follow Up Patients`, `Total OP Patients`, `Todays OPD`) implies registration follow-up and OPD worklist orchestration; `My Appointment` implies schedule/arrivals and clinician assignment workflows; `Indoor Patient`/`Indoor Patients` plus `Today OT List` imply inpatient/ADT and surgical scheduling handoffs; `Critical Value Alerts` implies lab-result escalation/state workflows; `Referred Patients`/`VIP Patients` imply prioritization and routing/contract overlays. Cross-module naming (`Admission`, `Laboratory`, `Nursing`, `Radiology`, `Pharmacy`, `Purchase`) in the same dashboard map indicates this module is embedded in a full HMS stack, with forms likely consumed by lab/radiology/ADT/billing boundaries.

**Key forms:** New Patients; Follow Up Patients; Total OP Patients; Todays OPD; My Appointment; Indoor Patient; Indoor Patients; Critical Value Alerts; Referred Patients; VIP Patients; Today OT List

**Our status:** Out of the box, our roadmap keeps this as deferred clinical depth, not part of current Stage-1 OPD go-live. We are explicitly OPD-first (`docs/02-roadmap-decisions.md:1-4`, `docs/01-mvp-decisions.md:7`), and Stage 2 adds timeline + vital capture only after Stage 1 (`docs/02-roadmap-decisions.md:22-25`). Department-sized expansions are trigger-gated (`docs/02-roadmap-decisions.md:51-60`): lab results, radiology, IPD/ADT, OT, ABDM, Insurance/TPA and payment gateway all have explicit evidence triggers; there is no unconditional EMR go-live trigger. So EMR-form parity is currently sequenced behind operational evidence and is not an active delivered slice.

**Takeaway:** Worth copying: the clear module decomposition by clinical domain and explicit domain-specific worklists (appointments, indoor cohorts, OT list, critical-value escalation) are strong UX/product signals we should preserve as we expand. Avoid: reusing their dense multi-purpose mega-forms and form/report sprawl, especially mandatory fields that block flow and hidden coupling between registration, billing, and clinical status. Our advantage is a narrow, mobile-first workflow surface plus a status-machine model: keep each increment focused (e.g., OPD board, appointment follow-up, inpatient admission board), and model corrections as append-only reversal/approval artifacts linked to originals. Add new EMR capability only when its trigger fires, while continuing our source-document + idempotent posting model (`ADR 0020`) to keep money and audit safety clean.

### O31 — In Patient Billing

**Incumbent:** This module is a full inpatient operations+finance surface, not a single billing form. Dashboard counters (Admissions, Discharges, Current Occupancy, Final Bill, Pending Bills, Pending Prov Gatepass, TPA Approvals, Financial clearance) indicate live tracking of the inpatient lifecycle plus finance/exception queues. The form list shows explicit ADT-to-settlement flow (`Admissions`, `Discharges`, `IP ChangeRoom`, `Update IP Transaction Details`), charge/bill lifecycle (`IP Billing`, `IP Money Receipt`, `Final Bill`, `Room Rent Entry`, `Un Settle Final Bill`), and heavy correction/exception handling (`IP Post Discount`/Request, `IPD Bill Cancellation`/Request multiples, payer authorization and sponsor-credit paths like `Authorization From TPA Final`, `Credit Bill Claiming`, `Credit Bill Settlement Receipt`, `Financial clearance`) alongside operational adjuncts (`Surgery Events`, `OT Notes`, doctor-share/package forms, gatepass controls).

**Key forms:** Admissions; Discharges; Final Bill; IP Billing; IP Money Receipt; IP ChangeRoom; Room Rent Entry; IP Package Apply; IP Post Discount Request; IP Post Discount; IPD Bill Cancellation; Authorization From TPA Final

**Our status:** Roadmap keeps IPD out of phase-0/1 execution: the product goes live only on the OPD loop first, and department modules (including IPD/ADT) are trigger-driven, not automatic (`docs/02-roadmap-decisions.md:11-15`). In the deferred-modules table, IPD/ADT + beds is explicitly behind the gate of stable live evidence (`~4 weeks`, paid scope, bed/service-unit readiness, and documented admission→discharge/deposit/nursing ownership) (`docs/02-roadmap-decisions.md:49-60`).

**Takeaway:** Worth copying: the notion of explicit lifecycle gates (admit/discharge/finalize/clearance), and separate approval/reversal pathways for corrections/discounts/claims instead of silent edits. Avoid copying: one dense, wide-scope form surface and cross-domain report sprawl that blurs module boundaries and overwhelms narrow screens. Our approach should keep IPD as a compact, role-driven workflow surface (small screens, narrow cards, deep links) and enforce ADR-0020 append-only financial behavior: bill, correct, cancel, or refund by creating immutable ledger-preserving events with authority trails. This is safer than mutable receipt rewrites and scales better with org-scoped multi-tenancy and narrow mobile UI constraints.

### O32 — Laboratory

**Incumbent:** The incumbent’s laboratory module is a broad LIS-like operations stack: sample intake and triage (Sample Receiving, Bulk Sample Receiving, Sample Receiving Pending), exception handling (Reject Sample), processing handoff (Transfer Of Samples To Processing Unit), staged technical/clinical signoff (Technician Approval LAB, Consultant Approval, Lab Reporting Pending), and alert/reporting flows (Critical Value Alerts, control/report surfaces). Dashboard counters for receiving/reporting/approvals reinforce that work is organized as stateful queues, while location-scoped forms suggest station-based routing and multi-bay operations. Extra forms like Laboratory Control Tower, Machine Value Report, Lab Cloud Reports, and Notifiable Diseases Investigation List indicate parallel operational monitoring, equipment/integration concerns, and compliance reporting in the same domain. In short, this is not just order-entry; it spans sample lifecycle governance, result stewardship, and institutional reporting.

**Key forms:** Sample Receiving; Bulk Sample Receiving; Transfer Of Samples To Processing Unit; Reject Sample; Sample Tracker Report For login locationUser; Technician Approval LAB; Consultant Approval; Lab Reporting Pending; Lab Approvals Pending; Critical Value Alerts; Laboratory Control Tower; Lab Cloud Reports

**Our status:** Roadmap keeps this module deferred for now: v0 sequencing is OPD-first and departments are trigger-gated (`Decision 1`, docs/02-roadmap-decisions.md:10-11, 51-52). The explicit trigger for `In-house lab results` requires confirmed in-house ownership, approved templates/reference ranges, and two weeks of test volume before build (`docs/02-roadmap-decisions.md:57`). Until the module exists, lab/billing is funneled through ordinary Charges as an interim boundary (`docs/02-roadmap-decisions.md:68-69`), and accounting remains an append-only projection boundary (ADR 0020) with no mutable finance side channels (`docs/02-roadmap-decisions.md:31-33`).

**Takeaway:** Copy the useful parts: explicit status-based worklists, role-specific approvals, and critical-value escalation (they are operationally high signal). Keep location/role-aware queueing and keep lab results as part of a unified service/charge flow instead of an isolated accounting domain. Avoid their dense mega-form pattern that mixes intake, routing, approvals, analytics, and print/export concerns in one place—especially risky on narrow screens. In our product, use narrow screens per workflow step (sample receive → process assignment → result/review → approval → release/alerts), with immutable append-only events for transitions and separate read-model reports so auditability is preserved without mutable post-hoc lab ledger edits.

### O33 — Nursing Station

**Incumbent:** In this product the Nursing Station sits as the inpatient clinical operations domain, not a tiny task screen: the dashboard surface itself is rich in care-ops counters (Admitted Patients, Ward Receiving, Assessments, Bed Transfer, Discharges, pending Orders/Indents, and sample/blood-related alerts), which matches an ADT + ward-management workflow. The form set implies a full inpatient loop: admitting/searching IP cases, assessments, intra-IP transfers and bed changes, discharge preparation/summary tracking, and nursing ownership tasks (handover/clearance/doctor handoff), plus embedded interfaces to pharmacy indent/returns, PAC/imaging, OT scheduling, and special-cases (birth/death/critical alerts). It is therefore a broad nursing/clinical floor module that coordinates other departments rather than a single clinical form.

**Key forms:** Admitted Patients; Ward Receiving; IP Information; IP Enquiry; Discharge Intimation; Bed Transfer Note; IP ChangeRoom; Nurse Hand Over Process STD 2.0; Critical Value Alerts; Discharge Tracker 2.0; IP BILLING REQUEST; PAC Request

**Our status:** Roadmap treatment is deferred and sequenced: decision 1 requires the pilot to stay on the completed OPD loop first, with department modules gated behind triggers, not started by menu breadth (`docs/02-roadmap-decisions.md:1-4`). The deferred-matters row for this domain is `IPD/ADT + beds`, triggered only after ~4 stable weeks, paid scope, service-unit/bed master data, and nursing ownership documentation (`docs/02-roadmap-decisions.md:58-60`). Cross-role mapping is still incomplete: the competitor’s Nursing Station was accessible in a supervised account, but mapped only as a functional/supervised pass after OPD write-through, so our current scope remains pre-implement; do not infer full parity from label presence (`docs/research/03-client-hms-production-sitemap.md:84,119-123` and `docs/02-roadmap-decisions.md:119-123`).

**Takeaway:** What to copy: the scope intent (ADT/bed flow, nurse-led shift continuity, handoff artifacts, and separate request/approval/closure paths) is meaningful for inpatient depth, and the workflow counters are good anchors for nurses on small screens if reduced to role-relevant worklists. What to avoid: dense mega-forms, universal mandatory fields, and report/form sprawl, plus any mutable correction of financial outcomes on an existing record. Our better pattern is to defer this module until the IPD trigger gates are proven, then implement it with narrow mobile-first screens per task (ward receive, transfer, assessment, discharge) and immutable event records where billing requests/adjustments create append-only ledger-affecting source docs (the product blueprint and ADR 0020 approach) and auditable state transitions instead of in-place edits (`docs/product-blueprint.md`, `docs/contributing/decisions/0020-double-entry-posting-in-billing-transactions.md:1-12`, `docs/contributing/architecture/accounting.md:9-13`).

### O34 — Phlebotomy

**Incumbent:** The competitor exposes Phlebotomy as a separate department surface with a dedicated queue/worklist signal (`Sample Collections` counter = 5) and a large form set. The forms imply a pre-analytical lab workflow spanning sample intake, physical control, and transport: queueing/collection, receiving, uncollect/reject/print and transfer handoffs, plus lab outsourcing. Presence of `Out Source ...` forms and reporting views shows this module also owns logistics, dispatch/receipt reconciliation, throughput, and compliance reporting, not just bedside collection. The breadth (including notifiable-disease and performance reporting) suggests a clinically operational module beyond lightweight OPD work.

**Key forms:** Sample Collections; Sample Collection LAB; Sample Receiving; Reject Sample; Un Collect Sample LAB; Transfer Of Samples To Processing Unit; Bulk Printing Login Location Wise; Out Source Sending Test Details; Out Source Received Test Details; Out Source Test Details; Phlebotomy Report

**Our status:** Deferred and sequenced after go-live readiness. Roadmap decision #1 makes OPD the first full loop; department modules (including lab/Pharmacy/Radiology/IPD) are not started early (docs/02-roadmap-decisions.md:11-16). Lab fulfillment is explicitly gated under `In-house lab results` with explicit owner, templates/reference-ranges, and two weeks of test volume triggers (docs/02-roadmap-decisions.md:57). Until such fulfillment exists, tests are invoiced through ordinary Charges as an interim boundary (docs/02-roadmap-decisions.md:68-69), and Stage 2 is planned only after Stage 1 (`implement` go-live) (docs/02-roadmap-decisions.md:133-134). Cross-role evidence lists Phlebotomy as a product domain but notes capability is not confirmed yet (docs/02-roadmap-decisions.md:118-120).

**Takeaway:** Worth emulating: explicit end-to-end sample state transitions (collect/receive/dispatch/return), separate outsourcing handoff steps, and queue-level visibility for operational control. Avoid emulating: the incumbent’s dense mega-form/report-sprawl pattern where one module bundles lifecycle control plus many disparate reports and administrative screens into one broad workstream, which is hard to operate on narrow screens. Better for our OPD-first, append-only design: keep phlebotomy as a small set of mobile-friendly actions backed by immutable sample events; map financial impact through charge events and ledger-safe reversals (credit-note/refund) rather than mutable invoice edits; preserve clean separation from RIS/LIS imaging/report modules so sequencing stays manageable and auditable.

### O35 — Purchase

**Incumbent:** The module is a full procurement-and-storefulfillment surface, not a clinical workflow. Its dashboard counters (Online Indent, Online Receiving, Pending Purchase Request, PO Approval, Purchases, Challan Process, Scm Approvals, Pending Manual Indent, etc.) imply a state-driven backlog of inbound demand, supplier purchase creation, receiving, and clearance. The form set shows the implied lifecycle from request → approval → procurement doc issuance/ amendment → issue/receipt validation → stock/variance audit → return/vendor settlement, plus independent report/control surfaces. In practice this is a departmental, operational-control module with inventory, compliance, and financial-impacting handoffs, separate from OPD consultation billing.

**Key forms:** Purchase Request; Purchase Request Closure; PO Plan For Pending PR; Purchase Order; Corrigendum Purchase Order; PO Cancellation; PO Short Closure; Draft GRN; Delivery Challan; Challan GRN; Stock Variance Justification; Physical Stock Verification

**Our status:** Roadmap is OPD-first: all department modules are deferred until live evidence and owner signoff, with explicit sequencing for staged delivery (`docs/02-roadmap-decisions.md:11-14`, `docs/02-roadmap-decisions.md:49-56`). Procurement/supply depth is intentionally absent from Stage 1, and the deferred strategy currently names Pharmacy POS + stock, not a separate Purchase slice (`docs/02-roadmap-decisions.md:56`, `docs/02-roadmap-decisions.md:68-69`). Given Danphe’s hospital module baseline includes Inventory as a full module (`docs/research/01-reference-architecture-danphe-marley.md:77-79`) and the incumbent explicitly surfaces a Purchase dashboard (`docs/02-roadmap-decisions.md:119-120`), this is a later-phase fulfillment slice to be gated by trigger evidence and pilot approval.

**Takeaway:** Copy the idea of explicit procurement states and separation of concerns: request queue → approval gates → receipt/goods verification → payment settlement, with dedicated SCM worklists. Avoid their dense mega-forms and report sprawl, plus broad one-screen conflation; prefer task-specific, narrow, mobile-friendly steps. With append-only ledgers, record purchase-origin charges as immutable source-linked entries (no retroactive edits), enforce explicit authority transitions, and generate only the reports required by pilot workflows instead of shipping all report modules up front.

### O36 — Radiology

**Incumbent:** The competitor’s Radiology surface is a full department lifecycle, not a single report viewer. Dashboard counters and forms imply a workstream spanning intake/scheduling, scan execution, and post-scan controls: work is queued as accepted/received, then advanced through start/complete scan states, routed to reporting, placed in approval, and optionally exported/outsourced. The presence of scheduling forms (Appointments/Scan Appointments), operational control surfaces (Scan Reception Tracker, Control Tower), compliance/reporting forms (Radiology Reporting, Notifiable Diseases Investigation List, radiology printing/login surfaces), and consultant-facing approval steps indicates workflow ownership, result validation, and report dispatch plus financial handoff touchpoints.

**Key forms:** Scan Reception Tracker FW; Radiology Acceptance; Patient Receiving; Start Scan; Complete Scan; Radiology Reporting; Approval Pending; Consultant Approval; Radiology Outsource; Notifiable Diseases Investigation List; Radiology Control Tower

**Our status:** Deferred in our roadmap; we intentionally ship OPD first and only start Radiology when its per-module trigger is met: named owner maps workflow, report-storage/integration choice is decided, and operational demand plus report-attachment volume justifies it (`docs/02-roadmap-decisions.md:11-12,58`). The product blueprint keeps radiology evidence-gated and omits execution and result tables until that trigger is met (`docs/product-blueprint.md`). ADR-0020 keeps billing immutable source-of-document and constrains accounting expansion before new modules are sold in (`docs/02-roadmap-decisions.md:31-34`).

**Takeaway:** Copy the useful shape: explicit state transitions for imaging work (accept → receive → start → complete → reporting → approval) and a single modality-agnostic order contract instead of separate per-modality lifecycle code. Keep consultant approval and private report attachment handling, but avoid report-sprawl across 20+ form surfaces; on narrow screens this should be one high-signal, role-aware workflow. Our append-only ledger rule means radiology should generate additive charge events (consult/manual/charge rows) and immutable report artifacts, with reversals handled through reversal entries rather than editing posted financial rows (`docs/02-roadmap-decisions.md:31-34`).

### O37 — Administrator

**Incumbent:** Administrator is a cross-cutting operations shell for platform governance rather than direct OPD transaction entry. Its supplied forms point to telecom/integration setup (SMS Server, IT Cloud Masters), user/security administration, reporting and certificates, policy authoring, and data-change/audit-adjacent workflows. Dashboard counters in the sweep (especially cash handover + pending verification-like work items) suggest this role is positioned near closeout/risk-control and workflow orchestration, while deeper operational surfaces are in many department dashboards rather than here. The form and dashboard layout show broad domain coverage with centralized configuration pressure and role/permission control, not a narrow clinical module.

**Key forms:** SMS Server Std; IT Cloud Masters; Manage Users Security; Neosoft Lite Reports; Certificates; Policies Setup; Data modification; IT Tower; TAT Dashboards; Implementation 3.0

**Our status:** ROADMAP STATUS: OPD-first sequencing with deferred department slices remains the governing trigger model (`docs/02-roadmap-decisions.md:11-13,54-66`), and Administrator is explicitly called out as _confirmed-but-unmapped_ rather than as a built/finalized slice (`docs/02-roadmap-decisions.md:124-126`). It is therefore out of scope for this immediate Stage-1/Stage-2 sequencing (`docs/02-roadmap-decisions.md:17-24`) until role ownership, safety, and configuration workflows are explicitly mapped; no separate Administrator trigger exists in the deferred table.

**Takeaway:** Copy: keep the idea of a central governance plane (role-aware admin taxonomy + policy families for discount/finance/clinical modules, permissions matrices and deployment controls) and strong approval boundaries. Avoid: the incumbent's dense, multi-purpose mega-forms and broad menu exposure that reveal many unavailable/unmapped functions to end users, plus monolithic cross-module settings crammed into one screen, as it increases mistakes and discoverability debt. Do better in accly-hms: ship a narrow, mobile-first admin surface with explicit role-gated entry points, only the workflows needed by pilot owners, and immutable history for sensitive operations (reuse append-only financial posting for corrections via reversal/request-approve-replace flows, not in-place edits), which is safer with org-scoped access and cleaner auditability for ADR-0020 ledger integrity.

### What Session 4 means for us

The sweep confirms breadth we cannot (and per the roadmap should not yet) match: the incumbent runs the whole hospital, while we run a tight OPD loop. Nothing here is a defect in accly-hms — every module is an explicitly deferred slice with a named trigger. What the sweep buys us is **concrete, form-level scope for each future slice**: ADT state transitions and bed/room status (Admission); TPA/credit/doctor-share and gate-pass/final-bill lifecycle (In Patient Billing); a sample→process→report→approve state machine with machine values and notifiable-disease lists (Laboratory/Phlebotomy); an accept→receive→scan→report→approve lifecycle with PACS and outsourcing (Radiology); and a PR→PO→GRN→vendor-payment→purchase-return-credit-note chain that is where **inbound GST / input-tax-credit (GSTR-2)** actually originates (Purchase). Our edges carry across all of them: narrow progressive-disclosure screens instead of mega-forms, append-only documents posting atomically to the one org-scoped ledger (new `sourceType`s only), server-enforced authorization, and a curated report set rather than the incumbent's per-module dozens. Build each only on its trigger, designed intent-first now.

## Sources

- Client production HMS, authenticated Reception account, read-only observations O1–O12 on
  2026-08-10; role-access limits for administrator and clinician surfaces confirmed by the client.
- Client production HMS, authenticated **Reception + Pharmacy + Nursing** account (the Session-2 account),
  2026-08-10 Session 2; **authorized writes** performed (MR No 2039, Bill No 5140) on the UAT
  instance; observations O13–O19.
- Internal implementation and decision files cited inline by `file:line`.
- [GST Returns Offline Tool — GSTN](https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf).
- [Phase 3 Table 12 and mandatory Table 13 advisory — GSTN](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf).
- [Tax Invoice, Credit and Debit Notes rules — CBIC](https://cbic-gst.gov.in/gst-invoice-rules.html).
- [GST/IGST overview — CBIC](https://cbic-gst.gov.in/about-gst.html).
- Client production HMS, authenticated **Pharmacy** dashboard (the Session-2 account), 2026-08-10 Session 3;
  read-only walk-through via the omp browser relay (formids wf1220 dashboard, wf1988 OPD Pharmacy
  Sales, wf2789 Stock Enquiry, wf2690 OPD Pharmacy Returns); observations O21–O27.
- Client production HMS, authenticated all-department chooser (the Session-2 account), 2026-08-10 Session 4; read-only relay sweep of the nine remaining department dashboards + menus (Admission, EMR, In Patient Billing, Laboratory, Nursing Station, Phlebotomy, Purchase, Radiology, Administrator); per-module analysis fanned out across parallel subagents; observations O29–O37.
