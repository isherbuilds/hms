# Operations

## Environment

`packages/env` is the runtime source of truth and validates at import time.
Local development uses the single `packages/env/.env`, copied from the example.
Real process variables win over the file; no `.env` is copied into an image.

| Variable                                                  | Used by               | Requirement                                                  |
| --------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                                            | server + web SSR      | PostgreSQL URL; test harness accepts only a `_test` database |
| `BETTER_AUTH_SECRET`                                      | server + web SSR      | At least 32 characters; identical on both runtimes           |
| `BETTER_AUTH_URL`                                         | server + web SSR      | Public API/auth origin                                       |
| `BETTER_AUTH_COOKIE_DOMAIN`                               | split-host production | Shared parent domain so SSR receives the auth cookie         |
| `CORS_ORIGIN`                                             | server + web SSR      | Exact web origin; also invitation-link base                  |
| `FOUNDING_EMAIL`                                          | server + web SSR      | Sole Organization-creation account                           |
| `NODE_ENV`                                                | both                  | `development`, `production`, or `test`                       |
| `VITE_SERVER_URL`                                         | web build             | Public API origin used by browser RPC                        |
| `SEAWEEDFS_ENDPOINT`                                      | server                | Publicly reachable S3 gateway for direct browser transfer    |
| `SEAWEEDFS_BUCKET`                                        | server                | Private bucket name                                          |
| `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` | server                | S3 credentials                                               |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`                              | server                | Optional positive integer; default 100 MiB                   |
| `SKIP_ENV_VALIDATION`                                     | build only            | Never set on a running application                           |

Add a variable to the narrowest Zod schema in `packages/env`, the example file,
and deployment configuration. Optional is valid only when the feature fails with
a clear named error or degrades cleanly.

No secret or server module reaches browser assets. For a production build,
inspect `.output/public` for server imports and actual secret values; library
shims may contain variable names, so a name-only grep is insufficient.

## Deployment topology

Deploy two independent Dockerfiles from the repository root, plus PostgreSQL and
SeaweedFS resources:

| Piece                     | Port             | Exposure                                                  |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| `apps/web` TanStack/Nitro | 3001             | public                                                    |
| `apps/server` Hono/oRPC   | 3000             | public; browser calls it directly                         |
| PostgreSQL                | provider-defined | private to web/server                                     |
| SeaweedFS S3 gateway      | provider-defined | public for signed browser PUT/GET; bucket remains private |

There is no production Compose file. The local
`packages/db/docker-compose.dev.yaml` is development-only. Both app containers
receive the server environment because web SSR imports auth/database code. The
web build also receives `VITE_SERVER_URL`.

The server container applies migrations before accepting traffic. A migration
failure exits startup; concurrent starters serialize through the advisory lock.
Rolling releases require migrations compatible with the previous application
until old instances drain. Use expand-and-contract for destructive production
changes.

## Release verification

1. Record the commit and run typecheck, lint/format, tests, and production build.
2. Start both production images with production-like environment.
3. Verify API health, login, and a hard refresh of a signed-in org URL on the
   web host.
4. Inspect representative server-rendered HTML for render-failure markers and
   ensure client assets contain no secret values or database/storage code.
5. Exercise an org switch, Patient/OPD/Billing reads, one guarded mutation, and
   cross-tenant denial.
6. Upload and read a private file through presigned URLs.
7. Verify a real printer against the itemized bill and payment receipt before
   pilot cutover.

The server must set credentialed CORS only for `CORS_ORIGIN`; session cookies
are HTTP-only, secure, and SameSite Lax. Add standard security headers at the
proxy or middleware before public traffic: CSP, HSTS, frame restriction,
`nosniff`, referrer, and permissions policy.

## Accounts and Organizations

Public sign-up stays disabled. Run `create-founder` once for `FOUNDING_EMAIL`,
then `create-user` for operator-created accounts. The founder creates an
Organization at `/create`; staff join through an invitation at `/join`.
Organization owners cannot create additional Organizations unless they are also
the configured founder.

Invitation links are logged/returned until a delivery provider is configured;
production onboarding must not assume email delivery exists.

## Backups and restore

Back up PostgreSQL and object storage together on an off-host schedule. A
database-only restore preserves file rows but loses prescription objects; a
bucket-only restore loses authorization and metadata.

Before go-live and after any data-rewriting migration:

1. Restore both resources into an isolated environment.
2. Point a scratch deployment at them.
3. Sign in, open an org and Patient/OPD record, download a private file, and
   run a billing/GST report.
4. Record the restore date, duration, and failures.

Known production gaps to close before public traffic: standard security
headers, oversized single-stage container images, and cleanup of abandoned
`pending` uploads/orphaned objects.
