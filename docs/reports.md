# Reports and billing worklists

Reports are Organization-scoped read models over source records. They never
become a second write model, and clinical notes are excluded. Revenue Control,
Invoice Register, GST, Trial Balance, Balance Sheet, Daily Collections, and the
OPD Register ship; the billing worklists below are the shipped exception lists.

## Billing exceptions

- `billing.worklist` returns tenant-scoped pending Charges for `checked_in` OPD
  appointments whose oldest pending Charge is older than the Organization's
  `unbilledAlertHours` (1–168, initially 24, editable in Organization settings).
  The threshold is a `HAVING` on the grouped appointment, so a newer Charge never
  hides an eligible visit. Results are oldest first, 50 rows by default and 200
  at most, with `hasMore`; the summary totals count every match, not the page.
  The dashboard's unbilled figures apply the same threshold.
- `billing.openInvoices` returns issued Invoices with a positive outstanding
  balance, filtered in SQL before keyset pagination (25 default, 100 maximum).
- `billing.refundDue` returns issued Invoices whose shared balance is negative
  after Credit Notes, Payments, and recorded Refunds, filtered in SQL before the
  cap, oldest first, and linked to the Invoice screen.

- `billing.advancesHeld` returns one row per Advance Receipt with unused credit,
  keyset-paged by `(createdAt, id)`, with the receipt's printed purpose and its
  plan's status.

Invoice balances share one calculation over Invoice value, Credit Notes,
Payments, Advance Allocations, and recorded Refunds.

## Day-close reports

**Daily collections** (`report.dailyCollections`, at most 92 days) aggregates
Payments, Advance Receipts, Refunds, and advance Refunds by stored Business Date
and method — never a date re-derived from `createdAt` — and returns per-day rows,
per-method totals, and net collections: payments plus advances less both kinds of
refund. Invoice value is never presented as cash collected, and advance money is
shown as received, not as revenue.

**OPD register** (`report.opdRegister`, at most 31 days) returns one row per OPD
Appointment with token, Patient or caller, Practitioner, Department, arrival
mode, stored status, and billed, paid, credit, refund, and outstanding amounts
from correlated per-appointment sums. `booked`, `checked_in`, `cancelled`, and
`no_show` remain distinct; the report never invents a completed state. Rows are
keyset-paged in day order by `(businessDate, dayOrderAt, id)`, 50 by default and
100 at most; whole-period totals come with the first page only.

Both reports accept an inclusive Organization-local date range, link from
`/$orgSlug/reports`, and offer XLSX export and printing. Their tables remain
horizontally scrollable on narrow screens. Cashiers and pharmacists can read
Daily Collections to close a shift. The patient-level OPD Register and the statutory and ledger reports remain restricted to accountants,
administrators, and owners.

## Owner revenue control

`/$orgSlug/reports/revenue-control` and `/$orgSlug/reports/invoice-register`
reuse `report:readFinancial`: owner, admin and accountant can read the pages,
procedures and exports; reception, cashier or pharmacist alone cannot. Every
request carries `orgSlug`, queries are organization-keyed, and source links
retain their own billing, OPD or pharmacy permission checks. These reports add
no grants, domain tables, source writes, no-show reconciliation, read-audit events
or alert-resolution workflow. Clinical notes, phone numbers and scans are excluded.
They cover OPD and pharmacy, not unrecorded IPD or other hospital systems.

### Invoice Register

`report.invoiceRegister` accepts inclusive `from/to` (at most 366 days), optional
`stream` (`opd` or `pharmacy`) and full-number/name/MRN `query`, and a keyset cursor
`(businessDate, createdAt, id)` in descending order. The page defaults to the
Organization's fiscal-year start through today. Pages contain 25 rows by default,
100 maximum; whole-filter totals and stream/fiscal-year series summaries are not
limited to loaded rows. Series preserve full original numbers and show first/last
by issuance order, never infer a prefix or global sequence from current settings.

Each row shows the issued identity, subtotal, discount, issued line value, GST,
round-off, Invoice total, Credit Notes, net billed, Payments, Advance Allocations,
Refunds and signed outstanding. Issued line value excludes GST and includes
exempt healthcare. Subtotal is not directly comparable between inclusive
pharmacy and exclusive OPD. `netBilled = grandTotal − creditTotal`;
`outstanding = netBilled − paymentsTotal − allocationsTotal + refundsTotal`.
Negative outstanding means Refund due, not zero. Advance Receipts reduce an
Invoice balance only when allocated. “Paid” here means Payments only; the
existing worklists combine Payments and allocations without changing their contract.

The issue-date filter selects Invoices, while balances include all linked
movements visible at generation, including movements after `to`. Screen and
workbook say **Invoices issued in period; balances now** and carry generation
time; this is not historical as-of debt. The page links authorized users to
guarded Invoice documents, OPD visits and pharmacy sales. Print includes loaded
rows only; `export.invoiceRegisterXlsx` drains all filtered pages, includes full
totals and series, and does not export only the visible page.

### Billed revenue and correction bridge

`report.revenueBreakdown` reads at most 92 inclusive days. Issued line values
contribute on Invoice Business Date and credits on Credit Note Business Date,
including credits against older Invoices. It separates issued, credited and net
taxable line value, tax and round-off by stream, practitioner, snapshotted
service revenue category and total. These are **net billed revenue**, not
clinical earnings, doctor payouts or profit. Discounts are already netted;
Refunds affect collections and balances, not revenue. A correction-only period
can legitimately be negative.

OPD uses its source Appointment's practitioner id. Linked pharmacy uses
**linked attendance attribution**, never a fuzzy prescriber name or claimed
prescriber earnings; unlinked counter sales remain visibly Unassigned.
Practitioner names are current labels grouped by stable id, not financial name
snapshots. Categories come from issued lines and are inherited by credit lines,
not today's Service or the Appointment department. Round-off is unallocated to
practitioners/categories, and appears only by stream/total. This is not an
earning-department report: that future dimension requires issued-line snapshots
of the service-owning department, with legacy lines left unassigned.

The bridge preserves both date bases:
`event-period net line value = issue-period register current net line value
− credits in period to older invoices + later credits against period invoices`.
Both bridge amounts are displayed/exported rather than forcing issue-period and
correction-period results to equal. This bridge uses pre-GST line value, not
tax-inclusive Invoice totals.

### Source-linked review signals

`report.revenueSignals` accepts the same 92-day period and one of seven kinds,
with whole-filter count/amount and descending `(eventAt, id)` keyset pages
(25 default, 100 maximum). All seven are selectable and independently paginated.
Rows retain source identifiers, recorded reasons and the recording actor.
Signals overlap and have incompatible bases: there is **no combined lost-revenue
total**, accusation, automatic missed fee or estimated recovered leakage.

| Kind                          | Date and value basis                                                                                                            | Review limitation                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked-in OPD with no Charge | Appointment Business Date; count only, no amount                                                                                | Never charged versus all Charges voided are distinct; a zero-priced non-voided Charge counts. Deliberate free care is valid and need not have a recorded reason. The aged pending-Charge worklist and `unbilledAlertHours` remain separate. |
| Voided Charges                | Current voided rows by Organization-local recorded last-update date; exact snapshot price/quantity                              | `voidReason` and creator are shown. No `voidedBy`/`voidedAt` exists; creator is not the voider and last update is not an immutable historical void event.                                                                                   |
| Invoice discounts             | Invoice Business Date; stored discount, issuer and exact note                                                                   | Group by stable issuer id and exact reason. Missing legacy reason is Not recorded; no inferred taxonomy or second subtraction from revenue.                                                                                                 |
| Credit Notes                  | Credit Note Business Date; stored total, issuer and exact reason                                                                | Group by stable issuer id and exact reason. Returns and mistakes are corrections, not all discounts.                                                                                                                                        |
| Sales below MRP               | Issued pharmacy lines against immutable batch MRP; undiscounted subtotal, allocated discount and line gross excluding round-off | Exact rational price comparison; paise allocation and full/partial returns are not new below-MRP sales. Review authorized concessions, not alleged shrinkage.                                                                               |
| Stock adjustments/write-offs  | Creation time in current Organization timezone; quantity, bucket and immutable batch-MRP exposure                               | Count correction, breakage and write-off are separate from internal issues and quarantine/release transfers; transfers are not hospital stock loss. This is not cost/profit-loss valuation.                                                 |
| Refunds                       | Stored Refund Business Date; invoice-linked versus advance-linked amount and method                                             | Recorded refunder is shown. Refund stores no reason; linked Credit Note reason is shown when present, otherwise Not recorded. Do not reduce revenue again.                                                                                  |

### Current expiry exposure

`report.expiryExposure` accepts a 30- or 90-day horizon (30 default), independent
of the reporting period. Current movement-derived shelf and quarantine stock is
shown separately for expired and upcoming-expiry batches, including stocked
inactive/internal Products. Printed expiry date is valid through that date.
Null-expiry stocked batches are excluded from exposure and counted visibly.
Exposure is immutable batch MRP × counted quantity / `mrpUnits`, rounded half-up
once per batch/bucket. Bucket totals and expired/upcoming totals are overlapping
views of the same exposure, not four amounts to add.

Screen/export carry generation time and **MRP exposure, not purchase cost or
inventory valuation**. Write-off review uses this same operational exposure
basis, not a profit-loss posting. Cost valuation is deferred: books require
supported opening cost, lower of cost/NRV and weighted-average cost, with
discounts deducted, recoverable GST excluded, non-recoverable tax/attributable
acquisition costs included and cost spread across billed plus free units.
Unknown cost is never zero; expiry has no ordinary sale NRV and documented
supplier recovery requires separate assessment. No inventory journals are added.

### Page, export and print

The page shows the period's billed revenue with its correction bridge, current
expiry exposure and one review kind at a time. Daily collections stay in their
own report. The billing lead with `accountant` (or `admin` for a lead also
running the desk) performs daily close; the owner reviews unexplained
source-linked differences.

Register and signal totals come with the first page only; later pages carry rows.
`export.revenueControlXlsx` writes revenue by stream, practitioner and category,
the correction bridge, every row of each review kind (one query per kind) and
expiry exposure. `export.invoiceRegisterXlsx` writes every matching invoice and
the number series. Print / PDF includes only the loaded non-patient aggregates.

### Accountant handover

Match entity, dates and scope before reconciling four separate measures:

1. Issued line values less credited line values on each document's own date,
   discounts already netted, excluding GST and separating round-off.
2. Payments plus Advance Receipts less invoice and advance Refunds; exclude
   allocations from fresh receipts.
3. GST outward exempt/taxable value and tax by document/HSN/rate with traceable
   Credit Notes.
4. Source-linked billing-journal Trial Balance opening, debits, credits and
   closing balances.

Tie these to revenue, cash/bank, advance liability, receivable and tax accounts,
using the correction bridge rather than altering source documents. HMS remains
partial billing books, not final accounts or an ITR. For Tally handover use one
Sales voucher per Invoice and one Credit Note voucher per Credit Note, with the
full issued HMS number as voucher number and bill-wise reference and original
Invoice number/date retained on credits. Dedicated HMS voucher types use Manual
numbering with duplicate prevention; migration through an automatic type must
retain original voucher numbers and prove no renumbering. A Tally importer is
not part of these XLSX exports.

No Admission, claim adjustment, historical as-of balance, earning-department
snapshot, purchase-cost model or denominator-capture feature is fabricated.
Future IPD adds the Admission source and stream to these same reports; the
Claims increment owns patient/payer balance extensions at the shared Invoice
balance seam, without duplicate revenue or fake Payments.
Future IPD attribution defaults to the admitting/primary consultant, snapshotted
at Invoice issue and inherited on credits; authorized reassignment records
previous/new practitioner, actor and reason in a sensitive audit and affects
subsequent issues, never rewrites prior attribution. Missing consultant remains
Unassigned. This policy does not create Admission operations in these reports.

## Financial reports and exports

**GST outward register** reads issued Invoice and Credit Note snapshots across
billing streams. It shows documents and summaries by rate and HSN/SAC. Its
CGST/SGST split assumes intra-state supply; it is not a filing-ready export.
Documents are keyset-paged by `(date, number, id)` in byte order, 50 by default
and 100 at most. The rate, HSN/SAC and period totals come with the first page
only. A page splits each document's GST exactly as the whole-period report does.

**Trial Balance** reads journals for opening balances, period debits and credits,
and closing balances by account. **Balance Sheet** reads the same billing ledger
as of the selected date. Both cover HMS billing activity only; they omit expense,
payroll, inventory valuation, and manual journal accounting.

All seven report pages offer **Print / PDF** and **Export Excel**. Each `export.*Xlsx`
procedure builds a workbook on the server by calling the matching report procedure
with the same request context, or the same row helpers for the paged OPD and GST
registers, so the workbook holds every row rather than the loaded page. It reuses
the report permission, date limits, and verified organization scope. The browser downloads the returned File; it does not
load the spreadsheet library. Shared labels keep screen and spreadsheet wording
aligned. Exports read current records, so they can include changes made since the
page loaded. Refresh the page and check the date range before handover.

## No-show reconciliation

Before selecting a range that includes a past Business Date, the OPD register
runs the same `closeExpiredBookings` reconciliation as `opd.day`: every `booked`
row older than the current Business Date becomes `no_show`, its pending Charges
are voided, and each closure is audited after commit. The helper is idempotent
and tenant-scoped, so the register reports the same statuses whether or not any
OPD day was previously opened ([OPD](./opd.md)).

## Non-goals

Payment gateway, WebSockets, a cashier-shift
entity, petty-cash expenses, filing-ready GST output, or a general analytics
platform. Add a handover entity only if the pilot proves the report plus SOP
insufficient.
