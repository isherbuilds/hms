# Reference HMS: payment-method taxonomy, insurance/TPA payers, and cheque handling

Pinned 2026-09-03. Bahmni `bahmni-core@04a5299` (+ `openerp-modules@420cf5d`,
`openerp-atomfeed-service@6c4f271`, `odoo-modules@4fbe199` (Odoo 10),
`bahmni-odoo-modules@c7bfa18` (Odoo 16)); Danphe
`opensource-emr/hospital-management-emr@9963822`; Marley
`earthians/marley@4d8bfc3` (`healthcare` 17.0.0-dev, `develop`) +
`frappe/erpnext@f895103`. Snapshots age; re-verify before reusing for a new
decision.

## Questions

1. Is the payment-method list a fixed enum or a deployer-editable master, how is
   each method mapped to a ledger account, and can one bill be settled by several
   methods at once?
2. How is money owed by an insurer, TPA, government scheme, or corporate employer
   modelled — as a payment method, or as a separate payer with its own
   receivable? What happens to the invoice's outstanding while a claim is
   pending, and how is a disallowed amount written off?
3. Is an uncleared cheque held in a clearing account before it clears?

## Answers

1. **Two of three make the method list an editable master, and all three map a
   method to a ledger account — but only ERPNext's mapping is actually honoured
   at posting time.** Danphe ships a `MST_PaymentModes` master and a
   payment-mode→ledger mapping screen whose result the posting code ignores in
   favour of a hard-coded cash-vs-bank branch. Bahmni has no method entity at
   all: a "payment method" is an Odoo `account.journal`, and the modern shipped
   database seeds zero of them. Splitting one bill across several methods is
   supported by Danphe (unbounded, unvalidated) and by ERPNext but **only in POS
   mode**; Bahmni cannot split at all. HMS's fixed enum plus a `max(4)` bound is
   more constrained than every reference, and deliberately so.

2. **A payer is a separate entity with its own receivable in the two references
   that model it, and modelling it as a payment method is a demonstrated bug, not
   a shortcut.** Bahmni seeds India's RSBY government insurance scheme as a
   cash-type journal in the cashier's method dropdown; settling by RSBY debits a
   liquidity account and reconciles the patient receivable in full, so the
   scheme's obligation never becomes a receivable and the bill reads as settled.
   Marley and Danphe both instead post the payer's share to a per-payer
   receivable at invoice time, leaving only the patient's share outstanding on
   the invoice. Marley does it per invoice line via a Journal Entry; Danphe does
   it via a per-invoice open-item row plus a per-organization sundry-debtors
   sub-ledger. Both split patient share from payer share **at line level** with a
   coverage or co-payment percentage, and both carry a per-payer price list.

3. **No reference holds an uncleared cheque in a clearing account.** ERPNext's
   `clearance_date` has zero GL effect and is a bank-reconciliation reporting
   flag; its shipped "Cheque" mode maps to no account at all. Danphe collapses
   cheque and card into one pseudo-mode and debits bank on the day of receipt.
   Bahmni has no cheque handling whatsoever. The clearing-account treatment is
   something a deployer configures, never something a reference ships.

## Evidence

### Q1 Payment-method taxonomy

**Bahmni — a method is an Odoo journal, and nothing is seeded.**

- The cashier's "Payment Method" label is a relabel of Odoo's journal picker:
  `openerp-modules/bahmni_customer_payment/voucher_payment_receipt_view.xml:16-22`
  replaces `journal_id` with `domain="[('type','=',['cash'])]"
widget="selection" string="Payment Method"`.
- The Odoo 10 line removed the cash-only restriction deliberately:
  `odoo-modules/bahmni_account/models/account_payment.py:47` widens the domain to
  `[('at_least_one_inbound','=',True)]`, with the rationale comment at `:9-11`.
- GL mapping rides the journal's own `default_debit_account_id` /
  `default_credit_account_id`, read at posting time:
  `openerp-modules/bahmni_customer_payment/account_voucher.py:210`.
- **The only seeded method is an insurance scheme** (see Q2):
  `openerp-modules/bahmni_seed_setup/data/payment_method.xml:19-27`. No cash,
  card, UPI, cheque, or bank journal is seeded anywhere. The modern shipped
  database is empty of accounting config: `odoo-modules/package/docker/freshDB/odoo_clean_dump.sql:38997`
  (`COPY public.account_journal`) is immediately followed by `\.` — zero rows.
- **No split.** `account.voucher` and `account.payment` each carry one scalar
  `journal_id`. The one-to-many `line_cr_ids`/`line_dr_ids`
  (`account_voucher.py:318-320`) splits one payment across many _invoices_, not
  one invoice across many _methods_; the Odoo 16 equivalent names it
  `outstanding_invoice_lines`
  (`bahmni-odoo-modules/bahmni_auto_payment_reconciliation/models/account_payment.py:18-24`).
  A cash+card split is two receipt documents.

**Danphe — an editable master with no CRUD, and a ledger mapping the posting
code ignores.**

- Two layers. The invoice header carries a hard-coded 2-value major mode,
  `ENUM_BillPaymentMode { cash, credit }`
  (`Code/Websites/DanpheEMR/Utilities/SharedEnums.cs:27-31`), stored as a free
  string (`BillingModels/POS/BillingTransactionModel.cs:44`). Tender types are a
  DB master, `MST_PaymentModes` (`MasterModels/PaymentModes.cs:10-17`), with
  per-page enablement in `CFG_PaymentModeSettings`
  (`MasterModels/CfgPaymentModesSettings.cs:10-23`).
- **The master has no create/update endpoint.** The only write is
  `PUT UpdatePaymentModeSettings`
  (`Controllers/Settings/SettingsController.cs:600-655`), which mutates display
  and validation flags only. Adding a tender type requires direct SQL.
- Shipped tender types, recovered from the SQL Server backup that carries the
  schema (`Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip`):
  Cash, Cheque, Credit, Deposit, e-sewa, FonePay, IPS Connect, Khalti, Others,
  POS-1, POS-3. Note that `Deposit` and `Credit` sit among real tenders.
- A per-mode ledger mapping exists in `ACC_LedgerMappings` and has an admin
  screen (`Controllers/Accounting/AccountingController.cs:448-500`), **but the
  posting code that would use it is commented out**
  (`Code/Components/DanpheEMR.AccTransfer/Accounting/AccountingTransferData.cs:3034-3056`,
  source list at `:2997`). The live path is a hard-coded binary:
  `AccountingTransferData.cs:3072-3074` picks `ACA_CASH_IN_HAND_CASH` when
  `PaymentMode == "cash"` and `ACA_BANK_HAMS_BANK` otherwise, after collapsing
  card and cheque into a pseudo-mode `"bank"` at `:2197`. e-sewa, Khalti, FonePay
  and POS-1 all land in one bank ledger regardless of configuration.
- **Split is unbounded and unvalidated.** N rows persist to
  `TXN_EmpCashTransaction` (`Controllers/Billing/BillingTransactionBL.cs:114-136`)
  with no server-side check that the rows sum to the bill
  (`grep Sum(` in that file hits only unrelated deposit aggregation). The client
  guard is broken: `payment-mode-info.component.ts:464` negates a _method
  reference_ rather than calling it, so `if (!this.CheckForValidAmount)` is
  always false; the method itself (`:479-489`) overwrites its verdict each
  iteration so only the last row counts.

**Marley/ERPNext — an editable master with a per-company account mapping, and a
split that works only in POS mode.**

- `Mode of Payment` is a normal user-editable doctype (`autoname:
"field:mode_of_payment"`, `allow_rename: 1`):
  `erpnext/accounts/doctype/mode_of_payment/mode_of_payment.json:3-5,8`. Four
  fields only: `mode_of_payment`, `enabled`, `type`, `accounts` (`:10-46`).
- Five shipped defaults, created at setup-wizard time and **translated strings**,
  so they are seed data rather than identifiers:
  `erpnext/setup/setup_wizard/operations/install_fixtures.py:260-269` — Cheque
  (or "Check" in the US), Cash, Credit Card, Wire Transfer, Bank Draft.
- Ledger mapping is a per-company child table, `Mode of Payment Account`
  (`mode_of_payment_account.json:7-26`), one row per company enforced at
  `mode_of_payment.py:34-41`. Resolution throws when unmapped:
  `erpnext/accounts/doctype/sales_invoice/services/pos.py:323-336`. Only the
  `type == "Cash"` mode is auto-wired on company creation
  (`erpnext/setup/doctype/company/company.py:842-853`), so every other shipped
  mode ships unmapped.
- `type` (Cash/Bank/General/Phone, `mode_of_payment.json:28-33`) carries no
  accounting meaning of its own — the account comes from the `accounts` table.
  _(Inference from its observed uses: company bootstrap, a read-only display
  fetch, and a list filter.)_
- **Split exists but is POS-gated.** `Sales Invoice.payments` is
  `depends_on: "eval:doc.is_pos===1"`
  (`erpnext/accounts/doctype/sales_invoice/sales_invoice.json:1408`). Each row
  posts its own GL pair — credit `debit_to` against the customer, debit that
  row's account —
  `erpnext/accounts/doctype/sales_invoice/services/gl_composer.py:470-521`. No
  row cap exists. `Payment Entry` is single-mode (one scalar `mode_of_payment`,
  one `paid_from`, one `paid_to`), so a non-POS split is two Payment Entries.

### Q2 Insurance, TPA, and corporate payers

**Bahmni — no payer model exists, and a scheme is a cash journal.**

Whole-repo, case-insensitive greps across all four repos return zero real hits
for `payer`, `tpa` (whole word), `copay`, `deductible`, `claim`, and `scheme`;
every non-zero cell is a false positive (`Disclaimer`,
`TestUsernameAuthenticationScheme`, k8s `PersistentVolumeClaim`, a French
translation string). `bahmni-core` itself contains zero files matching `invoice`,
`insurance`, `receivable`, or `ledger`; its only billing artefact is
`BahmnicoreApi/.../BillingSystemException.java:5`, which has no call sites.

- **RSBY, India's national government health-insurance scheme, is seeded as an
  `account.journal` of `type=cash`**:
  `openerp-modules/bahmni_seed_setup/data/payment_method.xml:19-27`, selectable
  in the cashier's method dropdown at
  `bahmni_customer_payment/voucher_payment_receipt_view.xml:17-21`. Its account
  is `110403 RSBY`, `type=liquidity` (`payment_method.xml:5-11`).
- One receivable, the patient's, read straight off the partner:
  `bahmni_customer_payment/account_voucher.py:206` and
  `bahmni-odoo-modules/bahmni_sale/wizard/sale_advance_payment_inv.py:47`.
- Consequence: posting an RSBY voucher reconciles the invoice
  (`account_voucher.py:314-315` sets `rs['reconcile'] = True`), so **the bill
  reads settled while the scheme has paid nothing**. Outstanding is computed
  purely from unreconciled patient move lines
  (`bahmni_sale_discount/invoice.py:309-316`), with no payer dimension anywhere
  — confirmed by the shipped reporting SQL,
  `openerp-modules/bahmni_sale_ipd_opd_report.sql:86-95,124-130`.
- The only reduction mechanism is an invoice-level scalar discount posted to a
  named charity head: `bahmni-odoo-modules/bahmni_account/models/account_invoice.py:15-23`,
  with heads seeded as diseases and donors (`ATT`, `CANCER`, `HIV`, `LEPROSY`,
  `POOR PATIENT`, `OXFAM`, …) at
  `openerp-modules/bahmni_seed_setup/data/discount_heads.xml:5-124`. That is a
  pre-settlement charity write-down chosen by the biller, not post-claim
  adjudication. _(Inference, from where in the flow it is applied.)_
- No claim states, no claims worklist, no payer write-off.

**Marley — nine dedicated insurance doctypes and a real per-line ledger
transfer.**

- Doctypes, all owned by `healthcare/` (ERPNext owns none): `Insurance Payor`,
  `Insurance Payor Contract`, `Insurance Payor Eligibility Plan`, `Item Insurance
Eligibility`, `Patient Insurance Policy`, `Patient Insurance Coverage`,
  `Insurance Claim`, `Insurance Claim Coverage`, plus an Insurance workspace.
  Installed by a v16-line patch: `healthcare/patches.txt:14`.
- The payer is **also** an ERPNext Customer, auto-created on save into an
  `Insurance Payor` customer group: `insurance_payor.py:26-71`, link field at
  `insurance_payor.json:43`. Payer-side accounts are two `Party Account` child
  tables, `claims_receivable_accounts` and `rejected_claims_expense_accounts`
  (`insurance_payor.json:87,94`), pushed down onto the Customer at
  `insurance_payor.py:73-101`.
- **Line-level split.** Custom fields on `Sales Invoice Item` — `coverage_rate`,
  `coverage_qty`, `coverage_percentage`, `insurance_coverage_amount`,
  `patient_insurance_policy`, `insurance_payor` — `healthcare/setup.py:82-186`.
  Arithmetic runs on every validate through a mixin
  (`custom_doctype/sales_invoice.py:97-111`):
  `item.insurance_coverage_amount = item.amount * 0.01 * item.coverage_percentage`,
  then `patient_payable_amount = outstanding_amount - total_insurance_coverage_amount`.
- Coverage percent comes from `Item Insurance Eligibility`, matched on
  item/template + plan + validity window, newest first
  (`item_insurance_eligibility.py:123-176`). Per-payer price list has a
  three-level fallback: plan → payer contract `default_price_list` → Selling
  Settings (`patient_insurance_coverage.py:214-247`).
- **The transfer is a real posting.** On `Sales Invoice.on_submit`
  (`hooks.py:125-129` → `utils.py:1029` → `:1071`), one Journal Entry per covered
  line debits the payer's claims-receivable account with `party` = the payor's
  Customer (`utils.py:1133-1141`) and credits the invoice's `debit_to` with
  `party` = the patient, carrying `reference_type: "Sales Invoice"` and
  `reference_detail_no` = the item row (`utils.py:1144-1155`). It throws when the
  payer has no receivable account (`utils.py:1122-1131`). Account selection is
  payer + company with a company-default backstop (`insurance_payor.py:104-113,
132-143`).
- **Therefore the invoice's outstanding equals the patient share only.** ERPNext
  recomputes `outstanding_amount` purely from the Payment Ledger
  (`erpnext/accounts/utils.py:2182-2230`), and the JE lands there against that
  voucher. `patient_payable_amount` on the header is display-only — the sole
  reader is the mixin that writes it.
- Claim state machine: header `Draft / Submitted / Completed / Cancelled / Error`
  (`insurance_claim.json:126`), driven at `insurance_claim.py:118-153`; lines
  `Draft / Submitted / Approved / Completed / Error / Rejected / Cancelled`
  (`insurance_claim_coverage.json:209`), with a **required** `payment_error_reason`
  on rejection (`insurance_claim.py:57-110`). A coverage already on a live claim
  cannot be re-claimed (`:155-182`).
- **Two holes.** There is no write-off path: `get_insurance_payor_expense_account`
  throws when unconfigured (`insurance_payor.py:116-127`) but **nothing calls
  it** — one grep hit, its own definition. `grep write_off` across `healthcare/`
  returns zero. A rejected line sets `rejected_amount` and flips the claim to
  `Error`; the debit raised against the payer at invoice time is left standing
  and needs a manual JE. _(Inference: no reversal path was found, rather than an
  explicit statement that none exists.)_ And there is no claims aging or denial
  report — the six shipped reports are all clinical.
- No eligibility interchange: zero hits for X12, EDI 270, or payer API. Coverage
  is internal masters plus a `policy_expiry_date` check.

**Danphe — a fat scheme master, a per-invoice payer open item, and two ways the
receivable closes too early.**

- Entities: `BIL_CFG_Scheme` (`BillingModels/Config/BillingSchemeModel.cs:9`),
  `BIL_CFG_SubScheme`, `BIL_MST_Credit_Organization`
  (`Config/CreditOrganizationModel.cs:6`), `BIL_CFG_PriceCategory`,
  `BIL_MAP_PriceCategoryVsScheme`, `BIL_MAP_PriceCategoryServiceItem`
  (per-tariff price, `Config/BillMapPriceCategoryServiceItemModel.cs:14`),
  `BIL_MAP_ServiceItemSchemeSetting` (per-scheme per-item co-pay,
  `Config/BillServiceItemSchemeSettingModel.cs:16-18`), `PAT_MAP_PatientSchemes`
  (policy number at `PatientModels/PatientSchemeMapModel.cs:14`),
  `BIL_TXN_CreditBillStatus`, `INS_TXN_InsuranceClaim`, `INS_TXN_ClaimPayment`.
- The scheme is the rule carrier and is fat — ~50 columns
  (`BillingSchemeModel.cs:13-84`): three independent credit ceilings (`:24-29`),
  six per-touchpoint credit toggles (`:30-35`), co-payment percentages
  (`:38-43`), nine discount percent/editable triples (`:44-64`),
  `DefaultCreditOrganizationId` (`:65`), `ApiIntegrationName` (`:79`). ECHS,
  NGHIS, Medicare and SSF exist only as strings in that last field
  (`shared-enums.ts:456-461`).
- **Line-level co-payment**: `IsCoPayment`, `CoPaymentCashAmount` (patient),
  `CoPaymentCreditAmount` (payer) on
  `BillingModels/POS/BillingTransactionItemModel.cs:67-69`. Computed twice, and
  inconsistently: `Controllers/Billing/IpBillingController.cs:227-228` derives
  the credit share by subtraction, while
  `Controllers/Emergency/EmergencyController.cs:1268-1269` applies both percents
  independently — if they do not total 100 the bill silently fails to reconcile.
- **Separate receivable, done well.** GL rule `CreditBillSundryDebtors`
  (`AccountingTransferData.cs:3162-3193`) posts the payer share
  (`SalesAmount - DiscountAmount - CoPaymentCashAmount + TaxAmount`, `:3164`) to
  the credit organization's own ledger resolved from `ACC_LedgerMappings` where
  `LedgerType == "creditorganization"` (`:3172`, resolver at `:133-144`), while
  rule `CreditBillCoPaymentCashAmount` (`:3224-3230`) puts the patient's cash
  into cash-in-hand. Open-item AR is a per-invoice row in
  `BIL_TXN_CreditBillStatus` with `NetReceivableAmount` and `SettlementStatus`
  (`Controllers/Billing/BillingTransactionBL.cs:209-233`, model at
  `BillingModels/POS/BillingTransactionCreditBillStatus.cs:10-38`).
- Claim states `initiated / in-review / payment-pending / partially-paid /
settled / denied` (`SharedEnums.cs:450-457`), transitions in
  `Services/ClaimManagement/ClaimManagementService.cs:296,571,374,770`.
  **`denied` is declared and never assigned** — one grep hit, the enum
  declaration. **`partially-paid` is set unconditionally** on every receipt
  (`:371-378`) with no comparison against `ApprovedAmount`, so a fully paid claim
  reads partially-paid until a human clicks Conclude.
- **Two receivable-closes-early bugs worth naming.** `SaveClaimScrubbing` sets
  `SettlementStatus = Completed` on every attached credit-bill row **at claim
  submission**, before any money arrives (`:308-336`, billing `:316`, pharmacy
  `:329`); the enum has only `pending` and `completed`
  (`SharedEnums.cs:438-442`), so there is no "claimed, awaiting payment" state.
  And a co-payment invoice is stamped `BillStatus = "paid"`: the guard at
  `billing-transaction.component.ts:1700` is `credit && !IsCoPayment`, so any
  co-pay bill falls to the `else` branch (`:1717-1722`) and gets a `PaidDate`
  while the payer share is wholly uncollected.
- **Write-off is a trade discount.** At settlement the shortfall becomes
  `DiscountAmount` (`bill-settlements.component.ts:611-618, 628-633`) posted to
  `EIE_ADMINISTRATION_EXPENSES_TRADE_DISCOUNT`
  (`AccountingTransferData.cs:3212`) — a disallowance booked as trade discount,
  not bad debt. The claim-level `RejectedAmount` is keyed by hand
  (`ClaimManagementService.cs:734-759`) with no cross-check, and **claim approval,
  rejection, and receipt produce no GL entry at all** (zero hits for
  ledger/accounting/voucher in that service).
- Corporate credit and insurance share one path: `PaymentMode == "credit"`
  creates the credit-bill row regardless of counterparty
  (`BillingTransactionBL.cs:209`); claims are an optional layer bolted on via
  `ClaimSubmissionId`/`IsClaimable`.

### Q3 Cheque

- **ERPNext**: `Payment Entry.clearance_date` is `read_only`, set after the fact
  by `Bank Clearance` via `db_set`
  (`erpnext/accounts/doctype/bank_clearance/bank_clearance.py:93-176`). It has
  **zero GL effect** — one grep hit in `payment_entry.py` (a type annotation),
  zero in `general_ledger.py`. Its only consumer is the Bank Reconciliation
  Statement, which _computes_ the gap
  (`bank_reconciliation_statement.py:155-162,186-197,221-229,253-261`). No
  clearing account type exists among the 32 `Account.account_type` options, and
  the standard chart contains zero occurrences of "cheque". The shipped Cheque
  mode has no `accounts` rows, so selecting it in POS throws until an admin maps
  it (`install_fixtures.py:260-265`, `pos.py:329-335`).
- **Danphe**: zero hits for `undeposited`, `clearing account`, or `cheque in
hand`. Cheque and card collapse to `"bank"` before GL grouping
  (`AccountingTransferData.cs:2197`) and debit `ACA_BANK_HAMS_BANK` on the day of
  receipt (`:3072-3074`). A bank-reconciliation module exists but reconciles
  after the fact; its shipped category master includes `Cheque Collection Delay`,
  `Cheque Dishonored`, and `Outstanding Cheques` — uncleared cheques are a
  reconciliation _variance category_, not a ledger balance. Worse, the cheque
  number at the counter is free text in a per-tender `PaymentDetail` field that
  the server model does not have, so `BillingTransactionBL.cs:119-133` silently
  drops it; it survives only inside a concatenated header blob
  (`BillingTransactionModel.cs:45`). Structured `ChequeNumber`/`ChequeDate`
  exist for vendor payments (`AccountingModels/Transactions/TransactionModel.cs:27,58`)
  and claim receipts (`ClaimManagementModels/InsuranceClaimPayment.cs:21`), just
  not in the cashier path.
- **Bahmni**: zero occurrences of `cheque`, `check_no`, `clearing`, or
  `undeposited` in the Odoo 7 and Odoo 10 modules. The only cheque code is a
  vendored third-party accounting kit
  (`bahmni-odoo-modules/community_modules/base_accounting_kit/data/account_pdc_data.xml:5-14`)
  that **no Bahmni module depends on** — zero hits for `base_accounting_kit` in
  any manifest's `depends`.

## What this proves

- Modelling an insurer or scheme as a payment-method value is not a
  simplification, it is a defect with an observable signature: Bahmni's RSBY
  journal makes an unpaid bill read as settled and erases the payer's obligation
  from the books entirely.
- The "second receivable" shape is proven in production code twice over, and both
  implementations agree on the essentials: split at line level with a percentage,
  post the payer's share to a payer-specific receivable at invoice time, leave
  only the patient's share outstanding on the invoice.
- A payment method needs a ledger account per method, and a mapping that the
  posting code does not read is worse than no mapping — Danphe ships a
  configuration screen whose values are ignored.
- A clearing account for cheques is a deployer configuration decision everywhere.
  No reference ships one, and ERPNext's clearance tracking is a report, not a
  posting.
- Split tender needs a server-side sum check. Danphe has none, and its client
  guard is a dead expression.

## What this does not prove

- Nothing here says whether our pilot site has TPA volume worth building for.
  Three codebases having a payer model is evidence that the shape is right _if
  you need it_, not evidence that we need it.
- Marley's insurance layer is new (v16-line patch) and its holes — no write-off,
  no claims aging report, dead expense-account getter — suggest it has not been
  hardened by heavy production use. Its shape is a donor; its completeness is
  not.
- Danphe's schema and seed data live only in a SQL Server backup, and several
  worklist queries are stored procedures absent from source. Its worklist
  filters could not be verified from source.
- None of this addresses Indian TPA process specifics: pre-authorisation, tariff
  packages, or the documentation an insurer demands before paying.

## What this means for us

Current state: `PAYMENT_METHODS` is a three-value UI list
(`apps/web/src/lib/settlement.ts:8`) over a fixed zod enum
(`packages/api/src/lib/schemas.ts:24`), enforced by check constraints
(`packages/db/src/schema/payments.ts:37`, `refunds.ts:39`), mapped to ledger
accounts by a `switch` (`packages/api/src/lib/ledger.ts:73-83`), with splits
bounded at four lines (`packages/api/src/routers/billing.ts:545`,
`packages/api/src/routers/opd.ts:268`) and outstanding computed as
`grandTotal − credits − payments + refunds`
(`packages/api/src/lib/invoice-math.ts:79`).

1. **Keep the fixed enum.** Danphe's editable master ships without CRUD and its
   per-mode ledger mapping is ignored at posting time; ERPNext's editable master
   ships four of five modes unmapped, so a fresh install throws at the counter.
   An enum with a compile-time-exhaustive `settlementAccountFor` gives the
   safety both references lack. Adding Bank, Cheque, and Other is a schema
   change plus one migration, which is the right cost for a decision that moves
   money.
2. **Keep the `max(4)` split bound and the server-side total check.** Both
   references that support split tender are unbounded, and Danphe validates the
   sum nowhere.
3. **A clearing account for Cheque and Other is ours to decide** — no reference
   ships one. The case for it is Danphe's own reconciliation categories
   (`Cheque Collection Delay`, `Cheque Dishonored`, `Outstanding Cheques`), which
   are the symptoms of not having one.
4. **Do not add Insurance, TPA, or Corporate to the method enum.** This is the
   Bahmni RSBY defect, and our `calculateInvoiceBalance` would reproduce it
   exactly: a payment row reduces outstanding, so the bill would leave the
   billing worklist while nothing had been collected.
5. **When the payer domain is built, the shape is settled by this evidence**: a
   payer entity with its own receivable account, a per-line coverage percentage
   splitting patient share from payer share, a posting at invoice time that moves
   the payer's share off the patient's receivable, and a claim document with
   explicit states. Two things both references get wrong and we should not copy:
   closing the receivable at claim _submission_ rather than at payment (Danphe),
   and having no reversal path for a denied claim (both).
6. **Until then, an uncovered patient's balance simply stays outstanding.** That
   is honest, keeps the worklist correct, and costs nothing to undo later.

## Next falsification

Ask the pilot site for one month of counter receipts and answer two questions
with their data, not ours: what fraction of visits settle by a method outside
Cash/UPI/Card, and what fraction involve a payer other than the patient. If the
second number is near zero, item 5 stays unbuilt and this memo's payer section is
a design note for later. If it is material, the next step is a spec, and the
first thing that spec must pin down is what the insurers actually require before
they pay — which no codebase can tell us.

## Sources

- Bahmni: [bahmni-core](https://github.com/Bahmni/bahmni-core),
  [openerp-modules](https://github.com/Bahmni/openerp-modules),
  [openerp-atomfeed-service](https://github.com/Bahmni/openerp-atomfeed-service),
  [odoo-modules](https://github.com/Bahmni/odoo-modules),
  [bahmni-odoo-modules](https://github.com/Bahmni/bahmni-odoo-modules)
- Danphe: [opensource-emr/hospital-management-emr](https://github.com/opensource-emr/hospital-management-emr)
- Marley: [earthians/marley](https://github.com/earthians/marley),
  [frappe/erpnext](https://github.com/frappe/erpnext)
