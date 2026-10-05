# Spec: Data safety, backup, restore and free Organization export

Status: deferred 2026-10-04. The in-app implementation was removed; backups use
platform tools ([operations](../operations.md#backups-and-restore)) and the operator
handles exports, exit and incidents by hand. The retention policy below remains the reference.
Authority: Founder request to specify hospital-record trust controls, evaluated only against hospital desire and moat.
Supersedes: none

## Problem

A hosting location does not prove that Patient records, prescription files and the money trail are recoverable. A database dump cannot demonstrate joint recovery of an Invoice, Receipt, stock movements and private OPD attachment; an XLSX report is not a usable exit copy.

The repo requires joint off-host backups and a timed pilot restore, but supplies no automation or recorded rehearsal. PostgreSQL and SeaweedFS are separate resources; both runtimes access the database. Neither image includes backup scheduling/utilities. Actual production controls remain unverified ([operations](../operations.md#backups-and-restore), [topology](../operations.md#deployment-topology), [server image](../../apps/server/Dockerfile), [web image](../../apps/web/Dockerfile)).

Owners need a free independent copy, an exit-retention agreement and named incident responders—not assurances or data captivity.

## Solution

Provide four complete paths: automated, encrypted, off-host joint recovery generations; a timed isolated restore with retained evidence; an owner-triggered, free, full Organization export in open formats; and controlled exit/deletion plus a minimal incident/breach register.

The product surface is `/$orgSlug/settings/data-safety`: last completed backup, last successful restore test, export request/download, exit status and scoped incident summaries. Operators own scheduling, recovery, workers, deletion and incident recording through separate scripts/runbooks. Export requires no operator contact, paid module or subscription renewal. The UI exposes neither production restore nor credentials.

Accepted pilot objectives: **joint RPO ≤15 minutes and RTO ≤4 hours**, at all hours for a continuously staffed 10–50 bed pilot (D057). These are engineering risk limits, not statutory or measured promises. A daily 24-hour checkpoint can lose a whole staffed day's collections and is rejected as the sole recovery strategy.

## Validation / Evidence

### Hospital desire and moat

**Hospital desire: weak evidence of demand, explicit internal readiness requirement.** The [pilot report's objection table](../../../edernal/reports/Edernal%20Care%20pilot%20go%20to%20market.md#objection-handling) includes “Is the data safe?”, but labels the responses draft and untested. It is not an interviewed owner's statement. The [buyer research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/buyers_market_competitors.md) records hidden data-export fees from [Cufront](https://www.cufront.com/blog/hospital-management-software-pricing-india): **vendor claim**, not an independently verified complaint from this segment. The [sales research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/sales_script_motion.md) explicitly lacks specific buyer evidence on export lock-in. [Pilot gate 6](../operations.md#pilot-readiness) nevertheless requires a timed production-like joint restore before the first live shift; gate 7 requires qualified advice on retention and other duties.

Supplied targeting facts: 162 tricity prospects, 42 tier-A, 39 of 42 on insurer/government cashless lists; most are IPD hospitals and two advertise an HIS. These identify discovery subjects, not feature demand or priority over IPD/claims.

**Moat contribution: low and indirect.** The [moat thesis](../../../edernal/reports/Edernal%20Care%20moat.md#switching-costs-are-real-but-hospitals-do-switch) emphasizes the trusted revenue system of record, not blocked exports. Recovery evidence and usable exit copies are reference-ability preconditions that may reduce vendor risk and preserve money-trail confidence. This is an inference, not measured retention evidence; competitors can replicate it. It creates no exclusive data or claims-learning advantage.

**Baseline:** no implemented automation or measured RPO/RTO found in this repo; no full Organization-export path; no recorded customer trust baseline. Inventory production controls and measure record count, database bytes, file count/bytes and recovery duration. **Targets:** off-host joint recovery coverage remains within 15 minutes or alerts both custodians; restore the measured workload within four hours; verify 100% of ready-file references; deliver the free owner export within 24 hours with exact source totals and no foreign rows. Final exit delivery remains within seven days. These are accepted acceptance criteria, not observed results.

**Validation status:** no customer interviews have happened. Lost-work tolerance, recovery design, export grant and statutory duties are decided below, not awaiting consultation. Actual host access, credentials, workload measurement and a successful timed joint restore remain operational prerequisites. Discovery about past losses, export usability and willingness to buy remains market evidence; it cannot be manufactured by a decision and does not block implementation of the trust controls.

**Regulatory basis:** [DPDP Act 2023, ss.8(5)–(7), 16](https://egazette.gov.in/WriteReadData/2023/248045.pdf), [notified Rules 2025, rr.1, 6–8](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), [commencement notification](https://egazette.gov.in/WriteReadData/2025/267647.pdf) and [December corrigendum](https://egazette.gov.in/WriteReadData/2025/268455.pdf) distinguish enacted safeguards from their phased commencement. Apply the controls now; the substantive 18-month phase is planned from **13 May 2027** (conservative operational date). The corrigendum does not change rr.6–8. [CERT-In's 28 April 2022 directions, ii–iv](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf) already require covered cyber incidents within six hours and Indian-jurisdiction ICT logs for 180 days. This specification is not compliance certification or approval of public legal pages.

## User Stories / Scenarios

1. As an Owner, I want dated backup and restore-test facts, so that I can distinguish a usable recovery copy from a scheduled job.
2. As the recovery operator, I want to recover PostgreSQL and private objects onto an empty isolated target, so that losing the production host does not lose hospital records.
3. As an Owner, I want to request and download all my Organization's records and files without a fee, so that another system or accountant can use them.
4. As an exiting Owner, I want written delivery, retention and deletion dates, so that service termination does not erase required records or preserve patient data indefinitely.
5. As the responsible operator and hospital contact, I want an incident timeline and notification evidence, so that a breach is acted upon without waiting for a dashboard or ordinary audit write.

## Implementation Decisions

### Ownership and authorization

Respect [D001–D005](../decisions.md): explicit `orgSlug`, verified `scope.orgId`, Organization predicates, dependency-free permissions, fire-and-forget operational audit and private objects. Add `dataSafety:read` and `dataSafety:export` only in `packages/auth/src/access.ts`, explicitly granted to Owner only; do not inherit Administrator or financial-report grants. Union roles still apply. New routers use `orgProcedure`; every new domain row, including job/evidence/incident rows, has `orgId NOT NULL`. Global backup manifests live in operator-owned off-host storage, not a tenantless application table.

Use a deep `dataSafety` router rather than expanding the existing report-export router. The latter deliberately exports report read models ([existing export](../../packages/api/src/routers/export.ts)); a full export reads source records. RPC contracts are `dataSafety.status({ orgSlug })`, `dataSafety.requestExport({ orgSlug, confirmSensitive: true })`, `dataSafety.getExport({ orgSlug, exportId })`, and `dataSafety.downloadExport({ orgSlug, exportId })`. Status returns nullable backup/restore timestamps, coverage point, derived freshness, export and exit summaries, and scoped incident summaries. Missing/foreign ids return `NOT_FOUND`; role denials remain centralized. Download rechecks current membership and expiry before signing.

Add `data_safety_evidence`, `organization_exports`, `organization_exits`, `data_incidents` and append-only `data_incident_events` schemas. Export states are `queued → running → ready | failed → expired`; a unique partial Organization index permits only one queued/running job. The request returns the existing active job on duplicate clicks. Persist timestamps, actor, capture point, format version, manifest digest, counts, private artifact key, expiry and sanitized failure category, never a signed URL. Conditional transitions follow D026; migrations remain generated/append-only under D022.

### Joint recovery generations: operator tooling

Use **pgBackRest**, not WAL-G, in a separate pinned operator runner: its [official guide](https://pgbackrest.org/user-guide.html) supplies full backups, continuous WAL archiving, encryption and PITR. [Operations](../operations.md#backups-and-restore) currently specifies neither installed backup tool nor scheduler; this is a new accepted deployment contract, not a claim about the live host. Use host **systemd timers/services**, independent of replaceable Coolify app containers, for daily full backup, five-minute joint-coverage verification and monthly restore drills; PostgreSQL `archive_command` continuously archives WAL, with `archive_timeout=300s`. Coolify remains the app deployment manager, not the backup scheduler. Never discard WAL to keep a queue small.

Destination: a private versioned **AWS S3 bucket in ap-south-1 (Mumbai)** in a separate backup AWS account, outside the production host failure domain, with **Object Lock COMPLIANCE** and a 36-day default lock. [AWS identifies Mumbai as India](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html); [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) protects versions even from root deletion, but permits new versions/delete markers, so sealed manifests pin version ids and hashes, never only current keys. DPDP s.16 is a power to restrict foreign transfers, **not universal localisation**; choosing India is a conservative contract that also supports CERT-In's explicit Indian-log requirement. Disable cross-region replication outside India.

Replace daily quiescence as the routine strategy with **online physical backups + WAL + immutable off-host object coverage**. Before a file becomes `ready`, retain its exact verified bytes off-host; all finalize/overwrite/delete/cleanup paths must obey that contract, including outstanding signed PUTs. A periodic copier of mutable current keys alone is insufficient. Every five minutes seal a joint manifest at a PostgreSQL recovery target whose WAL is confirmed off-host and whose ready objects all have recoverable version ids, size and SHA-256. Pending uploads are metadata only. Missing bytes or archive gaps stop advancement and alert; restore only to the latest proven joint point, never to newer database-only WAL. A snapshot/checkpoint can assist a migration or rehearsal, but cannot substitute for the 15-minute joint RPO.

Take a full backup daily and preserve **35 days of joint recovery points**, plus every base/WAL/object dependency needed by those points. Lock/extend referenced versions through the last point's expiry; disable automatic pgBackRest expiration and use a dependency-aware prune after locks expire and a newer verified point exists. Do not delete the last known-good set. Restore materializes the exact sealed repository metadata/object versions, avoiding attacker-written latest versions/delete markers. Record actual residual expiry (including up to one extra day for a daily base and any declared hold), rather than promising every byte disappears on day 35. The 35-day disaster-recovery window is not the financial/clinical statutory archive.

Key custodians are the **Founder (primary recovery authority)** and **Designated Operations Operator (alternate)**, two distinct people recorded with off-app phone/email contacts before go-live. Use pgBackRest repository encryption with a random passphrase; seal its recovery package and object/manifest archives to both custodians' independent [age recipients](https://github.com/FiloSottile/age#usage). Keep private age identities off the production host in each custodian's separately controlled encrypted vault/offline copy; the runner holds only the pgBackRest operating secret and public recipients, never recovery private keys. Neither custodian may destroy old keys until all dependent archives expire; rehearse alternate-only key recovery monthly. Separate source-read, backup-write and recovery/prune credentials; app runtimes receive none.

Use **healthchecks.io** as the independent [dead-man switch](https://healthchecks.io/docs/): a five-minute joint-coverage check with five-minute grace sends success only after verifying off-host coverage age ≤10 minutes, and sends failure immediately on capture/archive errors. Missing pings or freshness breaches alert both custodians by external email and SMS, without HMS/Coolify notification dependence. Send only opaque check identity/success/failure—no Patient data, manifests or logs. Daily-full and monthly-restore checks have separate deadlines. No scheduled checkpoint billing interruption is accepted; an Organization export upload/delete fence is capped at 15 minutes, then fails/unfences safely without a ready artifact. Infrastructure provisioning (bucket/account, IAM credentials, runner/host access, age keys, monitoring contacts and gateway controls) is an **operator action outside this repository**, not accomplished by this decision.

`bun scripts/backup-records.ts --capture` produces `RecoveryGeneration` (generation id, capture/completion times, Organization coverage, artifact hashes and versions); `bun scripts/restore-records.ts --generation <id> --target <isolated-config>` consumes it. Scripts default to planning; restoring to production is prohibited by target identity checks. Evidence is sealed off-host before scoped `data_safety_evidence` summaries are published. A failed status publication cannot erase valid recovery evidence or turn a failed capture green.

Rehearse before go-live, monthly, and after data-rewriting migrations. Recover onto empty PostgreSQL and an empty private object bucket with the recorded release, preventing its automatic D007 startup migrator from changing the recovery point unexpectedly. Block external notifications, production credentials and public access. From declaration to verified scratch service, record elapsed time, bytes, failures, recovery point, performer and independent witness. Sign in, open an Organization and Patient/OPD record, retrieve a private attachment, run billing/GST reports, reconcile balanced journals, Advances/Payments/Credits and batch/bucket stock, and verify document counters will issue the next number without gaps or reuse. Test a foreign Organization denial. A checksum-only exercise is not a successful rehearsal. Real cutover and rollback require a named owner and an explicit destructive-action confirmation.

### Full Organization export: product request, separate worker

A dedicated operator worker polls `organization_exports`, claims by conditional update and rechecks that the requesting Member still holds the export grant. This is durable work because whole-hospital records and files exceed a synchronous HTTP response, not a general-purpose job framework. A dead worker marks abandoned running work failed after a configured timeout; there is no hidden automatic retry. The owner can request another run.

Capture all source rows under one PostgreSQL repeatable-read snapshot. Before the snapshot, the worker applies a storage-write fence only to this Organization's prefix and drains in-flight writes; it keeps key-share locks on ready-file metadata until copying completes, so scoped deletion cannot remove those objects. Cleanup and exit deletion obey the same fence. Other Organizations and this Organization's ordinary billing can continue. Files attached or finalized after the capture point are excluded consistently. A conflicting deletion, missing object or copy failure fails the export; it never publishes an incomplete archive. The UI states that this Organization's uploads/deletions pause during capture. The deployed gateway must support the prefix fence; its exact configuration is a ready gate.

Deliver a private ZIP containing UTF-8 RFC 4180 CSV per source table, canonical JSON records preserving exact values, `manifest.json`, `files-manifest.csv`, original ready-file bytes and a data dictionary. JSON is the lossless authority; CSV uses documented reversible escaping for spreadsheet-formula prefixes. Preserve ids, relationships, status, MRNs, document numbers, Business Dates, timezone, currency, decimal-string integer paise and counted stock units. Do not recalculate immutable documents using today's masters.

Include Patients and contacts, OPD Appointments, Treatments/Sittings, Charges, Invoices/lines, Payments and Receipt facts, Advance Receipts/Allocations, Credit Notes/lines, Refunds, journal accounts/entries/lines, Products, batches, stock movements, goods receipts/lines, pharmacy sales/returns/lines, files/attachments, Services, Departments, Practitioners, Payers, Sponsor links, Organization settings, counters, audit and safety-domain records. Member export contains only Organization role and minimal attribution identity; exclude passwords, accounts, sessions, invitation credentials, auth tokens and unrelated memberships. Pending files appear as metadata with no promised bytes. Original files are included, not just expiring links. Receipts are represented by their immutable Payment source facts; there is no invented Receipt table.

Manifest lists included/excluded tables, columns/types, row counts, file paths/size/hash, foreign-key linkage and capture point. Schema coverage tests must classify every Organization-owned table; shipping another domain requires updating export coverage. If implemented, include `Admission`/`admissions`, `wards`, `beds`, the `ipd` Invoice stream, `admission` Charges and Admission-linked Advance Receipts. Include `Claim`/`claims` and distinct per-Payer receivables without inventing Payment methods (D029). Unshipped domains are not fabricated. Reconciliation reads these sources; reports never become write models.

Store the archive outside the normal `file` list in a private export namespace. Sign GET for 15 minutes under D005; bytes go directly from storage, not through either app. Artifacts expire after seven days; downloading does not extend retention. UI shows capture/expiry, counts and ₹0, and warns that possession of the archive exposes sensitive records. `export.requested`, completion/failure and signed-download issuance use ordinary `audit()` without recording URLs or clinical text. Job rows provide durable lifecycle evidence; a issued URL does not prove the owner downloaded it.

### Exit, retention and incidents

Keep Better Auth's existing `disableOrganizationDeletion: true`. Operator exit begins only on authenticated Owner instruction, with an immediate execution confirmation. `organization_exits` records instruction, final export acknowledgement, scope-specific retention schedule, holds, next review/deletion dates and completion digest. Freeze business writes at agreed termination through the verified procedure guard and Better Auth Organization mutation hooks; permit scoped owner export/status reads. Shared User accounts and other memberships survive. Slugs are not reused.

The Founder owns the following retention matrix; the operator applies it without a CA/counsel approval dependency. **Financial source documents, journals and linked evidence:** at least [CGST s.36's 72 months from the annual-return due date](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html), or one year after final disposal of relevant proceedings/investigation, whichever is later. Medical-profession prescribed books/case registers also follow [Income-tax Act 1961 s.44AA and Rule 6F(5)](https://www.incometaxindia.gov.in/w/rule-6f): six years from the end of the relevant assessment year, extended for reopened assessment. This is **Income-tax**, not Information Technology Act s.44AA; apply the longer applicable requirement, including successor-law obligations rather than assuming a blanket six years for every record. **Clinical records:** retain for active care, then a conservative seven years after last care for this pilot; a recorded longer state/licence/medico-legal/minor-record obligation or hold overrides it. Seven years is a product policy, not a claim that Indian clinical retention is uniform.

**Security/processing evidence:** retain Indian-jurisdiction ICT logs at least 180 days under CERT-In; choose one year from processing for covered security/processing records and necessary personal/traffic data to meet DPDP rr.6(1)(e), 8(3) when effective. Use restricted per-Organization retained source/evidence archives, not one year of every mixed-tenant backup. **Exports:** artifact links/bytes expire after seven days; required source records remain retained independently. **Exit:** final export within seven days; delete non-required primary data within 30 days of acknowledged delivery, but never before an applicable one-year processing minimum, clinical/financial period or hold expires. Record the precise basis, clock, next review and deletion date per category. No indefinite “pending legal review” fallback. Revoke access, purge every scoped source/export version through dry-run-first tooling and retain a minimal external deletion receipt; never cascade shared Users.

Mixed-Organization disaster backups expire by the dependency-aware recovery schedule above; disclose the actual last residual-copy date. Move only required held tenant records to its restricted archive instead of preserving all tenants indefinitely. Maintain an off-host erasure register and apply it before any restored environment serves traffic; a hold changes the category's recorded deadline, never silently disables all erasure. Audit the exit transition under D004; durable exit evidence remains separate from best-effort audit.

Operators record scoped incidents and append-only events with detected/aware timestamps, responsible roles, classification, affected categories/counts, containment, evidence references, notification rationale, actual channels/times/receipts, deadlines/extensions and closure. Corrections never overwrite awareness. Keep multi-Organization summaries separate; never place Patient names, raw dumps or secrets in summaries. Retain restricted incident evidence for at least one year and longer for a specific recorded investigation/hold.

**Notification ownership:** the Designated Operations Operator is the processor incident lead and registered CERT-In point of contact; the Founder is alternate and ensures delivery if that operator is unavailable. Inform the hospital's designated privacy/shift lead immediately; the hospital, as Data Fiduciary, remains responsible for affected-Patient and Board intimation under DPDP **s.8(6)**, with operator assistance. CERT-In Annexure-I incidents are reported **within six hours of noticing/being informed**, with available facts rather than waiting for full root cause. Under DPDP r.7 when effective, notify affected Data Principals and the Board **without delay**, then detailed Board information within **72 hours of awareness**, recording any written extension. Exercise that escalation protocol now as policy without falsely labelling future DPDP reporting deadlines already effective. External phone/email and off-host evidence remain available during HMS outage; the product does not automate delivery.

## Test Seams

- Operator capture/restore commands against isolated real PostgreSQL and private S3 storage: WAL-gap rejection, joint-point integrity, immutable version recovery, corruption rejection, key recovery, measured RPO/RTO and erasure-register application. Prove direct signed PUTs cannot invalidate an already sealed ready-object version on the deployed gateway.
- Guarded `dataSafety` router with `clientFor`: owner request/download/status, union roles, foreign ids and membership revocation. Reuse [tenancy tests](../../tests/integration/tenancy.test.ts), `eventually` and `drainAuditWrites()` for D004.
- Worker-produced ZIP: lossless source values, complete schema inventory, relationships, exact ledger/stock reconciliation, file hashes and no credentials/foreign rows. Existing [file tests](../../tests/integration/files.test.ts) own direct signed-transfer prior art.
- Verification pending: `tests/integration/organization-export.test.ts` needs a gateway-backed run. Its immutable-file/fence/export cases skip with a reason unless `STORAGE_SAFETY_ENABLED=true` and the private gateway control URL/token and signed-transfer endpoint are explicitly supplied; inventory and Owner permission checks still run without gateway infrastructure.
- Exit and incident command contracts: dry run versus execution, legal hold, isolated Organization purge, timestamp-preserving events and deadline evidence. Product browser checks cover stale/never/failed status, export expiry and desktop/mobile accessibility; no invented compliance badge.

## Task Plan

2026-10-04 implementation evidence: schemas/migrations, Owner grants/router/UI,
operator recovery/export/exit/incident commands and owner/runbook documentation
landed. `bun run check-types` passed; desktop Owner never-recorded states were
observed in light/dark with React Scan blocked. An isolated source workload was
prepared, but no joint capture/restore or ZIP/deletion/tabletop proof completed:
MinIO registry pulls were denied, binary download returned HTTP 410 and source
download timed out. The orchestrator requested immediate wrap-up before further
checks. All four acceptance checkboxes intentionally remain open; the spec is
not reduced to a completed record. See Operations for exercised versus pending
evidence and explicit external provisioning.

2026-10-04 focused private-database verification: the four integration files
`data-safety`, `organization-export`, `organization-exit` and `data-incidents`
ran against disposable `hms_safety_verify_test` on the isolated source PostgreSQL
container (port 55461), with the repository preload, concurrency 1 and 30-second
test timeout: **8 passed, 2 gateway-backed export cases skipped, 0 failed;
131 assertions; 41.79 seconds**. The isolated exit proof was invoked explicitly
as `bun test ./tests/isolated/organization-exit.isolated.ts` and failed before
fixture mutation because `HMS_EXIT_FIXTURE_CONFIG` is absent. Its real versioned
Object Lock store, gateway, two custodian keys and distinct empty clone remain
required; this is an infrastructure prerequisite, not a proved deletion result.
No application-code failure was observed in the configured integration cases.
The private test database and the disposable store created during this attempt
were removed. The owner narrowed this rerun to item 3 only; joint restore,
tamper/WAL-gap, UI matrix and tabletop evidence were not completed in this rerun.

- [ ] Slice 1: Joint off-host recovery and timed proof — riskiest
  - Acceptance: schema and Owner read grant expose only sealed, scoped evidence; daily full backups, continuous WAL and five-minute joint manifests reject missing ready objects/archive gaps, survive latest-version tampering and restore the measured workload within ≤15-minute joint RPO/≤4-hour RTO. A failed rehearsal never advances the successful-test timestamp. UI shows never/stale/failed explicitly; audit, isolated tests and recovery runbook land together.
  - Verify: `bun run check-types`; `bun run test` under the repository's isolated `_test` policy; `bunx oxlint`; `bunx oxfmt --check docs/operations.md docs/architecture.md`; `bun run build`. Execute the new capture/restore commands against disposable resources and record timed signed-file, report, counter and foreign-tenant checks. These commands are planned, not run by this spec.
  - Depends on: none for repository implementation; production credentials/host access, gateway mutation controls and measured workload are provisioning/rehearsal prerequisites.
  - Owns/Touches: `scripts/backup-records.ts`, `scripts/restore-records.ts`, new operator runner deployment files, `packages/db/src/schema/data-safety-evidence.ts`, generated migrations, `packages/api/src/routers/data-safety.ts`, `packages/env/src/server.ts`, environment example, `apps/web/src/routes/$orgSlug/settings/data-safety.tsx`, safety tests, `docs/operations.md`, `docs/architecture.md`. Coordinator owns shared schema/router indexes, `packages/auth/src/access.ts`, navigation and lockfile/manifests throughout.
  - Interfaces: produces `RecoveryGeneration` and scoped `RecoveryEvidence` consumed by `dataSafety.status({ orgSlug })`; sealed evidence includes capture/completion/restore dates, result and digest, never credentials. Publishes the capture/fence/abort contract for later operator work.

- [ ] Slice 2: Owner-triggered complete free export
  - Acceptance: export schema/grant, guarded request/status/download, dedicated worker and UI deliver every classified Organization source plus original ready files at one stated capture point, at ₹0. Foreign ids, revoked Members, missing files, interruption and expired artifacts cannot yield a downloadable success. Source money/stock reconcile; sensitive actions are audited; owner instructions and schema coverage tests land.
  - Verify: `bun run check-types`; `bun run test` with isolated database/storage; `bunx oxlint`; `bun run build`; `bun run --cwd apps/fumadocs build`. Request through the UI, replay an outstanding upload URL during the prefix fence, independently open the ZIP, compare source totals and hashes, then exercise foreign-Organization and expiry failures.
  - Depends on: Slice 1; gateway prefix-fence proof and pilot workload.
  - Owns/Touches: `packages/db/src/schema/organization-exports.ts`, generated migrations, `packages/api/src/routers/data-safety.ts`, export worker/library under `packages/api/src/lib/`, `scripts/export-organization.ts`, storage transfer support in `packages/storage/src/`, upload cleanup fencing, data-safety route, `tests/integration/tenancy.test.ts`, export tests, `docs/operations.md`, `apps/fumadocs/content/docs/administration-and-handover.mdx`; shared files remain coordinator-owned.
  - Interfaces: produces `OrganizationExport` and format-v1 manifest; consumes verified scope and prefix-fence contract. Implements `requestExport`, `getExport`, `downloadExport`; expiration is based on ready timestamp plus seven days.

- [ ] Slice 3: Controlled exit and non-resurrection
  - Acceptance: approved schedule/holds and acknowledged final export are required before confirmed deletion. Schema, guarded read-only exit status, owner-visible exceptions, operator commands, audit and tests prove primary/object deletion, no effect on another Organization/shared User, and old-backup erasure before service resumes. Generic Organization deletion stays disabled; no universal retention assertion ships.
  - Verify: `bun run check-types`; `bun run test`; `bunx oxlint`; `bun run build`; `bun run --cwd apps/fumadocs build`. Run dry run then confirmed deletion only in an isolated fixture; restore a pre-exit generation and demonstrate erasure-register application before login/traffic.
  - Depends on: Slices 1 and 2; implement the accepted category-specific retention/hold matrix above.
  - Owns/Touches: `packages/db/src/schema/organization-exits.ts`, generated migrations, procedure guard, Better Auth Organization hooks, `scripts/exit-organization.ts`, restore script, data-safety router/route, exit tests, `docs/operations.md`, staff-guide administration page; shared files coordinator-owned.
  - Interfaces: consumes final `OrganizationExport` digest and acknowledgement; produces `OrganizationExit` with stage, hold/review/deletion/residual-backup dates and minimal external deletion receipt. Restore consumes the external erasure register before exposure.

- [ ] Slice 4: Minimal incident and breach evidence
  - Acceptance: scoped incident/event schemas, Owner-only summaries and operator commands preserve awareness, six-hour CERT-In reporting and DPDP without-delay/72-hour deadlines with effective-phase labels. Corrections append; foreign summaries/PII never leak. D004 remains unchanged; off-host evidence, tabletop and named contact runbook complete the slice.
  - Verify: `bun run check-types`; `bun run test`; `bunx oxlint`; `bun run build`; `bun run --cwd apps/fumadocs build`. Conduct an outage/breach tabletop with the named hospital/operator contacts and record times, notification evidence, deadline/extension display and retrieval while the app is unavailable.
  - Depends on: Slice 1; actual operator and hospital contact details are recorded before live use.
  - Owns/Touches: `packages/db/src/schema/data-incidents.ts`, generated migrations, `scripts/record-incident.ts`, data-safety router/route, incident tests, `docs/operations.md`, staff-guide administration page; shared files coordinator-owned.
  - Interfaces: `recordIncident({ orgId, awarenessAt, classification, responsibleContact, summary })` returns scoped incident id; `appendIncidentEvent({ orgId, incidentId, eventType, occurredAt, evidenceRef })` preserves chronology. `dataSafety.status` returns only that Organization's safe summary and unresolved action dates.

## Out of Scope

IPD/claims implementation, import tooling, offline operation, marketing, public security assertions, certification, automated patient-rights workflows, and a hospital-operated production restore. Existing report exports are not replaced. Backups and exports never mutate financial or clinical source facts.

## Explicitly Deferred

Active-active failover, a general job platform, automatic breach notification delivery, SIEM integration and bulk PDF re-rendering. Continuous WAL/PITR is required by D057, not deferred. Structured immutable document facts plus original files meet the open-format exit contract; replica availability is not backup evidence.

## Open Questions

- Production AWS bucket/account/IAM credentials, systemd runner access, custodian identities/keys, external alert contacts and enforced storage mutation controls are not provisioned by repository edits. The operator must supply these and the measured production workload before deployment/restore acceptance.
- A real isolated joint restore and a recipient opening the lossless export remain evidence gates, not permission questions. Owner-only full export is accepted; usability must be demonstrated, not asserted.

D057 resolves the former architecture, retention and responsibility questions autonomously. D004 remains best-effort audit; durable job/exit/incident records do not amend it. Repository implementation is present; production provisioning and the remaining acceptance evidence are not complete.
