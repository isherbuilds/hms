# HMS

A multi-tenant hospital operations system for OPD front-office and billing
workflows. It is a Bun/Turborepo monorepo with TanStack Start, Hono/oRPC,
Drizzle/PostgreSQL, Better Auth, and private S3-compatible storage.

## Start locally

Prerequisites are Bun (the version pinned in `package.json`), Node 24, and
Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Once per machine, start the named local HTTPS proxy:
bunx portless proxy start
# Fill in the environment file, then start the stack:
bun run dev
```

The root command starts PostgreSQL and SeaweedFS, applies migrations, and runs
the web app, API, and end-user docs at `https://hms.localhost`,
`https://api.hms.localhost`, and `https://docs.hms.localhost`. See
[Development](docs/development.md) for accounts, worktrees, proxy bypass, and
the canonical command list.

## Documentation

Start at the [documentation index](docs/README.md) for the source-of-truth map
and current work registry. Contributor and agent rules are in
[AGENTS.md](AGENTS.md); end-user help lives in `apps/fumadocs`.

## License

HMS is licensed under the [GNU Affero General Public License v3.0](LICENSE).
The corresponding source is available at <https://github.com/isherbuilds/hms>.
