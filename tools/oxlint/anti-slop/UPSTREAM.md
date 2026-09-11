# Vendored anti-slop Oxlint plugin

Installed 2026-09-11 from the `install-anti-slop` skill bundle
(`~/.claude/skills/install-anti-slop/assets/anti-slop`). The bundle carries no
Git metadata, so the upstream repository and source commit are **unknown**.
The nested `vendor/eslint-stylistic/UPSTREAM.md` records its own provenance.

Installed paths:

- `tools/oxlint/anti-slop/index.ts` (generic plugin, registered in `.oxlintrc.json`)
- `tools/oxlint/anti-slop/effect/index.ts` (Effect plugin, not registered; repo has no `effect` dependency)

Dependencies: `@oxlint/plugins` pinned to `1.81.0`, matching the installed `oxlint`.

Intentional deviations: none. Files are unmodified copies.
