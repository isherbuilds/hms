# OPD list foundation review

Reviewed: 2026-08-22

## Question

Do the new OPD queue and appointment-list patterns provide a simple, safe, and performant base for
data-intensive deployments?

## Answer

Yes, after the follow-through described below. Both operational lists now use stable keyset pages,
tenant-leading B-tree indexes, and a page-first query that joins display labels only after selecting
the bounded appointment page. The existing explicit mutation invalidation pattern remains, with the
overlapping conflict path reduced to the exact union of affected keys rather than another cache layer.

## Evidence

### Internal implementation and measurement

- `opd.queue` filters a tenant/day/status set, orders by `tokenNumber`, and returns at most 200 rows,
  with no cursor or continuation metadata (`packages/api/src/routers/opd.ts:609-659`).
- `opd.appointments` filters scheduled rows for a tenant/day, orders by `(scheduledFor, id)`, and
  likewise returns at most 200 rows with no continuation (`packages/api/src/routers/opd.ts:662-705`).
- The UI renders each returned array as the complete operational view and exposes no load-more path
  (`apps/web/src/routes/$orgSlug/opd/index.tsx:348-593`).
- The available indexes end in `(status, createdAt, id)` or `(practitionerId, businessDate,
createdAt, id)`; neither matches the two list orderings
  (`packages/db/src/schema/opd-appointments.ts:91-107`).
- On PostgreSQL 18.4 in the disposable `hms_test` database, after loading 50,000 matching same-day
  rows per view and running `ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)` showed each current joined query
  processing and sorting all 50,000 rows before returning 200: 118.28 ms for the queue and
  130.14 ms for appointments on this machine. This is a synthetic local baseline, not a production
  latency claim.
- Under the same fixture, the bounded base-table reads with tenant/day/order-matching indexes returned
  200 rows in 0.23 ms and 0.17 ms. The existing joined query shape did not automatically adopt those
  indexes, so adding indexes alone is not proven sufficient; the bounded page must be selected before
  joining display data. This is an inference from the measured plans, to be rechecked after an
  implementation.
- After implementation, the same 50,000-row-per-view fixture used the intended indexes and returned a
  joined 101-row page in 1.42 ms for the queue and 1.20 ms for appointments. The plans performed one
  ordered index scan bounded by `LIMIT`, followed by 101 primary-key/display joins; neither plan
  sorted or joined all 50,000 matching rows. These remain synthetic local measurements, not
  production latency claims.
- A fresh-context review then challenged the all-matching queue fixture. A mixed fixture added 50,000
  active rows in another department, 50,000 closed rows in the target department, and 101 active
  target rows. With active-queue partial indexes, the unfiltered page completed in 0.07 ms and the
  sparse department page in 0.09 ms; both stopped after 101 index entries. This specifically
  falsifies the risk that closed or other-department rows force a full-day base scan on the common
  active path.
- The exposed include-closed path retains non-active arrival indexes. On the same mixed fixture its
  sparse department page stopped after 101 entries and completed in 0.11 ms, rather than scanning or
  sorting the whole day.
- Those sparse-filter measurements intentionally used an extreme 100,101-row tenant/day distribution.
  A final pre-production review rejected retaining the four department/practitioner × active/all
  variants for that synthetic shape: ordinary hospital days are expected to stay small enough for
  the tenant/day arrival index to filter while scanning, whereas every extra index adds write work
  and the status-based partial variants make lifecycle updates maintain another index. The accepted
  baseline therefore keeps only active-arrival, all-arrival, and scheduled tenant/day indexes. Add a
  filter-specific index later only when representative plans or production latency demonstrate it.

### First-party guidance

- PostgreSQL 18 documents `ORDER BY ... LIMIT` as the important case where a matching B-tree index
  can return the first `n` rows directly instead of processing all candidate rows
  ([PostgreSQL: Indexes and ORDER BY](https://www.postgresql.org/docs/current/indexes-ordering.html)).
- PostgreSQL 18 documents that multicolumn B-tree indexes are most effective when equality constraints
  occupy the leading columns. That supports this repository's tenant/day-first convention, followed
  by the stable ordering columns
  ([PostgreSQL: Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)).
- PostgreSQL documents `EXPLAIN`/`EXPLAIN ANALYZE` as the way to inspect the chosen scan, join, and sort
  plan, while warning that costs and row estimates depend on statistics and environment
  ([PostgreSQL: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)).
- TanStack Query v5 recommends invalidating the related keys after a mutation and returning/awaiting
  the invalidation promise so the mutation remains pending until the relevant data is updated. The
  current domain invalidators follow that pattern
  (`apps/web/src/lib/domain-invalidation.ts:9-73`;
  [TanStack Query: Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)).
- The conflict helper invokes both domain invalidators even though their sets overlap on appointment
  detail, collections, and billing worklist keys (`apps/web/src/lib/opd-operational-query.ts:19-31`;
  `apps/web/src/lib/domain-invalidation.ts:21-38,55-65`). The official guidance supports explicit
  related-key invalidation; it does not justify duplicate invalidation of the same key.

## What this proves / does not prove

The before measurement proved a reachable completeness defect at row 201 and demonstrated that the
old joined query work grew with all matching rows. Public API integration tests now prove complete,
duplicate-free traversal, including equal timestamps, while the after plans prove that the selected
query shape bounds the database work before display joins.

It does not prove production p50/p95 latency, browser rendering cost for large pages, the best page
size, or the exact final Drizzle query shape. The synthetic fixture intentionally stresses one large
tenant/day and does not model production data distribution, network latency, connection-pool wait, or
concurrent terminals.

## What this means for us

1. Both list contracts fetch `limit + 1` and return an explicit continuation.
2. Appointments use `(scheduledFor, id)`; the combined queue uses organization-wide arrival order
   `(arrivedAt, id)` because practitioner token numbers are not globally unique.
3. Tenant/day/order indexes and page-first joins bound the expensive display joins to the requested
   page without pre-optimizing every optional filter.
4. Integration tests cover continuation and equal-sort-value traversal; the after plans confirm the
   index/query shape at 50,000 matching rows.
5. Explicit mutation invalidation remains, with duplicate conflict invalidations removed.

## Next falsification

Recheck the plans with production-like mixed practitioners, departments, statuses, and tenants once
representative data exists. Add a filter-specific index only if measured plans scan enough rows to
miss the accepted operational latency budget.

## Sources

- [PostgreSQL 18: Indexes and ORDER BY](https://www.postgresql.org/docs/current/indexes-ordering.html)
- [PostgreSQL 18: Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
- [PostgreSQL 18: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [TanStack Query v5: Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
