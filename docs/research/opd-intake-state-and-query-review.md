# OPD intake state and query review

## Question

What is the smallest safe model that keeps services in both **Now** and **Later**, makes add/remove immediate, avoids zero-bill errors, and does not preload the catalog?

## Answer

Keep one explicit `when` value and one local selected-service collection. Render editable rows from that collection; use the walk-in quote only for authoritative money and the server-selected consultation line. Persist Later selections as existing pending Charge snapshots in the same transaction as booking. Keep those Charges dormant until check-in. Search active additional services in PostgreSQL and return at most six display fields.

This needs no new appointment type, planning table, client clock, catalog preload, quote fallback, or synchronization effect.

## Evidence

- The former UI sent selected IDs but rendered `quote.lines`, so quote latency owned whether an add/remove appeared. The corrected boundary maps local selections to API claims only at submission (`apps/web/src/components/opd-intake-form.tsx:137-158`) and renders the shared Services section from local selection state (`apps/web/src/components/opd-intake-form.tsx:618-650`).
- Search is debounced, disabled for an empty all-category input, and capped at six (`apps/web/src/components/opd-intake-services.tsx:100-123`). The server applies organization, active, non-consultation, category/text, and limit predicates and selects only display fields (`packages/api/src/routers/catalog.ts`, `searchServices`).
- Booking verifies care-team and service claims, then inserts the appointment and Charge snapshots in one transaction (`packages/api/src/routers/opd.ts`, `book`). Transaction queries stay sequential because one transaction owns one database connection.
- Quote reads independent care-team, settings, and selected-service claims concurrently, and `computeInvoiceLines` already supports an empty input (`packages/api/src/routers/opd.ts:417-470`; `packages/api/src/lib/invoice-math.ts`, `computeInvoiceLines`).
- A zero-value walk-in returns before invoice/payment creation and rejects contradictory discount or payment input (`packages/api/src/routers/opd.ts:581-588`).
- Billing worklists and dashboard unbilled totals require `checked_in`, so booked Charge snapshots are dormant (`packages/api/src/routers/billing-worklist.ts`, unbilled predicate; `packages/api/src/routers/dashboard.ts`, collections subqueries). Cancellation and no-show already void pending Charges (`packages/api/src/routers/opd.ts`, `voidPendingCharges`).

## What this proves / does not prove

This proves the design fits current persistence, authorization, invoice gating, cancellation, and tenant predicates without a migration. Integration tests prove the reachable server paths. It does not prove production latency or real catalog cardinality; only production p50/p95 and query plans can do that.

## What this means for us

- Selected-service state is UI intent; quote state is server pricing. They must not be interchangeable.
- A pending Charge on a booked appointment means selected billable intent, not performed clinical work.
- Later booking snapshots the current catalog price. Check-in does not silently reprice it.
- Query limits and selected columns are part of the intake contract, not optional UI trimming.

## Next falsification

Measure `catalog.searchServices`, `opd.quoteWalkIn`, and `opd.book` p50/p95 with production-like catalog sizes. Revisit indexes only if those measurements or `EXPLAIN (ANALYZE, BUFFERS)` show a real miss; do not add a second search/cache path speculatively.

## Sources

- `apps/web/src/components/opd-intake-form.tsx`
- `apps/web/src/components/opd-intake-services.tsx`
- `packages/api/src/routers/catalog.ts`
- `packages/api/src/routers/opd.ts`
- `packages/api/src/routers/billing-worklist.ts`
- `packages/api/src/routers/dashboard.ts`
- `packages/api/src/lib/invoice-math.ts`
- `packages/db/src/schema/charges.ts`
