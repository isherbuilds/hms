# Deployment

Two applications, deployed independently from one repository, plus two managed
resources. There is no production compose file: each app owns a Dockerfile that
builds standalone from the repository root, and the platform supplies
environment, health, and routing.

`packages/db/docker-compose.dev.yaml` is for local development only. It is not
a deployment artefact.

## Topology

| Piece      | What it is                         | Reachable from                  |
| ---------- | ---------------------------------- | ------------------------------- |
| web        | TanStack Start on Nitro, port 3001 | the internet                    |
| server     | Hono + oRPC on Bun, port 3000      | the internet (browser calls it) |
| PostgreSQL | Coolify resource                   | the server only, internally     |
| SeaweedFS  | Coolify resource                   | **the internet** — see below    |

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

No `depends_on` equivalent is needed. The web app makes no server call while
booting; a cold server only means the landing page's status dot reads
"API unreachable" until it warms up.

If you serve either app from a **subpath** rather than a subdomain, uncheck
`Strip Prefixes` under Advanced — otherwise the prefix is removed before the app
sees it and every route 404s.

## Environment

### server (all runtime)

| Variable                       | Required  | Value                                         |
| ------------------------------ | --------- | --------------------------------------------- |
| `DATABASE_URL`                 | yes       | Coolify's internal Postgres connection string |
| `BETTER_AUTH_SECRET`           | yes       | ≥32 chars, `openssl rand -base64 32`          |
| `BETTER_AUTH_URL`              | yes       | the server's own public origin                |
| `CORS_ORIGIN`                  | yes       | the **web app's** public origin, exactly      |
| `NODE_ENV`                     | yes       | `production`                                  |
| `SEAWEEDFS_ENDPOINT`           | for files | SeaweedFS's **public** S3 origin              |
| `SEAWEEDFS_BUCKET`             | for files | e.g. `files`                                  |
| `SEAWEEDFS_ACCESS_KEY_ID`      | for files |                                               |
| `SEAWEEDFS_SECRET_ACCESS_KEY`  | for files |                                               |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`   | no        | default 100 MB                                |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for `/ai` |                                               |

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

Everything except the SeaweedFS and AI keys is validated at boot by
`packages/env/src/server.ts` — a misconfigured server fails to start rather than
failing on the first request.

### web (all build-time)

| Variable          | Required | Value                      |
| ----------------- | -------- | -------------------------- |
| `VITE_SERVER_URL` | yes      | the server's public origin |

**This must be a build variable, not a runtime one.** It is read through
`import.meta.env` and compiled into the bundle. Changing it and restarting keeps
the old URL baked in; you have to rebuild. The web app needs no runtime
environment at all.

## Constraints that will break the deployment if ignored

**Both apps must share a registrable domain.** `app.example.com` +
`api.example.com` is fine; `myapp.com` + `myapi.dev` is not. `packages/auth`
sets `sameSite: "lax"`, and Lax cookies are not sent on cross-_site_ fetches —
which is what every `/rpc` call is. Sign-in would appear to succeed and every
subsequent request would be 401. Genuinely cross-domain requires `sameSite:
"none"` and the Safari ITP caveats that come with it.

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
bun /app/packages/db/src/migrate-command.ts && exec bun dist/index.mjs
```

A failed migration therefore fails the deploy instead of leaving a running
server against a schema it does not understand. `packages/db/src/migrate.ts`
takes a Postgres advisory lock, so concurrent replicas starting together
serialise safely — the loser waits, finds the journal applied, and continues.

The consequence is the usual one for migrate-on-boot: during a rolling update
the old release runs briefly against the new schema, so migrations must stay
backward-compatible for one release. See
[ADR 0012](./decisions/0012-migrations-run-before-the-server.md).

**The migration base is fresh-database only.** The single initial migration
creates every table unconditionally; a database whose schema predates the
migration journal (e.g. one built with `db:push`) will fail the first
migrate-on-boot and the deploy stops before the server starts. Point a
deployment at an empty database, or reset the schema once
(`bun run db:seed -- --reset` in dev), and let the journal take over from
there.

## Backups

Two stores hold data that cannot be recreated:

| Store      | Holds                                      | Covered by                   |
| ---------- | ------------------------------------------ | ---------------------------- |
| PostgreSQL | patients, visits, invoices, journal, audit | Coolify scheduled backup     |
| SeaweedFS  | uploaded documents and prescription scans  | **nothing — configure this** |

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
