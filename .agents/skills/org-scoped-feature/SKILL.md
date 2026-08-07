---
name: org-scoped-feature
description: >-
  Add or change an organization-scoped domain in this repo — schema, migration, permission,
  oRPC router, route, and the tenancy test. Use whenever work touches a table with orgId, a
  procedure guarded by requirePermission, packages/auth/src/access.ts, or a page under
  apps/web/src/routes/org/$orgSlug/.
---

# Add an org-scoped feature

Every domain row belongs to exactly one organization. This skill is the
end-to-end path for a new one. Background:
[tenancy](../../../docs/contributing/architecture/tenancy.md),
[authorization](../../../docs/contributing/architecture/authorization.md).

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

- `orgId` is `NOT NULL` and cascades from the org. Not nullable, not optional.
- `userId` is **attribution only**. It never authorizes anything.
- The index leads with `orgId`, then the sort and keyset columns in query order.
- Export it from `packages/db/src/schema/index.ts`.

## 2. Migration

```sh
bun run db:generate
```

Never hand-edit the output. Hand-authored SQL gets its own migration file.

## 3. Permission — `packages/auth/src/access.ts`

Add the statement to `ac`, then add the grant **explicitly** to each role that
should have it. Do not inherit from a lesser role; `owner` and `admin` looking
alike is intended.

```ts
export const ac = createAccessControl({ ..., thing: ["create", "read", "update", "delete"] } as const);
```

## 4. Router — `packages/api/src/routers/<thing>.ts`

```ts
export const thingRouter = {
  list: publicProcedure
    .input(orgInput.extend({ cursor: ..., limit: z.number().int().min(1).max(100).default(50) }))
    .use(requirePermission({ thing: ["read"] }))
    .handler(async ({ context, input }) => {
      return db.select().from(thing).where(eq(thing.orgId, context.scope.orgId)) /* ... */;
    }),
};
```

Non-negotiable in every handler:

- `eq(table.orgId, context.scope.orgId)` in **every** `where`, including queries
  that already filter by primary key. This is what makes a foreign id a
  `NOT_FOUND` instead of a leak.
- Use `context.scope`; never derive scope from the session, URL, or input.
- Mutations are a single scoped `UPDATE`/`DELETE ... RETURNING`, not
  select-then-write. Missing row → `NOT_FOUND`.
- Keyset pagination, never `OFFSET`.
- `audit()` for destructive or sensitive successes only. Verified role denials
  are audited centrally in `requirePermission`; an unverified foreign org claim
  must never write into that tenant's audit trail. Audit only additional domain
  denials after scope is proven.

Register it in `packages/api/src/routers/index.ts`.

## 5. Route — `apps/web/src/routes/org/$orgSlug/<thing>.tsx`

It must live under the org layout, import the singleton `orpc` from
`@/lib/orpc`, read `orgSlug` from route params, and include it in every procedure
input and tenant-specific invalidation key. The layout currently sets `ssr: false`
because its session and organization-list checks are client-side.

Follow `packages/ui` (shadcn `base-lyra` on Base UI: zero radius, `text-xs`,
compact). Colour means one thing only — which tenant you are acting as.

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

- [ ] Every query in the new router has the tenant predicate.
- [ ] No handler re-derives an org from the URL, session, or input.
- [ ] The permission is granted explicitly per role, in `access.ts` only.
- [ ] The page is under `routes/org/$orgSlug/`, imports `orpc`, and passes `orgSlug` in every call and tenant-specific key.
- [ ] The tenancy test answers all four questions for this domain.
- [ ] The migration is generated, not hand-edited.
- [ ] Behaviour that changed has its doc updated in the same change.
