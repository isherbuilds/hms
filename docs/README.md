# HMS documentation

These pages are the repository's living sources of truth. Keep a fact in one
place and link to it elsewhere.

| Document                                | Owns                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| [Product](./product.md)                 | Scope, vocabulary, roadmap gates, and product invariants             |
| [OPD](./opd.md)                         | Shipped intake, queue, record, and care-setting billing behavior     |
| [Architecture](./architecture.md)       | Runtime shape, tenancy, authorization, data, storage, and accounting |
| [Development](./development.md)         | Local setup, code style, tests, and contribution rules               |
| [Operations](./operations.md)           | Environment, deployment, backups, and release checks                 |
| [Design](./design.md)                   | UI tokens, density, layout, motion, and completion checklist         |
| [Decisions](./decisions.md)             | Accepted and superseded architectural decisions                      |
| [Research ledger](./research/README.md) | Evidence summaries and unresolved validation questions               |

## Work lifecycle

This is the sole registry for unfinished documentation-backed work. Each linked
file owns its contract or evidence; lifecycle is recorded only here. **Active**
means implementation remains, **Blocked** means a named prerequisite prevents
progress, and **Verification** means implementation is complete but its exit
evidence is not. Product roadmap items remain evidence-gated—not active work—
until their trigger is met and they enter this registry.

| Work                                                                                        | Lifecycle    | Exit condition                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [Patient contacts and name casing](./product.md#patient-contacts)                           | Verification | Resolve the existing test import of `@hms/storage`, rerun the full type/test gates, and finish the print checks below      |
| [Invitation account onboarding](./research/invitation-account-onboarding.md)                | Blocked      | An email provider exists; then add mailbox verification per the memo and retire the id-as-proof rule in D006               |
| [Payment methods, bank transfer, sponsors](./specs/payment-methods-cheques-and-sponsors.md) | Active       | After one month of pilot use the method-mix and sponsor-share counts are recorded and the payer-domain go/no-go is decided |
| [Production hardening](./operations.md#production-hardening)                                | Verification | Release-time evidence on the deployed host records digests, sizes, header checks, and a reviewed cleanup dry run           |
| [Pilot readiness](./operations.md#pilot-readiness)                                          | Active       | A named owner records every operational, accounting, print, restore, and compliance gate complete                          |
| [Invoice granularity (D025)](./decisions.md)                                                | Blocked      | Decided before the first non-OPD invoice exists; blocked on a second billing domain being gated open                       |
| [Frontend pattern items](./research/frontend-patterns.md#remaining-work)                    | Active       | Batching is measured and landed or dropped; the six remaining `useSearch` selector sites are measured or dropped           |
| [Midday adoption performance exceptions](./research/data/perf-midday-adoption/README.md)    | Verification | A named owner accepts the three bound misses as ambient drift, or re-measures them within bounds                           |
| [Blank data regions](./design.md#9-density-and-emptiness)                                   | Verification | Slow-4G cold-open and screen-reader checks confirm no collapsed region and no ambiguous silent navigation                  |

End-user help belongs in `apps/fumadocs`, not here. Code is authoritative for
exact APIs, schemas, permissions, and environment validation; these docs explain
the stable shape and why it exists.

### Patient contacts and name casing — verification, 2026-09-10

- Fixed the advisor's OPD caller/practitioner casing gaps. The browser also
  exposed uncased patient header and Details text; both now use name spans.
  The practitioner select owns its casing. Removed two unused relation-type
  re-exports from API schemas (zero callers); no tests were removed.
- Optional form sections use native disclosures with no effect or open-state
  tracking. Browser checks proved that closing a section retains its input and
  that invalid submission reopens only the affected section.
- Relation mobile is optional and persists through the existing patient API.
  The copy button fills visible emergency fields and validates the result, so
  copying after an invalid submission clears stale errors. Browser checks
  proved copying, correction, independent guardian edits, and save/reopen.
  Invalid submission opens Contacts and leaves the other disclosures closed.
  Inspected the current form at 1440 × 900 and 390 × 844 in both themes, plus
  500 × 844. The browser bridge was restored after a mobile-emulation failure.
  Synthetic contact-review patients remain in the local Mercy General org;
  this pass added `Casing Review Test` (MRN `000005`) and one zero-charge walk-in.
  The patient record and OPD screen show `W/o` correctly. Computed styles confirm
  that the OPD screen and slip transform only the guardian name.
- `bunx oxlint`, formatting checks, the web type check, and the production web
  build passed. After migration regeneration, 81 patient, billing, and tenancy
  integration tests passed. The public help build passed. The full suite
  passed 252 tests but could not load `tests/integration/files.test.ts` because
  the root workspace cannot resolve `@hms/storage`; the full type gate fails on
  that same unchanged import. Next: repair that workspace dependency, then run
  both full gates, including the isolated resilience test skipped by the failure.
- The earlier browser and invoice-PDF runtime blockers are cleared: local apps
  run, the authenticated compiled Bun server returned an A4 invoice PDF with
  HTTP 200, and its rendered page was inspected. A separate rendered fixture
  proved lowercase patient/guardian text is cased and readable. The existing PDF
  unit tests passed. Next: inspect thermal, receipt, credit-note, and refund
  layouts with retained sample documents before closing print verification.
- Money columns moved from `numeric(12,2)` rupees to `bigint` paise (2026-09-11).
  History is append-only, so `0002_money_bigint_paise` is hand-authored with
  `USING round(col * 100)` and the CLI-generated `0003` re-states the types to
  bring the snapshot in step. Release is a stop-the-world cutover, not a rolling
  deploy (D031): stop all pre-0002 servers, migrate, start bigint-aware code. Type check, Oxlint, format and the suite match the
  pre-change baseline (253 pass; the `@hms/storage` load error is pre-existing).
- Money now crosses the RPC boundary as `bigint` (2026-09-11): router outputs
  return paise unformatted, inputs are `z.bigint()`, and the client parses typed
  rupees once at the form boundary. Components compare against an imported
  `ZERO` because the oxc React Compiler rewrites bigint literals to `undefined`.
  Verified: all workspaces type-check, Oxlint and format are clean, 79 unit and
  254 integration tests pass (the `@hms/storage` load error remains), an
  in-process oRPC round trip carries bigint both ways, and seroval round-trips
  bigint for SSR hydration. Next: reset the local development database (its
  money columns are still `numeric` and its journal predates the squash, so
  `db:migrate` skips the baseline), then exercise settlement, record payment,
  and the billing worklist in the browser.
- Production cutover 2026-09-11: see D032. The pilot database was converted by
  hand and its journal reset to the single baseline row; both applications were
  redeployed on the bigint code.
- The uncommitted migrations were replaced with CLI-generated
  `0001_patient_contacts`, based on the committed `0000` snapshot. It adds the
  contact columns and invoice relation snapshot; it does not rewrite existing
  names. The retained local development database still records the superseded
  migrations. Next: reconcile that local migration history before running
  `db:migrate` there; do not apply the replacement over its existing columns.
  Production, which has only `0000`, uses the new migration normally.
- No new tenant boundary or permission was introduced. The changed patient
  writes and invoice snapshot read retain their org predicates. Existing tenancy
  assertions remain intact and passed in the full run.
- The unstaged-change review fixed inherited relation casing in patient and OPD
  headings, the OPD caller fallback, and both invoice layouts. The restored
  dependency-free relation helper returns a complete pair or null. Invoice
  snapshots remain strings; only their name portion receives the print transform.
  Four PDF unit tests pass, including a regression proving both layouts preserve
  `W/o` while casing the name. Rendered A4 and thermal fixtures were inspected.
  All 81 focused patient, billing, and tenancy tests pass, as do package type
  checks, lint, formatting, and the web and help builds. The full type gate still
  fails on the existing root test import of `@hms/storage`; the full test suite
  was not repeated in this pass. No staged changes or tests were removed.

- The final review fix opens Personal details for UID conflicts in registration
  and editing. RHF mutates its error object, so the field error renderer and
  patient error count bypass compiler memoization. Browser checks with controlled
  409 responses passed for editing at 390px in light mode and registration at
  1280px in dark mode; both showed the inline UID error and error count. Invalid
  email validation still opens the section. No patient data was written in this
  check. Web/UI type checks, targeted lint/format checks, and the web build pass.
  The accepted cosmetic casing remains unchanged.

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
