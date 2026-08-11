# Environment variables

`packages/env` is the single source of truth for both types and runtime
validation. Validation happens at import time and **throws**, so a
misconfigured deployment fails at boot rather than at the first request that
needs the value.

- `packages/env/src/server.ts` — server-only values. Never import this from code
  that reaches the browser bundle.
- `packages/env/src/web.ts` — values exposed to the client. Only `VITE_`-prefixed
  names belong here.

## Adding one

1. Add the key to the correct schema in `packages/env` with the narrowest Zod
   type that expresses the constraint (`z.url()`, `z.string().min(32)`,
   `z.coerce.number().int().positive()`). A `z.string()` that accepts anything
   is a missed chance to fail loud.
2. Decide required vs optional. Optional means the feature it powers degrades
   cleanly — `packages/storage` throws a named error listing the four SeaweedFS
   variables when a file operation is attempted without them, rather than
   preventing the app from starting.
3. Add it to `apps/server/.env.example` with a placeholder, never a real value.
4. Document it in the table below.
5. Add it to the deployment configuration.

## Server

| Variable                      | Required | Purpose                                                                                                 |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | yes      | PostgreSQL connection string. The test harness refuses any name not ending `_test`.                     |
| `BETTER_AUTH_SECRET`          | yes      | Session signing key, ≥32 characters.                                                                    |
| `BETTER_AUTH_URL`             | yes      | Public base URL Better Auth issues callbacks against.                                                   |
| `CORS_ORIGIN`                 | yes      | The web app's origin. Also the trusted origin and the invitation-link base.                             |
| `FOUNDING_EMAIL`              | yes      | The only account allowed to create organizations (ADR 0014). Provisioned with `bun run create-founder`. |
| `NODE_ENV`                    | no       | `development` \| `production` \| `test`. Controls production logging and development-only tooling.      |
| `SEAWEEDFS_ENDPOINT`          | no       | S3 gateway endpoint. File features are disabled without the set of four.                                |
| `SEAWEEDFS_ACCESS_KEY_ID`     | no       | S3 access key.                                                                                          |
| `SEAWEEDFS_SECRET_ACCESS_KEY` | no       | S3 secret key.                                                                                          |
| `SEAWEEDFS_BUCKET`            | no       | Bucket name. Must **not** be anonymously readable — see [file storage](./architecture/file-storage.md). |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`  | no       | Upload ceiling; defaults to 100 MiB.                                                                    |
| `SKIP_ENV_VALIDATION`         | no       | Escape hatch for build-time steps only. Never set in a running deployment.                              |

## Web

| Variable          | Required | Purpose                                  |
| ----------------- | -------- | ---------------------------------------- |
| `VITE_SERVER_URL` | yes      | Origin the browser's oRPC link talks to. |

## Secrets

No secret and no server-only module may reach a client asset. The mechanical
check is the import: if a module under `apps/web/src/` (outside `server/`)
transitively _value_-imports `@hms/env/server`, that is the bug.

One deliberate exception: `apps/web/src/lib/orpc.ts` imports `@hms/auth`
for the SSR half of its `createIsomorphicFn()` (ADR 0009). That branch is
compiled out of the client bundle by the `tanstackStart()` Vite plugin, so the
grep flags it but it is not a leak. Verify with a build rather than a grep:

```bash
cd apps/web && bun run build
grep -rl "drizzle-orm\|DATABASE_URL\|SEAWEEDFS" .output/public   # expect no matches
```

Anything _else_ under `apps/web/src/` matching the grep is the bug.
