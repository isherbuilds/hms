# Billing PDF foundation

Status: implemented; repository-wide migration-test blocker noted below

Authority: user-approved remediation on 2026-08-27, constrained by
[`product.md`](../product.md), [`architecture.md`](../architecture.md), and
[`design.md`](../design.md).

## Required behavior

- [x] Invoice, receipt, credit-note, and refund-voucher PDFs are rendered by the
      server from the existing organization-scoped `billing.getInvoice` result.
- [x] The PDF endpoint performs exactly one guarded domain call. It must not
      enumerate memberships or derive tenant scope independently.
- [x] Organization, patient, and catalogue text renders as Unicode, including
      Devanagari, from fonts shipped with the application. Unsupported text fails
      loudly; it is never dropped or transliterated.
- [x] An issued document contains only its immutable source facts. Later
      payments, credits, refunds, or balance changes must not change an invoice or
      previously issued receipt.
- [x] Each issued Invoice, Payment, Credit Note, and Refund snapshots the
      organization-local Business Date. Printed dates use that stored value, so
      UTC boundaries or later timezone changes cannot move an accounting date.
      Existing rows are expanded, backfilled from their effective organization
      timezone, then contracted to `NOT NULL` in separate migrations.
- [x] Until tax-document classification is approved, the invoice is labelled
      neutrally as `Invoice`, not `Tax invoice` or `Bill of supply`.
- [x] A4 line-item tables use semantic table markup so headings repeat when the
      renderer paginates them. Tax rate remains visible for every supported
      currency. Invoice also supports an 80 mm thermal layout.
- [x] Preview, print, and download use the same PDF endpoint. Download response
      headers remain valid for arbitrary stored document prefixes and Unicode
      document numbers.
- [x] The renderer stays server-only and lazily loaded. Small document enums and
      URL helpers must not import the renderer or its WASM dependency.
- [x] Billing document screen headings follow the static-noun page-title rule.
- [x] The implementation is a narrow set of billing templates and shared
      formatting helpers, without a generic component/theme compatibility layer.

## Verification

- [x] Regression tests cover Unicode rendering, immutable Business Date output,
      strict query parsing, and safe content disposition.
- [x] A long A4 invoice and an 80 mm invoice are rendered and visually inspected.
- [x] `bun run check-types`, `bun run check`, and the web build pass. The full
      test run reached 225 passing tests and failed only the two pre-existing staged
      patient-age migration checkpoints because their expected migration tags are
      absent; the isolated file-resilience suite also passes.
