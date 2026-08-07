# Harness engineering

This repository is worked on by agents as well as people. This guide is about
turning each change into a durable improvement rather than a one-off fix.

Adapted from Kent C. Dodds' `kody` and OpenAI's
["Harness engineering"](https://openai.com/index/harness-engineering/).

## Core mindset

- Humans steer outcomes; agents execute implementation details.
- Human attention is the scarce resource — optimize for it.
- Repository-local knowledge is the source of truth. Knowledge that lives only
  in a chat thread is knowledge you have already lost.
- Prefer small enforceable rules over long fragile instructions.

## Keep `AGENTS.md` small and navigable

`AGENTS.md` is a **map plus the non-negotiable rules**, not an encyclopedia.
Detail belongs in `docs/contributing/`. When behaviour changes, update the
closest source-of-truth doc in the same change.

## The continuous improvement loop

1. Define intent and acceptance criteria.
2. Implement.
3. Evaluate — `bun run check-types`, `bun run check`, `bun run test`.
4. Capture what was learned in docs, tests, or tooling.
5. Promote repeated guidance into mechanical enforcement.

## Promote learning into enforcement

When a mistake repeats, move it down this list:

1. **Docs** — clarify the expected pattern in `docs/contributing/`.
2. **Tests** — cover the failure mode. For anything tenancy-shaped this means a
   case in `tests/integration/tenancy.test.ts`: the useful assertion is always
   "the other tenant cannot see or touch it".
3. **Types** — make the wrong shape unrepresentable. `Scope` exists so a handler
   cannot invent an `orgId`; `AppPermission` exists so a typo is a compile
   error.
4. **Lint / structure** — a static rule where one is expressible.
5. **Scripts** — encode the workflow in a command.

Rule of thumb: if the same review comment is written twice, encode it.

## Working agreements

- Keep changes scoped; split large work into smaller steps.
- State the verification commands you ran.
- Update docs in the same change as the behaviour.
- Do not introduce a new pattern without documenting when to use it.
- Favour boring, composable code over opaque cleverness.

## Gardening cadence

Periodically: delete stale guidance, tighten unclear instructions, add
cross-links, and turn one recurring defect into one new mechanical guardrail.
Continuous small cleanups are cheaper than periodic rewrites.
