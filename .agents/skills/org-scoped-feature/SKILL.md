---
name: org-scoped-feature
description: >-
  Add or change an organization-scoped domain in this repo — schema, migration, permission,
  oRPC router, route, and the tenancy test. Use whenever work touches a table with orgId, a
  procedure declared with orgProcedure, packages/auth/src/access.ts, or a page under
  apps/web/src/routes/$orgSlug/.
---

# Add an org-scoped feature

Every domain row belongs to exactly one organization. This skill is the
end-to-end path for a new one. Background:
[tenancy and authorization](../../../docs/architecture.md#tenancy-and-authorization)
and the [decision log](../../../docs/decisions.md) (especially D001, D002, and
D008). The hard rules in `AGENTS.md` apply to every step. This skill adds only
the order, the templates, and the checks those rules do not state.

Work in this order — each step depends on the one before it.

## 1. Schema — `packages/db/src/schema/<thing>.ts`

```ts
export const thing = pgTable(
  "thing",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("thing_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
```

- `orgId` cascades from the org.
- The index leads with `orgId`, then the sort and keyset columns in query order.
- Export it from `packages/db/src/schema/index.ts`.

## 2. Migration

```sh
bun run db:generate
```

Hard rule 4 applies.

## 3. Permission — `packages/auth/src/access.ts`

Add the statement to `ac`, then grant it to each role that should have it;
`owner` and `admin` looking alike is intended.

```ts
export const ac = createAccessControl({ ..., thing: ["create", "read", "update", "delete"] } as const);
```

## 4. Router — `packages/api/src/routers/<thing>.ts`

```ts
export const thingRouter = {
  list: orgProcedure(
    { thing: ["read"] },
    orgInput.extend({ cursor: ..., limit: z.number().int().min(1).max(100).default(50) }),
  ).handler(async ({ context, input }) => {
    return db.select().from(thing).where(eq(thing.orgId, context.scope.orgId)) /* ... */;
  }),
};
```

Beyond hard rules 1 and 2:

- The tenant predicate also goes on queries that already filter by primary key.
  This is what makes a foreign id a `NOT_FOUND` instead of a leak.
- Mutations are a single scoped `UPDATE`/`DELETE ... RETURNING`, not
  select-then-write. Missing direct writes return `NOT_FOUND`; conditional state
  writes may collapse missing and stale rows into one `CONFLICT` (D026).
- Keyset pagination, never `OFFSET`.
- An unverified foreign org claim must never write into that tenant's audit
  trail. Audit additional domain denials only after scope is proven.

Register it in `packages/api/src/routers/index.ts`.

## 5. Route — `apps/web/src/routes/$orgSlug/<thing>.tsx`

Hard rule 2 and the UI section of `AGENTS.md` cover the route. Import `orpc` from
`@/lib/orpc` and read `orgSlug` from route params. Use only the state colours and
named exceptions documented in [Design](../../../docs/design.md); tenants do not
receive their own visual themes.

## 6. Test — `tests/integration/tenancy.test.ts`

Four questions, all of them:

1. Is the data invisible from another org?
2. Does the same client work with two org inputs concurrently?
3. Is a request naming a **foreign** org `FORBIDDEN`?
4. Is a **removed** member `FORBIDDEN` on the very next request?

Use `createTestUser`, `createOrganization`, `joinOrganization`, `clientFor`, and
`expectORPCCode`. Assert oRPC codes, not message text. For anything that reads
back a fire-and-forget `audit()` write, use `eventually`.

## 7. Gate

```sh
bun run check-types && bun run check && bun run test
```

## Self-check before calling it done

- [ ] Hard rules 1, 2, 4 and 5 hold for every file touched.
- [ ] The tenancy test answers all four questions for this domain.
- [ ] Behaviour that changed has its doc updated in the same change.
