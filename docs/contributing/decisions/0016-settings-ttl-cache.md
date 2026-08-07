# 0016: Organization settings are TTL-cached in-process for derived reads

- **Status:** accepted
- **Date:** 2026-08-07

## Context

Document numbering reads settings such as `mrnPrefix` on hot mutation paths.
Reading the settings row for every derived value adds a database round trip to
work that already has a verified organization scope. Redis would add new
infrastructure, has latency of the same order as a primary-key read for this
workload, and introduces distributed invalidation complexity. Prior art agrees
that config-like data is served from an application cache with a TTL and
explicit invalidation on write (epic-stack: `@epic-web/cachified` LRU +
SQLite; midday: Redis keys with a 30-minute TTL). Postgres itself offers no
server-side query-result cache — `shared_buffers` already keeps the hot page
in memory, so "caching in the database" cannot remove the network round trip,
only an in-process cache can.

## Decision

`packages/api/src/lib/settings-cache.ts` holds a per-process cache with a
one-hour TTL (`SETTINGS_CACHE_TTL_MS`). These values — legal name, tax id,
numbering prefixes — are set at onboarding and essentially never change, and
the single write path invalidates, so a long window is safe. The cache is used
only for derived server-side reads such as document numbering and print
generation. `settings.update` invalidates the updated organization's entry.
The admin `settings.get` procedure always reads the database directly and
never uses the cache.

Membership and authorization are never cached; every organization request still
resolves membership and checks its role grant afresh.

## Consequences

- Derived reads avoid repeated settings queries on hot paths.
- Other application instances may retain an old derived-read value until its
  entry expires, so they converge within an hour. Acceptable for
  onboarding-time values; anything a tenant edits routinely must not enter
  this cache without shortening the TTL.
- A single-instance v0 deployment sees settings writes immediately because the
  updating process invalidates its entry.
- Admin reads always show the database value and cannot be stale because of this
  cache.
- Redis and distributed invalidation remain unnecessary unless the convergence
  window becomes unacceptable.
