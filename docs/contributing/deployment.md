# Deployment

Two applications, deployed independently from one repository, plus two managed
resources. There is no production compose file: each app owns a Dockerfile that
builds standalone from the repository root, and the platform supplies
environment, health, and routing.

`packages/db/docker-compose.dev.yaml` is for local development only. It is not
a deployment artefact.

## Topology

| Piece      | What it is                         | Reachable from                     |
| ---------- | ---------------------------------- | ---------------------------------- |
| web        | TanStack Start on Nitro, port 3001 | the internet                       |
| server     | Hono + oRPC on Bun, port 3000      | the internet (browser calls it)    |
| PostgreSQL | Coolify resource                   | the server and web app, internally |
| SeaweedFS  | Coolify resource                   | **the internet** — see below       |

The browser talks to the server directly on every `/rpc` call, so the server is
public, not internal. The web app never proxies it.

## Coolify: the two applications

Both point at the same repository with the **Dockerfile** build pack.

|                     | server                    | web                       |
| ------------------- | ------------------------- | ------------------------- |
| Base Directory      | `/`                       | `/`                       |
| Dockerfile Location | `/apps/server/Dockerfile` | `/apps/web/Dockerfile`    |
| Port Exposes        | `3000`                    | `3001`                    |
| Domain              | `https://api.example.com` | `https://app.example.com` |

Health checks are configured in the platform UI (Coolify) per application:
neither Dockerfile declares an internal `HEALTHCHECK`.

No `depends_on` equivalent is needed. The web app validates its database and
auth environment at boot but does not make a network call to the API server.
Both applications connect to the same PostgreSQL resource.

If you serve either app from a **subpath** rather than a subdomain, uncheck
`Strip Prefixes` under Advanced — otherwise the prefix is removed before the app
sees it and every route 404s.

## Environment

### server (runtime)

| Variable                      | Required   | Value                                         |
| ----------------------------- | ---------- | --------------------------------------------- |
| `DATABASE_URL`                | yes        | Coolify's internal Postgres connection string |
| `BETTER_AUTH_SECRET`          | yes        | ≥32 chars, `openssl rand -base64 32`          |
| `BETTER_AUTH_URL`             | yes        | the server's own public origin                |
| `BETTER_AUTH_COOKIE_DOMAIN`   | split host | shared parent domain, such as `.example.com`  |
| `CORS_ORIGIN`                 | yes        | the **web app's** public origin, exactly      |
| `FOUNDING_EMAIL`              | yes        | the operator account from ADR 0014            |
| `NODE_ENV`                    | yes        | `production`                                  |
| `SEAWEEDFS_ENDPOINT`          | for files  | SeaweedFS's **public** S3 origin              |
| `SEAWEEDFS_BUCKET`            | for files  | e.g. `files`                                  |
| `SEAWEEDFS_ACCESS_KEY_ID`     | for files  |                                               |
| `SEAWEEDFS_SECRET_ACCESS_KEY` | for files  |                                               |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`  | no         | default 100 MB                                |

Sign-up is disabled; see
[ADR 0013](./decisions/0013-signup-disabled.md). To create an account, run
`bun run create-user <email> <name> <password>` against the server
with its environment.

Google OAuth is not wired. When it is added later, configure
`socialProviders.google`, set `disableImplicitSignUp: true` so strangers
cannot self-register through it, and note that operator-created accounts are
`emailVerified: true`, which is what allows the Google sign-in to link to
them.

`CORS_ORIGIN` is also the base for invitation links, so it must be the origin a
recipient can actually open.

Everything except the SeaweedFS keys is validated at boot by
`packages/env/src/server.ts` — a misconfigured server fails to start rather than
failing on the first request.

### web

| Variable                    | Phase   | Value                                        |
| --------------------------- | ------- | -------------------------------------------- |
| `VITE_SERVER_URL`           | build   | the server's public origin                   |
| `DATABASE_URL`              | runtime | the same internal Postgres connection string |
| `BETTER_AUTH_SECRET`        | runtime | the same value as the server                 |
| `BETTER_AUTH_URL`           | runtime | the server's public origin                   |
| `BETTER_AUTH_COOKIE_DOMAIN` | runtime | the same shared parent domain as the server  |
| `CORS_ORIGIN`               | runtime | the web app's public origin                  |
| `FOUNDING_EMAIL`            | runtime | the same value as the server                 |
| `NODE_ENV`                  | runtime | `production`                                 |

`VITE_SERVER_URL` is compiled into the browser bundle and needs a rebuild when
it changes. The other values configure the Nitro SSR process and must be present
when the container starts.

## Constraints that will break the deployment if ignored

**Both apps must share a registrable domain and cookie domain.**
`app.example.com` + `api.example.com` with
`BETTER_AUTH_COOKIE_DOMAIN=.example.com` is valid. The API issues the shared
`httpOnly`, `secure`, `sameSite: "lax"` session cookie; the web host then receives
it on org-page requests and can verify the session during SSR. Genuinely
cross-site deployment requires a different cookie policy and is not supported.

**No shared cache may hold SSR HTML.** Org pages server-render the signed-in
user's own data — their email, their organization names, their shell. A CDN,
reverse proxy, or platform cache in front of the web app would serve one user's
document to the next. Cache static assets only; keep every org route
uncacheable.

**PostgreSQL must sit next to the web and API processes.** Same host, or the
same region on a low-latency link. An org page awaits several queries per
render, so every millisecond of web→database latency multiplies straight into
TTFB. A database in another region turns a fast page into a slow one.

**SeaweedFS must be publicly reachable, at one origin.**
`packages/storage/src/index.ts` presigns with `forcePathStyle: true`, so
`SEAWEEDFS_ENDPOINT` is embedded in the URL handed to the browser — the browser
uploads and downloads directly, never through the app server. An internal
Coolify hostname produces URLs no client can resolve. The signature is
host-bound, so you cannot presign against an internal host and rewrite it
afterwards either.

**SeaweedFS needs CORS for the web origin.** Because the browser PUTs to it
directly, its S3 gateway must allow your web origin. The dev compose does this
with `-s3.allowedOrigins=http://localhost:3001`; production needs the same flag
with the real origin. Without it, uploads fail in the browser with a CORS error
and nothing appears in the server logs.

**The bucket is not created by the app.** The dev compose seeds it with
`S3_BUCKET: files`; the deployed resource needs the equivalent.

**The bucket must never be anonymously readable.** Every object is served
through a short-lived presigned URL by design — see ADR 0006. A policy broad
enough to serve "public" files exposes every tenant's private files at a
guessable URL.

## Migrations

The server container runs migrations before it accepts traffic:

```
bun /app/packages/db/src/migrate-command.ts && \
  exec bun dist/index.mjs
```

A failed migration therefore fails the deploy instead of leaving a running
server against a schema it does not understand. `packages/db/src/migrate.ts`
takes a Postgres advisory lock, so
concurrent replicas starting together serialise safely — the loser waits, finds
the journal applied, and continues.

The app is still pre-production, so releases are clean cutovers rather than
mixed-version rolling deployments. A release stops the old application,
applies its migration, and starts the new application. Do not add compatibility
columns, dual reads, or dual writes. Revisit the rollout strategy before the
first deployment that requires overlapping application versions. See
[ADR 0012](./decisions/0012-migrations-run-before-the-server.md).

**The migration base is fresh-database only.** The single initial migration
creates every table unconditionally; a database whose schema predates the
migration journal (e.g. one built with `db:push`) will fail the first
migrate-on-boot and the deploy stops before the server starts. Point a
deployment at an empty database, or reset the schema once
(`bun run db:seed -- --reset` in dev), and let the journal take over from
there.

## Release verification

No script covers these. Run them by hand before a release goes to users
([ADR 0021](./decisions/0021-server-rendered-org-pages.md)).

The web build emits Brotli and gzip variants for public assets. Nitro documents this as zero-runtime-
overhead compression for deployments where the Node process serves `.output/public`; keep it enabled
even when a CDN is added, unless the CDN is proven to compress the same immutable assets itself
([Nitro `compressPublicAssets`](https://nitro.build/config#compresspublicassets)). A production asset
request with `Accept-Encoding: br,gzip` must return `Content-Encoding: br` or `gzip`; if the host
uses chunked transfer rather than `Content-Length`, verify the browser's transferred bytes instead.

1. **The org routes render on the server.** Build and serve the web app, sign
   in, and load representative org routes — `/$orgSlug/dashboard`,
   `/$orgSlug/patients`, and `/$orgSlug/opd`.
   Search each response's HTML for `<!--$!-->`. That marker means the server
   render threw and the browser silently recovered; treat any occurrence as a
   failed release.
2. **The client bundle is clean.** Grep the built client assets for server
   secrets (`BETTER_AUTH_SECRET`, `DATABASE_URL`, connection strings) and for
   database code. Both must be absent.
3. **A signed-in org URL survives a refresh on the deployed host.** A wrong
   database or cookie domain looks like a signed-out session, and only a real
   refresh against the deployed web host shows it.
4. **The performance fixture still satisfies correctness budgets.** Use
   `bun run benchmark:browser` and `bun run benchmark:server` with the isolated
   fixture described in
   [`docs/research/10-production-performance-benchmark.md`](../research/10-production-performance-benchmark.md).
   The commands exit nonzero for redirects, failed documents, SSR recovery,
   hydration RPCs, or CLS above 0.05. Compare the emitted JSON with the committed
   baseline manually; the harness does not automatically reject a 5% timing or
   transfer regression.

## Backups

Two stores hold data that cannot be recreated:

| Store      | Holds                                                | Covered by                   |
| ---------- | ---------------------------------------------------- | ---------------------------- |
| PostgreSQL | patients, opd_appointments, invoices, journal, audit | Coolify scheduled backup     |
| SeaweedFS  | uploaded documents and prescription scans            | **nothing — configure this** |

Postgres is a Coolify resource, so its own scheduled backup owns the dump and
the offsite copy. Configure it with an S3 destination, not local retention: a
dump on the same disk as the database is lost by the same failure that loses
the database.

**The database backup does not cover object storage.** A restored Postgres with
no matching bucket gives every patient a file row whose object is missing —
the record survives and the scanned prescription does not. Replicate the
SeaweedFS volume on the same schedule.

A backup nobody has restored is a guess. **Rehearse a restore before go-live,
and after any migration that rewrites data.** Restore into an empty database
(migrations then find the journal applied and continue), point a scratch
deployment at it, then sign in, open a patient, and read a GST report. If those
four work, the copy is real.

## Known gaps

- **No security headers.** Neither app sets `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, or
  `Permissions-Policy`. Add them at the proxy or in middleware before going
  public.
- **Images are large.** Neither Dockerfile is multi-stage: both ship the whole
  monorepo source and every workspace devDependency, including `apps/fumadocs`.
  Measured at ~1.1 GB each. A production-only runtime stage would cut this
  substantially but has to keep `node_modules` — the server externalizes all
  third-party deps and Nitro's output requires them at runtime.
- **Abandoned uploads are never reclaimed.** A `pending` file row whose upload
  was never finalized keeps both the row and, if the PUT succeeded, the object.
  There is no reaper.

## Other platforms

The web app is Nitro, so it can target any Nitro preset — Cloudflare Workers,
Vercel, Deno Deploy — by configuring the preset in `apps/web/vite.config.ts`.

The server cannot. It is Node/Bun with a long-lived Postgres pool and is not
edge-compatible; it needs a container or a Node-capable host.
