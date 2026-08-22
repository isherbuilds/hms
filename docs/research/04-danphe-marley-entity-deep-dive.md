# Danphe/Marley entity-level deep dive — money flows and deferred-module shapes

Date: 2026-08-10. Follows [01-reference-architecture-danphe-marley.md](./01-reference-architecture-danphe-marley.md)
(module/DocType pass) and [03-client-hms-production-sitemap.md](./03-client-hms-production-sitemap.md)
(incumbent UI pass). This pass closes doc 01's blocked items by reading the cloned sources offline —
doc 01's own "next falsification" step. Method: shallow clones combed by nine parallel subagents,
one per money/module domain; load-bearing claims re-verified by direct reads.

Sources pinned: `opensource-emr/hospital-management-emr` @ `9963822` (2024-09-02, master),
`earthians/marley` @ `cc2969b` (2026-08-09, develop). Paths below are repo-relative inside each
clone (`git clone --depth 1` to re-materialize; a scratch symlink `.refs/` was used during research
and is not part of this repo).

## Question

Do the reference implementations change our go-live decisions (handover, tender types, drawer
expenses, dues, doctor share), and what must the future module specs (pharmacy, IPD/ADT, emergency)
contain — at the entity level, not the module-name level?

## Answer (lead)

1. **ADR 0020 is validated by counter-example.** Danphe's billing→accounting boundary is an
   operator-triggered date-scoped batch, its vouchers are mutable (a PUT edit path updates/deletes
   posted lines), reversal is a destructive date+section delete with a JSON snapshot, and no
   debit=credit invariant is enforced at persistence. This is precisely the drift our
   same-transaction, append-only projection makes impossible. Do not soften ADR 0020.
2. **Cash handover is a control in every reference we have now looked at.** Danphe models it as a
   first-class two-party document with acknowledgment and a mirrored employee cash ledger — the
   same shape the incumbent showed (research 03, O5). Two independent products treating handover as
   a document, not a report, raises the odds our Slice-11 "reopen" clause fires. Interview
   accordingly.
3. **Payment modes are configuration data, not an enum.** Danphe drives tenders from lookup tables
   with per-mode/per-page split flags; split tender is child rows; the _bill_ carries the one
   fiscal-year `InvoiceNo` while tender rows do not get statutory numbers. Two consequences with
   different urgency: our `cash/upi/card` CHECK is cheap to widen by an appended migration at any
   time (wait for the interview; do not widen speculatively), while our per-payment receipt
   numbering is the outlier baked into printed documents — settle per-payment vs per-bill before
   the first live receipt.
4. **Doctor share is a whole product; do not build it.** Danphe ships a full engine — profiles,
   per-item performer/prescriber/referrer percentages, TDS, per-billing-item fraction rows, payout
   posted as an accounting voucher. Confirms the cheap v1 answer for us: consultant-wise collections
   report + accountant-side payout.
5. **Drawer expenses do not belong at the billing counter.** Danphe has no petty-cash document in
   billing; general expenses are accounting-owned manual vouchers, and supplier payments are an
   accounting/procurement workflow. Supports the SOP option (separate float) in our open question.
6. **Emergency is clinically real, and our trigger row is mis-scoped in both directions.** Danphe's
   ER has triage (coarse), disposition states (admitted/discharged/transferred/LAMA/death/DOR),
   police-case flag, consent uploads, structured bite-case capture — our trigger misses
   medico-legal and disposition entirely, while "24/7 support" is an ops commitment no software
   model establishes.
7. **Danphe's security layer is strictly behind ours; steal nothing.** Reversible MD5+3DES password
   encryption, a tautological password predicate in a validation helper, RBAC with no tenant
   dimension. Doc 01's [INFERENCE] on Danphe tenancy is now closed: `HospitalId` exists only on
   accounting config models; domain rows have counter/store/branch operational scopes, not tenant
   scope.

## Evidence

### E1 — Accounting boundary (validates ADR 0020)

- Transfer is manual and batch: `GET BillingToAccounting(SelectedDate, FiscalYearId)` then
  `POST Transactions` (`Controllers/Accounting/AccountingController.cs:225-270`). The "automatic
  transfer" console exists but its transfer calls are commented out
  (`Components/DanpheEMR.AccTransfer/Program.cs:14-37`).
- Voucher = header + lines with boolean `DrCr` and `Amount`
  (`ServerModel/AccountingModels/Transactions/TransactionModel.cs:12-29`). The validation helper
  rejects zero-ledger lines but then unconditionally resets its flag to true when lines exist
  (`AccTransfer/Accounting/AccountingTransferData.cs:737-758`) — **no balanced-entry enforcement at
  persistence** [verified read].
- Vouchers are mutable: the PUT path edits amounts/directions, inserts lines, and physically
  deletes omitted lines, logging old lines as JSON (`AccountingController.cs:3101-3112, 5900+`).
  Reversal deletes original transactions at date+section scope after a JSON snapshot
  (`AccountingController.cs:5346-5385`).
- Sync state is split across source flags (`IsTransferedToAcc`) updated _after_ the accounting
  commit via `SP_UpdateIsTransferToACC` — not atomic
  (`AccTransfer/Accounting/AccountingTransferData.cs:778-860`). No control totals/variance in the
  transfer history row (`AccountingModels/Logs/AccountingTransactionHistoryModel.cs:10-19`).
- Supplier/GRN payments live in accounting (`AccountingModels/Transactions/AccountingPaymentModel.cs:11-35`);
  no petty-cash document exists at the billing counter — general expenses are `ManualEntry`
  vouchers (`AccountingController.cs:3324-3364`).
- Marley: healthcare billing subclasses ERPNext `SalesInvoice`
  (`healthcare/healthcare/custom_doctype/sales_invoice.py:1-35`) — accounting wholly delegated.

### E2 — Cash handover / counters

- Entity `BIL_TXN_CashHandover`: `HandoverByEmpId`, `HandoverToEmpId`, `CounterId`, `HandoverType`
  (`User|Account`), bank/voucher fields, `HandoverAmount`, `DueAmount`, `ReceivedById/On`,
  `ReceiveRemarks`, `HandoverStatus` (`ServerModel/BillingModels/Handover/BillingHandoverTransactionModel.cs:10-31`;
  DbSet mapping `DanpheEMR.DalLayer/BillingDbContext.cs:196-199`).
- Status machine is exactly `pending → received` (`Websites/DanpheEMR/Utilities/SharedEnums.cs:344-347`)
  [verified read] — no reject/variance state; variance lives in the amount vs due recompute.
- Giving a handover writes a mirrored `EmpCashTransaction` (`HandoverGiven`, `OutAmount`) and
  recomputes employee due (`Controllers/Billing/BillingController.cs:7368-7398`); counter-side
  receive mirrors with `HandoverReceived`/`InAmount` (`BillingController.cs:7957-7980`). The
  account-side receive path (`UpdateHandoverTxnDetail`, `BillingController.cs:7827-7878`) sets
  received fields **without** the cash-transaction posting — an internal inconsistency; do not copy.
- Counter activation is session state, not a persisted shift record
  (`Controllers/Security/SecurityController.cs:406-456`). Pending-handover aggregates feed the
  employee due endpoint (`Controllers/Billing/BillingBL.cs:406-432`).

### E3 — Tenders, receipts, deposits, dues

- Payment modes: lookup `MasterModels/PaymentModes.cs:15-17` + per-mode settings
  `MasterModels/CfgPaymentModesSettings.cs:10` (split availability, remarks-required, page
  activation); served by settings endpoints (`Controllers/Settings/SettingsController.cs:650-696`).
- Split tender: UI emits structured split rows (`MultiPaymentDetail`), persisted as
  `EmployeeCashTransaction`/`PHRMEmployeeCashTransaction` rows with `PaymentModeSubCategoryId`
  per leg (`BillingModels/POS/BillingTransactionModel.cs:110-114`;
  `Controllers/Billing/BillingTransactionBL.cs:116-134`, `BillingSettlementBL.cs:262-265`).
- Numbering: the bill carries persisted fiscal-year `InvoiceNo`; `ReceiptNo` on the transaction is
  `[NotMapped]` (`BillingModels/POS/BillingTransactionModel.cs:47-52, 84-85`) [verified read].
  One numbered financial document per bill; tender legs are child rows. Our per-payment
  receipt numbering is the outlier — confirm with the pilot (research 03, falsification Q6).
- Deposits are transaction rows, not a balance field: type/in/out amounts, head, fiscal
  year/receipt/counter, tender details, running balance, transfer marker, refund metadata
  (`BillingModels/POS/BillingDeposit.cs:11-63`; `BillingModels/DepositHeadModel.cs`). At admission,
  OPD deposit balances transfer to the IP visit as paired Return/Deposit transactions
  (`Controllers/Admission/AdmissionController.cs:1294-1430`); final bill deducts server-recomputed
  available deposit and auto-refunds excess as `ReturnDeposit` with its own receipt and cash-out
  (`Controllers/Billing/DischargeBillingController.cs:430-522`).
- Marley portal payment is single-mode/single-gateway
  (`healthcare_settings.json:73-83`; `patient_appointment.py:576-583`) — no split-tender precedent.

### E4 — Doctor incentives

- Config: `ProfileItemMap` with `PerformerPercent`/`PrescriberPercent`/`ReferrerPercent`
  (`ServerModel/IncentiveModels/ProfileItemMap.cs:14-23`), employee-item overrides
  (`EmployeeBillItemsMap`), nested distributions (`ItemGroupDistribution` percent-or-fixed).
- Output: `IncentiveFractionItemModel` rows FK'd to `BillingTransactionId`/`BillingTransactionItemId`
  carrying `TDSPercentage`/`TDSAmount`, `IsPaymentProcessed`, `PaymentInfoId`; payout posts a PMTV
  accounting voucher via stored proc (`Controllers/Accounting/AccountingController.cs:2327-2334`).
- Marley: referral routing fields exist; no commission/share computation found.

### E5 — Pharmacy stock (donor shapes + one warning)

- Stock identity is batch-keyed: `PHRMStockMaster` = ItemId + BatchNo + ExpiryDate + cost/sale/MRP,
  owning per-store stock rows (`ServerModel/PharmacyModels/PHRMStockMaster.cs:11-27`). GRN posting
  creates lot → store availability → `PurchaseItem` stock movement → MRP/expiry history atomically
  (`Controllers/Pharmacy/PharmacyBL.cs:95-168`). Returns cap against sold-minus-returned and restore
  the exact lot (`PharmacyBL.cs:1962-2009`).
- Tax fields are **VAT-era**, not GST (per-line `VAT%` on GRN/sale lines,
  `PHRMGoodsReceiptItemsModel.cs:13-65`) — the GST pipeline (HSN, multi-rate, CGST/SGST/IGST, ITC)
  must be modeled fresh; the incumbent (research 03, O16/O28) is the better GST donor.
- Controlled drugs: a boolean `IsNarcotic` plus a sale-side `PHRMNarcoticRecord` (buyer, doctor,
  NMC number, batch, refill) inserted only when an NMC number is present — not a Schedule-H/H1
  register. Our pharmacy trigger's Schedule-H clause stands; model it fresh.
- Pharmacy credit organizations (`PHRMCreditOrganizationsModel`) are payer receivables (claims,
  copay, settlement status) — third-party credit is an AR/claims dimension, not a payment method.
- Marley delegates pharmacy/stock to ERPNext (`README.md:21-31`).

### E6 — IPD/ADT, discharge, statutory registers

- Admission is visit-keyed with separate clinical status, `BillStatusOnDischarge`, police-case flag,
  provisional-discharge flags (`ServerModel/AdmissionModels/AdmissionModel.cs:14-86`). Bed occupancy
  is interval rows (`PatientBedInfo`: ward/bed/price snapshot/Action/OutAction/Started/Ended,
  receive acknowledgment — `AdmissionModels/PatientBedInfo.cs:11-54`); transfers are
  request/accept workflows that hold both beds until nursing receipt
  (`Controllers/Admission/AdmissionController.cs:4367-4440, 5466-5522`).
- Physical discharge and financial clearance are orthogonal: provisional discharge frees the bed
  with `IsProvisionalDischargeCleared=false`; a separate settlement path clears it
  (`Controllers/Billing/ProvisionalDischargeController.cs:28-64`). Final discharge gates on
  admitted-status + sufficient deposit and closes bill, deposit, bed, and episode together
  (`DischargeBillingController.cs:258-427`).
- Statutory registers are real, dedicated entities with fiscal-year certificate numbers: birth
  (`AdmissionModels/BabyBirthDetailsModel.cs:11-53`) and death
  (`AdmissionModels/DeathDetailsModel.cs:11-44`), plus a certificate envelope
  (`PatientCertificateModel.cs:11-33`, used for "Birth Report"/"Death Report"). Strengthens our
  certificates/DOA open question: these are numbered registers, not ad-hoc prints.
- Tenancy warning: `DepositHead` and the ADT/statutory entities carry no org scope; discharge code
  selects a global default head — unsafe pattern under multi-tenancy, ours must stay org-scoped.

### E7 — Emergency

- `EmergencyPatientModel` is a real ER encounter: ER-local sequence, nullable patient/visit links
  (unknown-patient intake), arrival/referral context, `TriageCode` + actor/time, finalization
  status/remarks (`ServerModel/EmergencyModels/EmergencyPatientModel.cs:13-63`).
- Triage is four mutable strings (mild/moderate/critical/death) with undo
  (`Controllers/Emergency/EmergencyController.cs:1965-2035`) — a caution, not a donor.
- Disposition is the real state machine: admitted/discharged/transferred/LAMA/death/
  discharge-on-request each with list endpoints (`EmergencyController.cs:74-137, 1990-2015`).
- Medico-legal is only `IsPoliceCase` + consent uploads (`EmergencyModels/UploadConsentFom.cs:12-25`)
  — no MLC number/officer/custody. Bite/exposure capture is structured and configurable
  (`EmergencyPatientCases.cs:10-34`, hierarchical lookups `CoreLookupDetail.cs:11-23`).
- Boundary smell: ER registration billing is persisted with `BillingType`/`VisitType` = `outpatient`
  (`EmergencyController.cs:1061-1072, 1237-1241`) — provenance lost; our ledger must keep ER as
  source context even if pricing follows OPD rules.

### E8 — Security/tenancy (closes doc 01 [INFERENCE])

- RBAC: user/role/permission + route mapping (`DanpheEMR.Security/RbacDbContext.cs:19-40`),
  permission-name checks only (`RBAC/DanpheRBAC.cs:203-243`), `IsSysAdmin` full bypass
  (`DanpheRBAC.cs:252-289`). No tenant dimension on any RBAC row.
- Passwords: static-salt MD5-keyed TripleDES, decryptable (`DanpheRBAC.cs:356-388`) [verified read].
  A validation helper matches `a.Password == a.Password` — a tautology (`DanpheRBAC.cs:173`)
  [verified read; whether this helper is on the active login path is not established].
- Tenancy: `HospitalId` appears on accounting config models
  (`AccountingModels/Config/AccountingBillLedgerMappingModel.cs:18`); domain rows carry
  `CounterId`/`StoreId`/`BranchId` (operational scopes) and `OrganizationId` means _payer_
  (`BillingModels/Config/CreditOrganizationModel.cs:9-10`). Verdict: single-hospital per
  deployment; our `orgId NOT NULL` + guard model is strictly ahead. Doc 01's blocked entity-level
  claims are now confirmed.

### E9 — Queue/token (wave-1 scout, same clones)

- Danphe: queue number allocated at visit creation via `SP_VISIT_SetNGetQueueNo`
  (`Controllers/Appointment/VisitController.cs`); queue board = today's initiated visits with
  dept/doctor filter; staff actions checkin/skip/undo; a public display renders current/next/
  upcoming queue numbers with polling (`wwwroot/DanpheApp/src/app/billing/... queue components`).
  Status update persists a raw client string — enforce an enum server-side when we build it.
- Marley: `position_in_queue` on the appointment, computed max+1 per practitioner/service-unit
  partition at check-in (`patient_appointment.py:133-147; patient_appointment.json:70-73`);
  past appointments auto-`No Show` but remain check-in-recoverable.
- For us: queue state on the visit (Danphe's model) matches what we already ship; the public
  token display is a small read-only surface over the existing queue query — a cheap post-pilot
  win consistent with the "Token Display" gap named in research 03.

## What this proves / does not prove

- **Proves**: the entity shapes and code paths above exist at the pinned commits; every claim is
  cited; the seven [verified read] items were re-read directly, not taken from subagent output.
- **Does not prove**: operational behavior under load, which paths are dead code (the tautological
  `IsValidUser`, the inert AccTransfer console), or that Danphe's shapes reflect current Indian
  statutory practice (its tax fields are VAT-era; the repo's last commit here is 2024-09).
- Subagent caveat: findings not marked [verified read] were produced by scouts against the pinned
  clones with mandatory citations; spot-checks found no fabrications.

## What this means for us — deltas, not new scope

1. **ADR 0020: strengthen the rationale, change nothing.** Danphe is the documented counter-example
   (mutable vouchers, destructive reversal, non-atomic sync flags, unenforced balance).
2. **Slice 11 handover question: raise the prior.** Two independent references model handover as an
   acknowledged two-party document with a mirrored cash ledger. If the pilot interview confirms,
   the donor shape is E2 minus its flaws (single receive path, explicit variance, org scope).
3. **Tender/receipt interview (research 03 Q6): now has a reference answer.** Modes-as-data,
   split-as-rows, one numbered document per bill. The CHECK widens cheaply whenever the answer
   arrives; receipt granularity (per-payment vs per-bill) is the one decision that must precede
   the first live printed receipt.
4. **Doctor share: report-first is confirmed.** The in-product engine is a product of its own
   (profiles + TDS + payout vouchers). Our open question stands with better evidence.
5. **Drawer expenses: SOP option reinforced.** Neither reference puts petty cash at the counter.
6. **Future IPD spec must include**: interval-row bed occupancy with acknowledged transfers,
   deposits as append-only transaction rows with server-recomputed balances and explicit excess
   refund, orthogonal physical-discharge vs financial-clearance states, and fiscal-year-numbered
   birth/death registers (statutory, feeds the certificates open question).
7. **Future emergency spec must add** (to the roadmap trigger's clinical-safety discovery):
   unknown-patient intake, arrival/referral context, disposition state machine incl. LAMA/death,
   medico-legal (MLC) workflow, consent/refusal documents; and drop "24/7 support" as a software
   claim — it is an operational commitment to be discovered, not built.
8. **Pharmacy spec**: batch-keyed stock master + per-store balances + append-only movements
   (E5 donor), GST modeled fresh (incumbent is the tax donor, research 03), Schedule-H register
   designed from regulation, not from Danphe's narcotic boolean.

## Next falsification

- Pilot interviews (research 03 questions 1-6) — this pass sharpened them but only the hospital
  answers them.
- When the pharmacy trigger fires: read ERPNext's (not Marley's) stock ledger and GST-India app
  before speccing, since both references punt exactly there.
- Emergency donor shape: **found 2026-08-21** — Frappe Health now ships `Emergency Record`,
  `Triage Level` and `Emergency Occupancy` (commit `ac8a300`, newer than this pass). §E7's
  "model it fresh" is superseded for triage, unidentified intake, ER bed occupancy and disposition;
  see [12-patient-flow-end-to-end.md](12-patient-flow-end-to-end.md) §F8. Danphe's ER remains the
  counter-example for provenance loss.
- If appointments trigger fires: prototype the queue-display read model against the existing
  queue query before adding any schema.
  **Fired 2026-08-20** — see [11-appointment-vs-visit-boundary.md](11-appointment-vs-visit-boundary.md)
  for the entity-boundary answer (two tables, check-in is the conversion, token stays on the visit).
  This doc stays canonical for queue _mechanics_; doc 11 is canonical for the appointment/visit split.

## Sources

- `https://github.com/opensource-emr/hospital-management-emr` @ 9963822 — entity layer
  `Code/Components/DanpheEMR.ServerModel/`, security `Code/Components/DanpheEMR.Security/`,
  transfer `Code/Components/DanpheEMR.AccTransfer/`, controllers
  `Code/Websites/DanpheEMR/Controllers/` (read 2026-08-10, shallow clone).
- `https://github.com/earthians/marley` @ cc2969b — `healthcare/healthcare/doctype/`,
  `custom_doctype/sales_invoice.py`, `patient_portal/` (read 2026-08-10, shallow clone).
- Nine subagent reports (domains: tenders, handover, incentives, accounting, pharmacy, IPD,
  emergency, security, queue), each citation-gated; seven load-bearing claims re-verified inline.
