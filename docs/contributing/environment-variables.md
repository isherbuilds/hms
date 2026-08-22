# Environment variables

`packages/env` is the single source of truth for both types and runtime
validation. Validation happens at import time and **throws**, so a
misconfigured deployment fails at boot rather than at the first request that
needs the value.

- `packages/env/src/server.ts` — server-only values. Never import this from code
  that reaches the browser bundle.
- `packages/env/src/web.ts` — values exposed to the client. Only `VITE_`-prefixed
  names belong here.

## One file

`packages/env/.env` is the repo's only `.env`. Copy it from the `.env.example`
beside it.

`packages/env/src/load.ts` resolves that path from its own module URL, not from
the working directory, so the API server, the web app's SSR runtime,
`drizzle-kit` and the operator scripts all read the same file no matter which
directory Turbo or Bun started them in. Nothing passes `--env-file`. Vite is
pointed at the same directory by `envDir` in `apps/web/vite.config.ts`, which is
how `VITE_*` names reach the client bundle.

Real environment variables always win — dotenv never overwrites a name that is
already set. That is what lets `tests/support/preload.ts` pin the test database
and lets a container get its values from the platform. No `.env` ships in an
image (see `.dockerignore`); a missing file is a silent no-op.

## Adding one

1. Add the key to the correct schema in `packages/env` with the narrowest Zod
   type that expresses the constraint (`z.url()`, `z.string().min(32)`,
   `z.coerce.number().int().positive()`). A `z.string()` that accepts anything
   is a missed chance to fail loud.
2. Decide required vs optional. Optional means the feature it powers degrades
   cleanly — `packages/storage` throws a named error listing the four SeaweedFS
   variables when a file operation is attempted without them, rather than
   preventing the app from starting.
3. Add it to `packages/env/.env.example`.
4. Document it in the table below.
5. Add it to the deployment configuration.

## Server

| Variable                      | Required | Purpose                                                                                                 |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | yes      | PostgreSQL connection string. The test harness refuses any name not ending `_test`.                     |
| `BETTER_AUTH_SECRET`          | yes      | Session signing key, ≥32 characters.                                                                    |
| `BETTER_AUTH_URL`             | yes      | Public base URL Better Auth issues callbacks against.                                                   |
| `BETTER_AUTH_COOKIE_DOMAIN`   | deploy   | Shared parent domain such as `.example.com` when web and API use separate subdomains.                   |
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

Org pages server-render ([ADR 0021](./decisions/0021-server-rendered-org-pages.md)).
SSR calls the API router in-process, so the web runtime imports the same auth,
database, and validated server environment as the API process. Locally the one
`.env` covers both. In a deployment the web container needs every variable
below set on it too, with the same values as the API container.

| Variable                    | Phase   | Purpose                                                              |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `VITE_SERVER_URL`           | build   | Origin the browser's oRPC link calls.                                |
| `DATABASE_URL`              | runtime | Same database as the API server.                                     |
| `BETTER_AUTH_SECRET`        | runtime | Must match the API server.                                           |
| `BETTER_AUTH_URL`           | runtime | Must match the API server.                                           |
| `BETTER_AUTH_COOKIE_DOMAIN` | runtime | Shared parent domain for separate production web and API subdomains. |
| `CORS_ORIGIN`               | runtime | Web origin; must match the API server.                               |
| `FOUNDING_EMAIL`            | runtime | Must match because the shared auth configuration validates it.       |
| `NODE_ENV`                  | runtime | Set to `production` in production.                                   |

A missing or invalid runtime value fails web startup. A valid but wrong database,
secret, URL, or cookie domain can make every SSR session look signed out.

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

`BETTER_AUTH_SECRET` is the exception: better-auth's client ships a lazy env
shim that names it, so the name appears in `auth-client-*.js`. Grep for the
value from your `.env`, not the name — the value must not appear.

Anything _else_ under `apps/web/src/` matching the grep is the bug.
