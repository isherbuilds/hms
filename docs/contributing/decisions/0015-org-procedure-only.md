# 0015: Procedures are declared through orgProcedure only

- **Status:** accepted
- **Date:** 2026-08-07

## Context

Every oRPC procedure in the application is organization-scoped and guarded. The
former declaration chain started with `publicProcedure`, parsed input, and then
added `.use(requirePermission(permission))` in each router. That chain compiled
when the guard was forgotten, and the builder's public-sounding name suggested
that an unguarded procedure was a supported application endpoint.

## Decision

`packages/api/src/lib/procedures/factory.ts` exports only
`orgProcedure(permission, input)` for declaring oRPC procedures. The permission
and an input schema containing `orgSlug` are constructor arguments; membership
resolution, the role grant, and verified `context.scope` are internal to the
factory. The raw builder is not exported.

A future genuinely public oRPC endpoint requires a new decision rather than an
escape hatch in this factory. `authorizeOrg` remains exported for the non-oRPC
AI endpoint, which needs the same authorization semantics without a procedure
builder.

## Consequences

- An unguarded organization procedure is unrepresentable through the supported
  factory API.
- Routers cannot accidentally omit membership resolution or the permission
  grant while still compiling.
- Membership remains fresh per request, and role denials remain audited inside
  the internal guard after tenant scope is proven.
- A genuinely public oRPC surface requires an explicit architectural review and
  a deliberately named factory.
