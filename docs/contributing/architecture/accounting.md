# Accounting ledger

The accounting boundary is a minimal, organization-scoped double-entry ledger.
Its job is to give the hospital's chartered accountant a Tally-agnostic statutory
data set: trial balance, billing-ledger balance sheet, GST document register, and XLSX or
print-PDF handover files. It is not an ERP, a bookkeeping UI, or a replacement
for the accountant's system of record.

The ledger starts with the first financial document recorded in the HMS. It has
no opening-balance workflow and does not contain payroll, procurement, banking,
or other external-book activity. Every balance-sheet view and handover identifies
itself as a billing-ledger report; the accountant combines it with the hospital's
complete books outside the HMS.

## Seeded chart of accounts

Each organization receives the following system accounts on first posting.
`systemKey` is the stable programmatic target; display codes and names are the
seeded chart used in reports.

| Code | Name                 | Type      | `systemKey`            |
| ---- | -------------------- | --------- | ---------------------- |
| 1000 | Cash in Hand         | asset     | `cash`                 |
| 1100 | Bank                 | asset     | `bank`                 |
| 1200 | Patient Receivables  | asset     | `patient_receivables`  |
| 2100 | GST Output Payable   | liability | `gst_output`           |
| 4100 | Consultation Revenue | income    | `revenue_consultation` |
| 4200 | Procedure Revenue    | income    | `revenue_procedure`    |
| 4300 | Lab Revenue          | income    | `revenue_lab`          |
| 4400 | Radiology Revenue    | income    | `revenue_radiology`    |
| 4900 | Other Revenue        | income    | `revenue_other`        |

Codes and system keys are unique within an organization. Posting resolves an
account by `systemKey`, never by a user-facing name.

## Posting rules

Billing documents post these entries in the same database transaction that
creates the document. Revenue lines are grouped by the catalog category carried
by the billed Charge's immutable catalog-category snapshot.

| Document    | Debit                                                                              | Credit                                                                    |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Invoice     | Patient Receivables for the grand total                                            | Revenue by catalog category for taxable value; GST Output Payable for tax |
| Payment     | Cash in Hand for cash, otherwise Bank, for the receipt amount                      | Patient Receivables for the receipt amount                                |
| Credit note | Revenue by catalog category for taxable value; GST Output Payable for reversed tax | Patient Receivables for the credit-note total                             |
| Refund      | Patient Receivables for the refund amount                                          | Cash in Hand for cash, otherwise Bank, for the refund amount              |

A zero-value invoice does not post. All aggregation and balance checks use
integer paise; stored amounts remain two-decimal strings.

## Invariants and transaction boundary

`postJournalEntry` rejects a journal with no non-zero lines, a line with both or
neither side set, or unequal debit and credit totals. The database additionally
allows only one journal entry for each `(orgId, sourceType, sourceId)`, so the
same document cannot post twice.

Posting is atomic with the billing mutation: either both the document and its
journal commit, or neither does. This deliberately differs from the ordinary
audit trail in [ADR 0005](../decisions/0005-fire-and-forget-audit.md), where an
operational audit insert may fail without failing the mutation. Accounting
cannot accept that trade-off because money must not drift from its source
document. See [ADR 0020](../decisions/0020-double-entry-posting-in-billing-transactions.md).

Every row and query remains organization-scoped. `createdBy` is attribution,
not tenant scope.

## Reports and dates

Journal dates use the organization's configured Business Date. Document timestamps used by the
GST register are converted to that same time zone before taking their calendar date. A new
organization starts on `SETTINGS_DEFAULTS.timeZone` (`Asia/Kolkata`) and the value is edited on the
admin settings page — onboarding does not ask for it. Changing it moves the day boundary for
records written afterwards; token, document, journal, and report dates already on disk keep the
calendar day they were numbered under.

The boundary itself is local midnight, always: `businessDate()` formats the instant with
`Intl.DateTimeFormat` in the organization's zone and takes the calendar date. There is no
configurable day start, so a token issued at 05:00 belongs to the day that began at 00:00.

Trial balance and billing-ledger balance sheet read the ledger. The GST report instead reads
invoice and credit-note documents and their snapshotted lines, because tax
reporting requires document numbers, patient snapshots, rates, and tax codes
that do not belong on journal lines.

The routers own authorization, tenant-scoped SQL, transactions, and document
orchestration. Integer-money calculations live in `invoice-math.ts`; report
aggregation lives in `report-math.ts`. Balance collection from tenant-scoped billing documents
lives in `invoice-balance.ts`. The math modules are pure: they receive
already-scoped rows and return the finished financial view without reading the
database or request context.

### GST compliance boundary

The current GST page is an **outward document register for intra-state supplies**, not a GSTR-1
return or filing export. It splits tax into CGST and SGST and provides document, rate, and HSN/SAC
summaries, but does not model recipient GSTIN, recipient state/place of supply, IGST, B2B/B2C
classification, advances, or the documents-issued series. Do not describe it as filing-ready until
the pilot's chartered accountant validates the required return tables against representative data.

GSTN's current offline-return surface separately represents B2B/B2C and inter-state supplies,
credit/debit notes, advances, HSN summaries, and documents issued. The source requirements are
summarized in
[research note 03](../../research/03-client-hms-production-sitemap.md#what-this-means-for-us).
Adding filing-shaped output requires an approved extension to the immutable invoice snapshots and
posting rules; it is not a report-only formatting change.

Live evidence (research note 03, O15–O16) fixes the practical scope: clinical OPD is GST-exempt — a
₹500 consultation on the incumbent posted zero GST with no tax line on its receipt — so this register
only carries weight once taxable goods are billed (the deferred Pharmacy module). The incumbent's own
live register is accordingly pharmacy-only, but it already models multi-rate brackets (5/12/18%), IGST
columns, returns as negative lines, and separate GSTR-2 (inward/ITC), HSN-wise, and documents-issued
reports — the shape to target if and when filing-shaped output is approved.

## Extension path

Pharmacy, inventory, lab, and radiology do not require a second reporting
system. Each future module adds the accounts and posting rules its transactions
need, then posts through the same ledger. `journal_entries.sourceType` is an
open text set so new source documents are additive rather than a schema-wide
enum change. Revenue is already split by catalog category, including dedicated
lab and radiology accounts, so those modules can preserve statutory continuity
while adding their operational detail.
