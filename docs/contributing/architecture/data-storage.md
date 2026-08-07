# Data storage

One PostgreSQL database, Drizzle schema in `packages/db/src/schema/`, migrations
in `packages/db/src/migrations/`.

## Tenant isolation invariant

Every domain table carries `orgId text NOT NULL` referencing `organization`.
Every query against it carries `eq(table.orgId, scope.orgId)`. This is not a
convention that applies "mostly" — see [tenancy](./tenancy.md) and
[security](../security.md).

Isolation is enforced in application code, in the single `requirePermission`
guard, rather than by row-level security. One enforcement point that every entry
point shares is auditable in a way that a policy per table is not, and it is
what `tests/integration/tenancy.test.ts` exercises directly.

## Table conventions

**Cascade from the org.** `onDelete: "cascade"` on the `orgId` reference, so
deleting an organization removes its data rather than orphaning it.

**Except the audit log.** `audit_log` deliberately has _no_ foreign key to
`organization`: entries must outlive the org they describe, and keep their
`orgId`. "Who deleted this organization" is precisely the question an audit
trail exists to answer.

**Index for the query you run.** Tenant predicate first, then the sort and
keyset columns in the order the query uses them, so a page is an index range
scan rather than a scan-and-sort:

```ts
index("file_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc());
```

**Paginate with keysets.** `(createdAt, id)` as the cursor, never `OFFSET`. The
pair is unique, so a page boundary can neither skip nor repeat a row, and the
cost does not grow with the offset. `audit_log` uses its insertion-ordered
identity `id` as both cursor and sort key, which is why the composite index is
`(orgId, id)`.

**Timestamps are `withTimezone`.** Always.

## Migrations

```sh
bun run db:generate    # schema change → generated SQL
bun run db:migrate     # apply
```

**Never hand-edit a generated migration.** Hand-authored SQL — a backfill, a
concurrent index — gets its own migration file. The production container runs
the advisory-locked `db:migrate` package command before starting the server.
The same migration helper prepares the test database and the development seed.
See [0012](../decisions/0012-migrations-run-before-the-server.md).

`db:push` exists for throwaway local iteration. Anything that reaches another
machine goes through a generated migration.

## The test database

`resetTestDatabase` drops and recreates the `public` schema **and** the
`drizzle` journal schema, then migrates. It refuses to run against any database
whose name does not end in `_test`. Call it once per test file in `beforeAll`.
