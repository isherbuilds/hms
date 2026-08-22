# Architecture overview

## Shape

One oRPC router (`packages/api`) is served two ways and consumed three ways:

```
browser ──HTTP──▶ apps/server (Hono)  ──▶ RPCHandler ──┐
                  └─ Better Auth handler at /api/auth  │
                                                       ├──▶ appRouter
apps/web SSR ────in-process createRouterClient ────────┤
tests ───────────in-process createRouterClient ────────┘
```

The router never knows which entry point called it: every one of them builds the
same context from raw `Headers`. That is why an integration test exercises the
real guard rather than a stand-in, and why SSR needs no running API process.

## The two things that matter

**Tenancy.** Every domain row belongs to exactly one org, and the org a request
operates in is an explicit per-request claim proven against the `member` table.
See [tenancy](./tenancy.md).

**Authorization.** Roles carry structured permissions defined once in a
dependency-free module and enforced by one middleware. See
[authorization](./authorization.md).

Everything else in this folder is downstream of those two.

## Core docs

- [Tenancy](./tenancy.md) — the org claim, the tenant predicate, org switching
- [Authorization](./authorization.md) — the access-control model and guards
- [Request lifecycle](./request-lifecycle.md) — from URL to handler
- [Data fetching](./data-fetching.md) — loaders, the query cache, SSR data transfer
- [Data storage](./data-storage.md) — schema conventions and indexing
- [Audit](./audit.md) — what to record and how
- [File storage](./file-storage.md) — presigned-only object storage
- [HMS domain layer](./domain-layer.md) — live relationships and the patient and OPD appointment boundary
- [Accounting ledger](./accounting.md) — double-entry posting and statutory handover boundary

## Source of truth in code

| Concern                   | File                                    |
| ------------------------- | --------------------------------------- |
| Permissions and roles     | `packages/auth/src/access.ts`           |
| Request context + adapter | `packages/api/src/lib/context.ts`       |
| Web oRPC client           | `apps/web/src/lib/orpc.ts`              |
| Tenant + permission guard | `packages/api/src/lib/procedures/`      |
| Audit writes              | `packages/api/src/audit.ts`             |
| Auth configuration        | `packages/auth/src/index.ts`            |
| Schema                    | `packages/db/src/schema/`               |
| Object storage            | `packages/storage/src/index.ts`         |
| Browser org selection     | `apps/web/src/components/app-shell.tsx` |
| HTTP host                 | `apps/server/src/index.ts`              |

When one of these changes, the doc that describes it changes in the same commit.
