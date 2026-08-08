# 0020: Post double-entry journals inside billing transactions

- **Status:** accepted
- **Date:** 2026-08-08

## Context

Invoices, payments, credit notes, and refunds are the hospital's financial
source documents. Statutory handover needs a trial balance and balance sheet
that remain consistent as pharmacy, inventory, lab, and radiology are added,
but the product is not intended to replace Tally or the hospital's chartered
accountant.

A journal written later than its source document can be lost or duplicated. A
report derived directly from today's billing tables would avoid that journal,
but every future financial document would then have to be taught to every
accounting report.

## Decision

Post a balanced double-entry journal inside the same database transaction that
creates each billing document. Seed an organization-scoped chart of system
accounts on demand, and resolve posting targets through stable `systemKey`
values. One `(orgId, sourceType, sourceId)` may post only once.

The ledger supplies statutory accounting balances and handover data; it does
not provide a full accounting module or ERP workflow.

## Alternatives considered

### Fire-and-forget posting

Rejected. Fire-and-forget is appropriate for the ordinary operational audit
trail described by [ADR 0005](./0005-fire-and-forget-audit.md), but money must
not drift from its source documents. A billing write and its journal either
both commit or both roll back.

### Derive trial balance and balance sheet from documents

Rejected. Every future module and source document would have to rewrite every
accounting report. A common journal makes a new module responsible for its own
posting rules instead.

### Build a full accounting module or ERP

Rejected. Bookkeeping controls, reconciliation, and final accounts stay in
Tally and the chartered accountant's hands. The HMS exports a neutral,
traceable data set rather than competing with those workflows.

## Consequences

Future financial modules must add the accounts and balanced posting rules for
their source documents. `sourceType` therefore remains an open set, while the
unique source constraint makes posting idempotent at the document boundary.

Trial balance and balance sheet read the ledger. The GST report reads invoices
and credit notes instead, because its document, rate, HSN/SAC, and patient
breakdowns are facts of those source documents rather than journal lines.

Accounting dates use the fixed `Asia/Kolkata` timezone until an organization
timezone setting exists. Handover exports are XLSX workbooks and printable
pages saved as PDF; they are exchange files, not an integration with an
accountant's ERP.
