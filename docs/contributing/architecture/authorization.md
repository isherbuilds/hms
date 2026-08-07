# Authorization

Access control is Better Auth's organization access-control plugin, configured
in exactly one place: `packages/auth/src/access.ts`.

## The model

A **statement** is a resource with a list of actions. A **role** is a set of
grants over those statements. A **member** holds one or more roles within one
organization, and their effective permissions are the **union** of those roles.

```ts
export const ac = createAccessControl({
  ...defaultStatements,
  member: ["create", "read", "update", "delete"],
  settings: ["read", "update"],
  audit: ["read"],
  storage: ["upload", "read", "delete"],
  ai: ["use"],
} as const);
```

`member` is Better Auth's own statement, extended with a `read` action of ours
so everyone in an org can see who else is in it while only admins can change it.

## Roles state their grants explicitly

Three roles: `owner`, `admin`, `member`. Each spreads the Better Auth defaults
and then **states this app's grants explicitly** rather than inheriting from a
lesser role. Permissions are the last place to be clever about inheritance — a
reader must see a role's full surface in one block. `owner` and `admin` looking
nearly identical is the correct amount of duplication.

`ORG_ROLES` is the display order, most privileged first, and drives role pickers
and validation.

## The module stays dependency-free

`access.ts` imports nothing from the database or the environment. That is what
lets the server (Better Auth config, the oRPC guard) and the client
(`organizationClient`) share one definition without pulling Node-only code into
the browser bundle. Keep it that way: a permission decision that needs a
database read is a decision that belongs in a handler, not in this module.

## Roles are a union, and unknown roles throw

Better Auth stores a member's roles comma-joined and authorizes them as a union.
`parseRoles` mirrors that exactly:

```ts
const roles = parseRoles(row.role); // ["admin", "member"]
authorize(roles, { settings: ["update"] }); // true if ANY role grants it
```

Never read `row.role.split(",")[0]` — that silently drops a member's privileges,
and the bug only shows up for the multi-role members you have not created yet.
`parseRoles` **throws** on a role this app does not define rather than
downgrading it to `member`: an unrecognized role is a data or deployment error,
and quietly granting less is how a permission bug hides.

## The guard

An org procedure is declared with `orgProcedure(permission, input)`. Its input
schema extends `orgInput`, and its internal guard performs the membership lookup
directly after parsing. The framework adapter supplies the session and headers;
the guard requires, in order:

1. A session, else `UNAUTHORIZED`.
2. A verified membership, else `FORBIDDEN`.
3. `authorize(roles, permission)`, else `FORBIDDEN` + audit.

It adds verified `scope` to context. The original input claim remains ordinary
handler input, but it is never used for authorization or query scope.

```ts
delete: orgProcedure(
  { storage: ["delete"] },
  orgInput.extend({ id: z.number() }),
).handler(async ({ context, input }) => {
  // input.orgSlug is the claim; context.scope.orgId is proven.
}),
```

The internal guard tenant-audits role denials only after membership is verified.
A foreign membership claim is rejected without a tenant audit write because the
claimed org is not proven scope. Context construction has no audit side effects.
Routers do not repeat guard denials; they call
`audit()` only for sensitive or destructive successes and for domain-specific
denials the guard cannot see — such as `assertKeyInScope` catching a probe for
another tenant's object key.

## Adding a permission

1. Add the statement (or the action) to `ac` in `access.ts`.
2. Add the grant to each role that should have it — explicitly, in each role
   block.
3. Declare the procedure with
   `orgProcedure({ resource: ["action"] }, orgInput.extend({ ... }))`.
   `AppPermission` is derived from `ac`, so a typo is a compile error. The
   permission is a required constructor argument and the raw builder is not
   exported, so the guard cannot be omitted.
4. Cover it in `tests/unit/access.test.ts` if the grant matrix is non-obvious,
   and in `tests/integration/tenancy.test.ts` if a role must be _denied_.

## Client-side checks are cosmetic

The client can import `access.ts` to hide a control a member cannot use. That is
a UX affordance only. Every mutation is re-checked by `orgProcedure`'s internal
guard on the server; a hidden button is not an access control.
