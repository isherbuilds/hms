# HMS documentation

These pages are the repository's living sources of truth. Keep a fact in one
place and link to it elsewhere.

| Document                                                           | Owns                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Product](./product.md)                                            | Scope, vocabulary, roadmap gates, and product invariants             |
| [Architecture](./architecture.md)                                  | Runtime shape, tenancy, authorization, data, storage, and accounting |
| [Development](./development.md)                                    | Local setup, code style, tests, and contribution rules               |
| [Operations](./operations.md)                                      | Environment, deployment, backups, and release checks                 |
| [Design](./design.md)                                              | UI tokens, density, layout, motion, and completion checklist         |
| [Decisions](./decisions.md)                                        | Accepted and superseded architectural decisions                      |
| [OPD intake spec](./specs/opd.md)                                  | Catalog-led outpatient intake and additional services                |
| [OPD lifecycle spec](./specs/opd-desk-lifecycle.md)                | Desk lifecycle and the OPD day view                                  |
| [Loading placeholder spec](./specs/remove-loading-placeholders.md) | Active removal and verification work                                 |
| [Reports spec](./specs/reports.md)                                 | Remaining pre-pilot report and worklist work                         |
| [Research ledger](./research/README.md)                            | Evidence summaries and unresolved validation questions               |

End-user help belongs in `apps/fumadocs`, not here. Code is authoritative for
exact APIs, schemas, permissions, and environment validation; these docs explain
the stable shape and why it exists.

## Documentation rules

- Write current behavior in present tense. Git is the changelog.
- Record an expensive-to-reverse choice in [decisions](./decisions.md); do not
  create a new file for it.
- A spec is active only while it owns unfinished work. When complete, reduce it
  to durable behavior or fold it into product/architecture docs.
- Research is evidence, not authority. Promote accepted conclusions into the
  relevant living doc and reduce the research entry to a short ledger item.
- Update the closest source of truth in the same change as behavior. Delete
  stale text instead of adding a correction beside it.
- Prefer links to repeated rules. `AGENTS.md` stays a map plus hard invariants.
