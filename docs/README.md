# HMS documentation

These pages are the repository's living sources of truth. Keep a fact in one
place and link to it elsewhere.

| Document                                | Owns                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| [Product](./product.md)                 | Scope, vocabulary, roadmap gates, and product invariants             |
| [OPD](./opd.md)                         | Shipped intake, queue, record, and care-setting billing behavior     |
| [Reports](./reports.md)                 | Billing worklists and day-close reports                              |
| [Architecture](./architecture.md)       | Runtime shape, tenancy, authorization, data, storage, and accounting |
| [Development](./development.md)         | Local setup, code style, tests, and contribution rules               |
| [Operations](./operations.md)           | Environment, deployment, backups, and release checks                 |
| [Design](./design.md)                   | UI tokens, density, layout, motion, and completion checklist         |
| [Decisions](./decisions.md)             | Current expensive-to-reverse choices and their reasons               |
| [Research ledger](./research/README.md) | Evidence summaries and unresolved validation questions               |

## Work lifecycle

This is the sole registry for unfinished documentation-backed work. Each linked
file owns its contract or evidence; lifecycle is recorded only here. **Active**
means implementation remains, **Blocked** means a named prerequisite prevents
progress, and **Verification** means implementation is complete but its exit
evidence is not. Product roadmap items remain evidence-gated—not active work—
until their trigger is met and they enter this registry.

| Work                                                                                        | Lifecycle    | Exit condition                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Treatment plans and advances](./opd.md#intake)                                             | Verification | After a pilot month: every open course is a plan, no Invoice precedes its posting, Follow-ups is in daily use, and three cases work without a pre-delivery Invoice (an RCT abandoned after two sittings; a ten-session course paid by three advances across several Invoices; an RCT with a crown added mid-course). The chartered accountant answers the two open questions in [OPD](./opd.md#intake) |
| [Custom OPD rates](./opd.md#catalog-and-charge-meaning)                                     | Verification | Finish desktop/mobile browser checks                                                                                                                                                                                                                                                                                                                                                                   |
| [Patient contacts and name casing](./product.md#patient-contacts)                           | Verification | Inspect thermal, Receipt, Credit Note, and refund layouts with retained sample documents                                                                                                                                                                                                                                                                                                               |
| [Invitation account onboarding](./research/invitation-account-onboarding.md)                | Blocked      | An email provider exists; then add mailbox verification per the memo and retire the id-as-proof rule in D006                                                                                                                                                                                                                                                                                           |
| [Payment methods, bank transfer, sponsors](./specs/payment-methods-cheques-and-sponsors.md) | Active       | After one month of pilot use the method-mix and sponsor-share counts are recorded and the payer-domain go/no-go is decided                                                                                                                                                                                                                                                                             |
| Public site owner decisions                                                                 | Blocked      | The owner supplies legal name, CIN, registered office, support and sales email, the WhatsApp Business number and who answers it, and decides on a lead form, training-crawler access, and a booking tool                                                                                                                                                                                               |
| [Production hardening](./operations.md#production-hardening)                                | Verification | Release-time evidence on the deployed host records digests, sizes, header checks, and a reviewed cleanup dry run                                                                                                                                                                                                                                                                                       |
| [Pilot readiness](./operations.md#pilot-readiness)                                          | Active       | A named owner records every operational, accounting, print, restore, and compliance gate complete                                                                                                                                                                                                                                                                                                      |
| [Invoice granularity (D025)](./decisions.md)                                                | Blocked      | Decided before the first non-OPD invoice exists; blocked on a second billing domain being gated open                                                                                                                                                                                                                                                                                                   |
| [Frontend pattern items](./research/frontend-patterns.md#remaining-work)                    | Active       | Batching is measured and landed or dropped; the remaining `useSearch` selector sites are measured or dropped                                                                                                                                                                                                                                                                                           |
| [Midday adoption performance exceptions](./research/data/perf-midday-adoption/README.md)    | Verification | A named owner accepts the three bound misses as ambient drift, or re-measures them within bounds                                                                                                                                                                                                                                                                                                       |
| [Blank data regions](./design.md#9-density-and-emptiness)                                   | Verification | Slow-4G cold-open and screen-reader checks confirm no collapsed region and no ambiguous silent navigation                                                                                                                                                                                                                                                                                              |

End-user help belongs in `apps/fumadocs`, not here. Code is authoritative for
exact APIs, schemas, permissions, and environment validation; these docs explain
the stable shape and why it exists.

## Documentation rules

- Write current behavior in present tense. Git is the changelog.
- Record an expensive-to-reverse choice in [decisions](./decisions.md); do not
  create a new file for it. A changed decision is rewritten or deleted in place,
  never kept beside its replacement.
- A spec is active only while it owns unfinished work. When complete, reduce it
  to durable behavior or fold it into product/architecture docs.
- Research is evidence, not authority. Promote accepted conclusions into the
  relevant living doc and reduce the research entry to a short ledger item.
- Update the closest source of truth in the same change as behavior. Delete
  stale text instead of adding a correction beside it.
- Prefer links to repeated rules. `AGENTS.md` stays a map plus hard invariants.
