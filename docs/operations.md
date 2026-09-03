# Operations

## Environment

`packages/env` is the runtime source of truth and validates at import time.
Local development uses the single `packages/env/.env`, copied from the example.
Real process variables win over the file; no `.env` is copied into an image.

| Variable                                                  | Used by              | Requirement                                                  |
| --------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                                            | server + web SSR     | PostgreSQL URL; test harness accepts only a `_test` database |
| `BETTER_AUTH_SECRET`                                      | server + web SSR     | At least 32 characters; identical on both runtimes           |
| `BETTER_AUTH_URL`                                         | server + web SSR     | Public API/auth origin                                       |
| `BETTER_AUTH_COOKIE_DOMAIN`                               | split-host web + API | Shared parent domain so web SSR receives the API cookie      |
| `CORS_ORIGIN`                                             | server + web SSR     | Exact web origin; also invitation-link base                  |
| `FOUNDING_EMAIL`                                          | server + web SSR     | Sole Organization-creation account                           |
| `NODE_ENV`                                                | both                 | `development`, `production`, or `test`                       |
| `VITE_SERVER_URL`                                         | web build            | Public API origin used by browser RPC                        |
| `SEAWEEDFS_ENDPOINT`                                      | server + web SSR     | Publicly reachable S3 gateway for direct browser transfer    |
| `SEAWEEDFS_BUCKET`                                        | server + web SSR     | Private bucket name                                          |
| `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` | server + web SSR     | S3 credentials                                               |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`                              | server + web SSR     | Optional positive integer; default 100 MiB                   |
| `SKIP_ENV_VALIDATION`                                     | build only           | Never set on a running application                           |

Add a variable to the narrowest Zod schema in `packages/env`, the example file,
and deployment configuration. Optional is valid only when the feature fails with
a clear named error or degrades cleanly.

The four core storage values—endpoint, bucket, access key, and secret—are
optional only as a complete group. Omitting all four leaves valid-sized upload
and read-URL operations unavailable with a named configuration error; metadata
listing still works. Supplying only part of the group produces the same error
when the storage client is first used. Upload-size validation runs before client
creation, so an oversized request may fail with the size error even when storage
is unconfigured; `SEAWEEDFS_MAX_UPLOAD_BYTES` controls that independent guard.
File deletion commits metadata before best-effort object cleanup, so missing
storage cannot roll that deletion back.

No secret or server module reaches browser assets. For a production build,
inspect `.output/public` for server imports and actual secret values; library
shims may contain variable names, so a name-only grep is insufficient.

## Deployment topology

Build two independent two-stage application images from the repository root,
plus PostgreSQL and SeaweedFS resources:

| Piece                     | Port             | Exposure                                                  |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| `apps/web` TanStack/Nitro | 3001             | public                                                    |
| `apps/server` Hono/oRPC   | 3000             | public; browser calls it directly                         |
| PostgreSQL                | provider-defined | private to web/server                                     |
| SeaweedFS S3 gateway      | provider-defined | public for signed browser PUT/GET; bucket remains private |

These are the container defaults, not the development ports. The web
Dockerfile sets `PORT=3001` for Nitro; a platform-provided `PORT` may override
it. The API exports its Hono app and lets Bun use `PORT` when supplied,
otherwise Bun listens on 3000. Its Dockerfile's `EXPOSE 3000` documents that
default but does not configure the listener.

The portless proxy is development tooling and never runs in production. It is a
dev dependency, it appears only in each app's `dev` script, and the named
`*.hms.localhost` hosts in [Development](./development.md#development-urls) have
no production counterpart.

There is no production Compose file. The local
`packages/db/docker-compose.dev.yaml` is development-only. Both app containers
receive the server environment because web SSR imports auth/database code. The
web build also receives `VITE_SERVER_URL`.

The server container applies migrations before accepting traffic. A migration
failure exits startup; concurrent starters serialize through the advisory lock.
Rolling releases require migrations compatible with the previous application
until old instances drain. Use expand-and-contract for destructive production
changes.

The D020 `chargeRevision` release is a coordinated cutover, not a rolling
release: `settleCharges` changes shape and old writers do not advance the
revision. Pause financial writes, drain the old web and API instances, apply the
migration, deploy both applications together, and then resume traffic. Do not
add a second compatibility contract for this one-time transition.

## Production hardening

Current behaviour, with the release evidence still to be recorded:

1. Organization roles are `owner`, `admin` (Administrator), `reception`,
   `cashier`, and `accountant`, each with explicit grants in
   `packages/auth/src/access.ts`; the legacy `member` key authorizes nothing and
   fails closed, so reset pre-pilot databases (D022) before deploying. Walking
   the role map with the shift lead is a [pilot readiness](#pilot-readiness) gate.
2. Each public application host sets `nosniff`, referrer, and camera,
   microphone, geolocation, and payment denial headers itself. In production
   both set HSTS; the API CSP is `default-src 'none'` and denies all framing,
   while the web CSP is self-based, permits API and storage connections, and
   allows framing only by itself (the billing PDF is a web route framed
   same-origin).
3. The two-stage application images build in dedicated builder stages. Their
   runtime stages install production-only dependencies, run as the non-root
   `node` user, and contain only dependency manifests, installed dependencies,
   and application build output; the server image additionally contains Bun and
   the database and environment sources required to migrate before serving.
   Image digests, sizes, startup health, and migration behavior are recorded at
   release time. First verification, 2026-09-03 on arm64 from commit `5f46954`
   plus the report fixes: server image 900 MB, web image 1.09 GB; the server
   migrated an empty database through `0000`–`0003` and answered `/` with the
   production headers as `node`; the web image answered `/login` and `/` with
   200, the full header set, and the skip link.
4. The tenant-safe cleanup reports abandoned `pending` uploads and unreachable
   storage objects older than the requested age. Run
   `bun run cleanup-uploads --older-than-hours 24 [--delete]`; it defaults to a
   dry run, and `--delete` removes only the reported stale rows and orphaned
   objects.

This work closes when the release evidence records image digests, sizes,
startup health, header verification on both hosts, and a reviewed cleanup dry
run, and the production verification below passes against those images.

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

The server sets credentialed CORS only for `CORS_ORIGIN`; session cookies are
HTTP-only, secure, and SameSite Lax. Both application hosts set `nosniff`,
referrer, and permissions policies on every response and add HSTS in production.
The production API CSP is `default-src 'none'; frame-ancestors 'none'`; the web
CSP is self-based, permits its API and storage origins for connections, and
allows same-origin framing only, which the billing PDF viewer requires.

## Pilot readiness

Do not schedule the first live shift until one named pilot owner has recorded
all of these as complete:

1. The shipped [operational reports and worklists](./specs/reports.md) have been
   exercised by the pilot cashier and shift lead on representative data, or a
   time-bounded manual handover procedure and owner covers any remaining gap.
2. Every pilot staff member has an operator-created account and the least
   privileged role needed for reception, billing, correction, reporting, or
   administration; the role map has been walked with the shift lead.
3. Organization, staff, catalog, tax, timezone, currency, and document-prefix
   configuration has been reviewed against representative real records.
4. The pilot accountant has approved representative classifications and
   statutory fields, and a real A4 and 80 mm printer has produced representative
   Invoice, Receipt, Credit Note, and refund documents with the scripts used at
   the hospital.
5. Reception and cashier staff have rehearsed Now, Later, check-in, cancellation,
   no-show, partial/split collection, credit, refund, and end-of-shift handover.
6. A production-like backup and joint PostgreSQL/object-storage restore has been
   timed and verified as described below, with a named cutover and rollback owner.
7. Qualified advisers have recorded the state-specific clinical-establishment,
   GST, DPDP, retention, and other duties applicable to the pilot's live scope,
   including the owner and evidence for each required control.

Record evidence and exceptions with the release, not in a permanent parallel
checklist. Re-run only the affected gate after a configuration or workflow
change.

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
