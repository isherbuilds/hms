# Documentation principles

This repository maintains two audiences:

- **`apps/fumadocs`** — people using the product. Progressive disclosure: short
  pages linked from an index.
- **`docs/contributing/`** — people and agents developing this repository.

## Principles

**Describe how things work.** Write in the present tense. Avoid changelog-style
phrasing ("now we…", "we no longer…", "previously…") — that belongs in commit
messages. Write "every query carries the tenant predicate", not "queries now
carry the tenant predicate".

**Exceptions.** Migration and rotation runbooks may use ordered steps across
deploy phases, and [decision records](./decisions/index.md) are point-in-time
documents by design.

**Stay lightweight but valuable.** Prefer small accurate pages over large stale
ones. **Garden** docs when behaviour changes: update or delete the section in
the same change as the code. Remove duplication by linking, not copying.

**Comments carry the "why", docs carry the shape.** This codebase leans on
substantial comments at the decision points —
`packages/api/src/lib/procedures/factory.ts`, `packages/storage/src/index.ts`,
`apps/web/src/lib/orpc.ts`. A doc that restates what a
well-commented file already says will drift out of sync with it. Docs should say
what the pieces are and how they fit; the file says why it is the way it is.

**Product copy follows the same rule.** User-visible strings and error messages
should not read like release notes.
