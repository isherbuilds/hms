# Spec: Semi-assisted Organization onboarding and import

Status: accepted specification; blocked on a real authorized hospital export (D059)
Authority: Founder request: compare hospital desire and moat; scoped onboarding-import assignment.
Supersedes: none

## Problem

A new Organization needs usable Services, Products, opening stock, Patients and clinical staff before reception can start. Re-keying these records consumes operator time; ambiguous medicine names, strip quantities and patient identities can make a quick migration unsafe. Staff turnover makes an undocumented, founder-dependent setup hard to repeat.

The operator must preview changes, resolve exceptions and repeat interrupted imports without duplicating Patients or stock. Import must not recreate historic financial documents.

## Solution

Provide an operator-only onboarding workspace at `/$orgSlug/settings/onboarding`. Publish downloadable, versioned CSV and XLSX templates for Services, pharmacy Products, opening stock, Patients, departments and practitioners. An operator obtains hospital-authorized data, converts it into these templates, previews server-validated rows, resolves duplicates and explicitly commits selected valid rows. Staff continue using the existing domain screens; this is not a general integration platform.

One Organization onboarding run records setup, reviewed imports and first-live-shift sign-off. Every preview reports create, link, already imported, blocked and excluded counts. Corrected files retain source keys so reruns are safe. Opening quantities become dated opening goods receipts and movements, never an editable balance. Patients receive fresh Organization-counter MRNs. A timed runbook carries the hospital from Organization creation to a single live shift with named sign-off owners.

## Validation / Evidence

### Hospital desire and moat

**Desire strength: weak.** [Buyer research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/buyers_market_competitors.md) records staff turnover and training-load concerns, but the specific small-hospital evidence is vendor-written. [Cliniqwise](https://cliniqwise.com/hms-for-small-and-mid-sized-hospitals-india) says frequent receptionist turnover makes long training impractical; its implementation-failure percentage is unsupported and is not a baseline. [Migration-objection research](../../../edernal/research_notes/Edernal%20Care%20pilot%20go%20to%20market/sales_script_motion.md#2-common-objections-when-switching-hms-and-effective-responses) identifies integrity, resistance and training concerns. Cliniqwise's [demo offer](https://cliniqwise.com/clinic-emr-software-demo) advertises legacy import, unlimited training and one-to-two-week go-live: competitor claims, not demonstrated outcomes. The [migration case study](https://link.springer.com/article/10.1007/s44250-025-00186-x) concerns a Saudi educational hospital, not Indian 10–50 bed buyers.

[Cufront](https://www.cufront.com/blog/hospital-management-software-pricing-india) alleges hidden data-export fees. This is a competitor/vendor claim, not a verified customer complaint about a named incumbent. Discovery must establish whether an actual prospect can obtain an export, its fields and quoted fee; this feature cannot bypass incumbent access restrictions.

The [GTM report](../../../edernal/reports/Edernal%20Care%20pilot%20go%20to%20market.md) proposes migration checks, training and a staged shift; these are untested plans. The target list has 162 tricity prospects, 42 tier-A, with 39 of those 42 on insurer/government cashless lists. Most are IPD hospitals; only two advertise an existing HIS. These facts establish neither migration volume nor demand for an OPD/pharmacy-only cutover. Discovery distinguishes new setup, module replacement and full hospital replacement.

**Moat contribution: medium, conditional.** Following the [moat thesis](../../../edernal/reports/Edernal%20Care%20moat.md), lower switching-in cost supports adoption of a trusted revenue system of record; imports are not themselves a revenue-control or claims-learning moat. Repeatable training, reconciled opening movements and reviewed medicine aliases can reduce the next installation's work. Templates are copyable; the compounding asset would be verified mapping quality and non-founder delivery. It must not depend on export obstruction.

The [medicine-source memo](../research/medicine-name-sources.md) observes transcription errors in four shelf names and incomplete niche coverage; third-party commercial reuse rights remain unestablished. [Item-master research](../research/pharmacy-item-master.md) is explicitly historical: current D027/D049 contracts, not its superseded no-loose-sale references, govern this import.

**Metric:** time-to-live is elapsed time from Organization creation to the first real shift being opened after sign-off. Baseline is unknown: measure the next manual assisted setup, recording elapsed hours, operator hands-on minutes and data/precondition waiting separately. Proposed target for the next three comparable core-only hospitals: each live within four business days, at most eight operator hours for setup/import/training, and no unexplained batch-count discrepancy. Comparison workload is up to 200 Services, 1,000 Products, 5,000 Patients, 20 departments, 50 practitioners and 1,000 opening batch rows. Report individual results before claiming a median improvement. Mapping reuse measures operator-confirmed matches versus reviewed medicine rows and correction minutes per 100 rows; baseline is the first hospital, target a 25% reduction in correction minutes by the third comparable hospital without incorrect matches.

**Validation status:** no customer interviews or authorized unrelated-hospital export exists. D059 decides new MRNs, searchable legacy identifiers, read-only old finances, bounded template limits, the operator-role contract and decision amendments below without consultation. The four-day/eight-hour targets remain falsifiable targets, not observed performance. A real unrelated hospital must still authorize its sample export/count sheets, supply the six dataset approvers and approve the actual rehearsal/cutover scope; no autonomous product decision can grant another hospital's data access. This core-only spec does not promise IPD/claims replacement.

## User Stories / Scenarios

1. As an onboarding operator, I want downloadable templates and a complete preview, so malformed rows cannot silently enter an Organization.
2. As a pharmacist, I want batch quantities reconciled to a dated physical count, so the first sale starts from traceable stock.
3. As a receptionist, I want demographics without accidental identity merges, so relatives sharing a phone remain distinct Patients.
4. As an operator, I want corrected and interrupted reruns to preserve record links, so a lost response cannot repeat stock or consume another MRN.
5. As the hospital shift lead, I want repeatable training and signed cutover evidence, so new staff and a non-founder operator can run the first shift.

## Implementation Decisions

### Ownership, authorization and decisions

Use `packages/api/src/routers/onboarding.ts`, registered in the existing router index; add schemas under `packages/db/src/schema/` with generated append-only migrations (D022). Shared validators and transaction-capable domain commands remain with catalog, patient, staff and pharmacy ownership; extract only where the normal and import callers genuinely share behavior. Do not call an independently committing RPC from an import transaction.

D001–D003 apply to every run, preview row and mapping: `orgId NOT NULL`, tenant-leading indexes/composite references, `orgProcedure` and verified scope. Add `onboarding: ["manage"]` only in `packages/auth/src/access.ts`, granted solely to reserved `onboarding_operator`. Give that role only the additional `member:read` needed by the Organization shell; preview supplies scoped candidate details. Do not give it billing or ordinary pharmacy-write grants. A trusted deployment operator provisions/revokes this role for an existing User and named Organization through a narrowly scoped script; Organization creation remains founder-only (D006).

Keep the reserved role out of ordinary assignable `ORG_ROLES`. Reject attempts to assign it through `member.*` and all directly mounted Better Auth member/invitation paths, including comma-joined role unions and invitation acceptance. Guard protected-membership role changes server-side, not merely in the picker. An admin cannot grant themselves import access. Revocation applies on the next request; imported rows retain actor attribution.

The **reserved-role contract is accepted**, conditional on implementing every server-side anti-escalation path above before exposing the workspace. [Current access.ts](../../packages/auth/src/access.ts) has six ordinary roles and no `onboarding_operator`/`onboarding:manage`; this is a future permission contract, not a currently available grant. Only a trusted deployment operator acting on recorded hospital authorization provisions a time-bounded named-Organization membership; revoke at handover or on expiry. Union roles do not make the reserved role ordinarily assignable. Reject ordinary attempts to create/change/invite/delete a protected operator membership, including Better Auth direct routes and invitation acceptance; retain a founder/operator recovery script for revocation. Existing founder-only Organization creation, `orgProcedure`, explicit Organization predicates and dependency-free grants remain unchanged (D001–D003/D006).

**D039 and D046 scoped amendments are accepted conditionally under D059.** Onboarding/opening receipts use only durable Organization/entity/source-namespace/source-key replay identity, with server-validated digests and atomic source links/effects. Ordinary money/stock commands remain unchanged. Hospital-authorized, operator-confirmed template data may supply GST, schedule and printed MRP after source evidence/domain validation; external medicine suggestions still never supply these fields. No generic request-key system or automated third-party catalog ingestion is authorized.

D039's single accepted exception list contains onboarding source rows/opening receipts and [outage paper slips](./outage-continuity.md). Each retains its own explicit source identity, locks and validation; neither allows automatic financial retry or expands ordinary desk commands.

D045/D049 forbid restoring a goods-receipt attachment column. Operations still says retain the count sheet: retain it with the hospital's cutover evidence, named in the receipt note, without making an attachment a receiving prerequisite. Update that owner wording during implementation rather than silently contradicting the decisions.

### File and preview contract

Publish six paired templates through guarded `onboarding.template`, generated from one versioned column definition. Include blank data sheets and separate instructions/enumerations; illustrative rows are not importable data. Stable `sourceKey` is mandatory and import-only: it is not a resurrected Service or practitioner code (D048). `sourceNamespace` identifies one hospital-authorized source dataset across corrected files.

Parse CSV/XLSX locally in a bounded browser worker; source files never traverse RPC or go to medicine vendors. Support UTF-8 CSV, quoted fields and one selected XLSX data sheet. Reject macros, formulas, merged data cells, duplicate/unknown headers and locale-ambiguous dates. Dates/money/phones/identifiers are template text; preserve leading zeros. Use ISO dates, expiry `YYYY-MM`, explicit booleans and enum values. Reject fractional paise, scientific notation and inferred dates; convert decimal rupees to `bigint` paise server-side (D031). Do not derive `unitsPerPack` from descriptive `pack` text.

Draft limits: 5 MiB source, 25 MiB expanded XLSX, 10,000 rows/file, 200 rows/chunk and 256 KiB serialized chunk. Enforce server row/session/chunk limits independently of browser checks; operator splits larger exports using unchanged keys. Preserve file/sheet/physical-row coordinates. No background worker queue is needed: bounded stage/preview/commit calls return progress and can resume after refresh.

The server owns normalization, schema validation, duplicate lookup and canonical payload digests. Browser file hashes are descriptive, not replay authority. Errors contain sourceKey, row number, field, stable error code and corrective instruction. Preview has no domain writes or counter allocation. Error downloads are CSV with spreadsheet-formula-leading values escaped. Patient details never enter ordinary logs or audit metadata.

### Durable reruns and confirmation

`onboarding_runs` owns one run per Organization, creation timestamp, state (`preparing | live`), approver and first-live-shift timestamp. `onboarding_imports` stores entity type, namespace, template version, digest, actor and reviewed revision. `onboarding_import_rows` stores staged normalized payload, coordinates, errors and explicit resolution. `onboarding_source_links` has unique `(orgId, entityType, sourceNamespace, sourceKey)`, confirmed payload digest and exact target/reference. Typed nullable target columns plus shape checks/composite foreign keys cover each entity, including batch and goods receipt for opening stock; no unverified polymorphic target id.

Unchanged linked rows return their original result with no write, even if the target was later legitimately edited. Changed payload under a committed key is blocked: ordinary domain correction, not import overwrite, owns that change. Correct an uncommitted row by restaging; never invent a new key to bypass a posted opening row. A reordered CSV or repeated commit cannot change results. Excluded rows remain visible and are not marked successful.

All commit calls require the reviewed import revision, explicit selected source keys and immediate confirmation of counts. Lock the onboarding run first, then import/source records in key order, then domain rows in D040 order; document these new lock types in architecture. Revalidate scope, candidates, references and source digests in the transaction. Any stale selection rolls back its whole chunk and returns `CONFLICT` for re-preview, without automatic retry. Domain writes and source links commit together. An opening chunk creates one receipt for previously uncommitted selected rows; replayed rows return their prior receipts and are not included again. Concurrent different imports share the run lock and source-link uniqueness.

After live sign-off, new commits are refused; historical results remain readable to operators and replay returns prior results only. Purge active staged personal payloads/error artifacts after 30 days; retain minimal source keys/digests/domain links and confirmed legacy identifiers, not a second operational patient database. Where D057's one-year processing-data/log minimum applies, move only the required evidence into its restricted retention archive until the recorded deadline instead of claiming a 30-day erasure of all copies.

### Entity contracts and identity rules

- **Services:** name, category, decimal `unitPrice`, `customRate`, explicit GST percentage, optional HSN/SAC `taxCode`, active. Reuse `SERVICE_CATEGORIES`; pharmacy is rejected. Prices are per one Service unit and may intentionally be zero. A same normalized name/category candidate requires explicit link or exclusion; different prices are a conflict, never an update.
- **Products:** name, stockUnit, unitsPerPack, expires, schedule, sold, active; optional genericName, manufacturer, form, strength, descriptive pack; explicit GST percentage for sold Products and optional HSN taxCode. Preserve current case/whitespace normalization. Internal supplies use the existing zero-tax/null-code rule. Match candidates using normalized name plus manufacturer, unit and pack count, but require operator confirmation; approximate names only warn. Strength/form/manufacturer disagreements block automatic linking. `stockUnit`/`unitsPerPack` freeze after the first batch (D049). No hollow pharmacy `catalog_items` row (D027).
- **Opening stock:** product sourceKey, batchNumber, expiry month or explicit absence for non-expiring Products, integer quantity in smallest units, printed decimal MRP and `pricedPer` (`pack | unit`); count date is import-level `receivedOn`. Require count date no later than the Organization-local current date. Reject expired shelf stock at commit, contradictory expiry/MRP and repeated product/batch rows; do not silently sum suspected duplicates. Exact price ratios and month-end expiry follow existing `resolveBatches`. Reuse the opening branch of `receiveGoods`: no supplier/cost/billTotal, reason `opening`, bucket `shelf`, sourceType `goods_receipt`. Any pre-existing movement on a batch blocks a new opening row. Later discrepancies use `count_correction`, not another import or typed balance (D041/D042).
- **Patients:** name, phone, explicit sex, dateOfBirth, dobEstimated, optional address/email and supported guardian/emergency contact fields. Require DOB; age conversion requires an explicit as-of date and estimated flag. Never fabricate phone/DOB. Exclude clinical history, blood group, allergies, Sponsor, ABHA/Aadhaar/UID and balances. **Always allocate a fresh Organization MRN** via D010's counter inside the Patient/source-link transaction; never adopt the old counter or legacy MRN as new MRN/UID. Retain optional legacy MRN verbatim (including leading zeros) on the confirmed patient source link as a **searchable typed legacy identifier with sourceNamespace**, alongside target Patient id. Extend ordinary scoped `patient:read` search to those confirmed links and show “Legacy MRN · source” in candidate results; no import grant is needed to locate an imported Patient later. Enforce uniqueness of `(orgId, sourceNamespace, legacyMrn)` when supplied; ambiguous/reused source identifiers are blocked for explicit correction/exclusion, never an auto-merge. Source-key mapping becomes authoritative only after confirmation. Exact normalized name/phone/DOB/sex only identifies candidates; shared phone alone never links. Conflicting DOB/identical rows require explicit link, exclusion or confirmed distinct-person creation with reason; never overwrite existing demographics. Recheck candidates after the MRN lock to see concurrent normal registration.
- **Departments/practitioners:** department name and optional default fee Service sourceKey; practitioner name, department sourceKey, optional registrationNumber and consultation/follow-up fee Service sourceKeys/validity days. Resolve only committed tenant-scoped source links. Department exact-name collisions and practitioner name/department or registration-number candidates require review. No imported User, Member or login linkage; an admin links a Practitioner to a verified Member later through the existing screen. Import Services before departments, departments before practitioners and Products before opening stock.

**Identity precedent and boundary:** [OpenMRS `PatientIdentifier`](https://docs.openmrs.org/doc-1.8/org/openmrs/PatientIdentifier.html) supports multiple identifiers distinguished by identifier type and location; [Bahmni uses OpenMRS ID Gen](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2850849/Patient+Identifier) for its generated identifier. Adopt the separation of fresh primary identity and retained legacy lookup, not an unneeded national-identity or generic identifier-management platform. A new MRN avoids counter/prefix collisions; legacy lookup preserves findability without treating historic identifiers as proof of personhood.

**Old finances:** historic Invoices, Receipts/Payments, Credits, advances and receivables stay **read-only in the old HMS or a hospital-controlled lossless archive** with its source document numbers and D057 retention clocks. Import none into HMS billing/journals/counters and create no balancing fake Invoice/Payment/opening Advance. At cutover, reconcile unresolved legacy obligations and name their separately controlled legacy-accounting owner; current HMS billing begins only for new in-scope activity. This is not an opening-balance migration or a claim that the new billing ledger represents the old hospital's entire accounts. If legacy liabilities/receivables cannot be operated safely without such migration, the real hospital's full-finance cutover is blocked, not silently narrowed. Keep source records because [CGST s.36](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html) measures retention from the original annual-return obligation, not the migration date.

Reviewed hospital-owned medicine aliases remain Organization-scoped import mappings. Operators may curate approved non-patient alias/unit/manufacturer corrections into a versioned reusable template mapping file only with the contributing hospital's authorization. No tenant identifiers, prices, quantities, GST, schedule, patient rows or unlicensed third-party suggestions enter that file. Reusable mappings suggest; they never auto-link or define a cross-hospital Product identity. Capture provenance/version and manual confirmation, making future correction-time comparisons possible without global tenant tables.

Mapping reuse is decided: **tenant-local only by default**. Each cross-hospital reusable release requires explicit written permission covering the non-patient aliases/unit/manufacturer facts, recorded provenance and Founder approval of the sanitized release. Hospital permission is not a licence for third-party medicine-database content; reject any unlicensed external provenance. Without those actual permissions no release leaves its Organization, and onboarding can still proceed with local mappings.

### Timed onboarding runbook

The implementation adds this procedure to operations/staff guidance. Durations are proposed active-work allocations, not promises; record actual start/end and blocked time in the run.

1. **Day 0, 30 minutes — founder/operator:** create Organization through `/create`; confirm immutable slug/currency, timezone, MRN/document prefixes and contact/tax/pharmacy licence configuration. Name hospital champion, pharmacist, reception lead, accountant and rollback owner; provision the reserved operator membership.
2. **Day 0, 90 minutes — operator + hospital champion:** authorize exports, inventory the six datasets, assign stable source keys, obtain templates and agree exclusions. Confirm no historic Invoices, Payments, Credit, Advance Receipts or receivables will migrate. Test old-HMS read access and printer/network access.
3. **Days 1–2, 120 minutes — operator + domain leads:** import Services, Products and staff; preview Patients and resolve identity exceptions. Spot-check ten Patients, ten Services and twenty medicine packs against source records. Record all excluded rows and approvers; do not call unresolved rows migrated.
4. **Day 2, 90 minutes — pharmacist + operator:** pause shelf movements at the agreed count boundary, perform/approve the batch count, import opening receipts in chunks and compare every batch quantity/MRP/expiry to the count. Resume only after discrepancies are explained; ordinary stock corrections remain separate. Retain the named count sheet with hospital evidence.
5. **Day 3, 120 minutes — shift lead + staff:** invite least-privileged Members, link Practitioners where needed and rehearse registration, walk-in billing, split Payment, Receipt printing, pharmacy sale/return and handover in a separate rehearsal Organization, not fabricated live financial documents. Rehearse the next receptionist's training from the same guide.
6. **Day 4, 30 minutes — champion + operator:** confirm applicable [pilot-readiness gates](../operations.md#pilot-readiness), restore/rollback evidence and recorded source/count reconciliations. Confirm searchable legacy identifiers and old-HMS/archive read access, with a named owner for unresolved legacy accounts. Make the old HMS read-only for the cutover scope; never dual-enter that scope or claim migrated finances. Mark live immediately before the first real shift opens, recording time, actual hospital approver and scope. Revoke operator membership at handover; subsequent corrections use normal authorized workflows.

A failed pre-live gate postpones launch and keeps the old workflow authoritative. Import rollback is not bulk deletion: correct masters through existing screens; correct posted stock with authorized movement procedures. After real financial documents exist, never reset counters/delete history or reverse the live cutover without the named owner reconciling those records.

## Test Seams

Use pure parser/normalizer fixtures for CSV/XLSX parity, leading zeros and rejected formulas/ambiguous values. Integration tests cross `clientFor` and guarded onboarding RPC, with real PostgreSQL, source links and existing stock/Patient reads. Prior art is `tests/integration/pharmacy-stock.test.ts`, `patients.test.ts`, and tenancy `GUARDED_CALLS`; audit assertions use `eventually`/`drainAuditWrites`.

Public interfaces: `onboarding.template({orgSlug, entityType, format})`; `start({orgSlug})`; `stage({orgSlug, runId, entityType, sourceNamespace, templateVersion, rows, expectedRevision})`; `preview({orgSlug, importId, cursor})`; `resolve({orgSlug, importId, sourceKey, resolution, expectedRevision})`; `commit({orgSlug, importId, sourceKeys, expectedRevision, confirmedCounts})`; `markLive({orgSlug, runId, expectedRevision, approval})`; `purgeStaging({orgSlug, runId})`. All require `onboarding:manage`; stage chunks cannot bypass preview. Preview returns revision, classifications, candidates/errors and totals; commit returns per-key existing/new typed results and receipt/MRN references. D059 accepts the contracts; sample-export and anti-escalation proof remain delivery prerequisites.

## Task Plan

- [ ] Slice 1: Replay-safe opening receipt proof (riskiest)
  - Acceptance: operator stages/count-previews/commits opening stock for existing Products; lost-response rerun returns the same receipt and unchanged movement sums; a touched/expired/conflicting batch rejects the entire selected chunk. Scoped permissions, reserved-role anti-escalation, audit and run/source schemas ship together.
  - Verify: `bun run check-types`; `bun run test`; `bun run build --filter=web`; exercise the guarded UI with a counted loose-tablet fixture and unauthorized Member.
  - Depends on: none; existing Product data is the representative proof input.
  - Owns/Touches: coordinator-owned `packages/auth/src/{access,index}.ts`, router/schema indexes, migrations, architecture/decisions/operations; new onboarding router/schema/route, `scripts/` operator provisioning, shared receipt command, tenancy/onboarding tests.
  - Interfaces: publishes stage/preview/resolve/commit and typed source links; consumes existing opening-receipt transaction and batch locks. Audit `onboarding.commit` records actor, import id, digest/counts and receipt ids after commit, never patient payloads.
- [ ] Slice 2: Services, Products and published templates
  - Acceptance: both downloadable formats produce equivalent previews; explicit money/tax/unit validation and confirmed duplicate links work; changed committed keys never overwrite; approved medicine mappings remain suggestion-only with provenance.
  - Verify: `bun run check-types`; `bun run test`; `bun run build --filter=web`; download all templates and round-trip them through the UI.
  - Depends on: Slice 1.
  - Owns/Touches: onboarding router/route, catalog/pharmacy shared commands and validators, template/mapping assets, parser tests, import integration tests, relevant operations/staff guidance; shared files coordinator-owned.
  - Interfaces: adds `services`/`products` entity types to the same stage/preview/commit contract; emits tenant-scoped source links consumed by stock and staff.
- [ ] Slice 3: Patient identity-safe demographics
  - Acceptance: shared-family phones never auto-merge; explicit distinct-person resolution is recorded; fresh MRNs coexist with scoped searchable legacy identifiers and leading zeros; replay allocates no MRN; clinical/financial/UID columns are rejected; concurrent registration is rechecked; staging purge obeys D057 and retains only required provenance.
  - Verify: `bun run check-types`; `bun run test`; exercise candidate resolution/error-download/purge in the UI with synthetic Patients.
  - Depends on: Slice 1 and Slice 2's parser/templates.
  - Owns/Touches: patient shared registration command/validation, onboarding router/route and Patient template, `tests/integration/patients.test.ts`, onboarding/tenancy tests, operations/staff guidance; shared files coordinator-owned.
  - Interfaces: adds `patients`; normal MRN counter and demographic validators return `{patientId, mrn}`; confirmed legacy identifier/sourceNamespace is searchable through `patient:read`, never adopted as the primary MRN/UID.
- [ ] Slice 4: Departments and practitioners
  - Acceptance: fee/department keys resolve only within the Organization; missing/ambiguous references are row errors; duplicate staff require confirmation; no login is provisioned or linked by import; replays create no staff duplicate.
  - Verify: `bun run check-types`; `bun run test`; rehearse Services → departments → practitioners and tenant-foreign references through the UI.
  - Depends on: Slice 2.
  - Owns/Touches: staff shared commands/validation, onboarding router/route, staff templates, onboarding/tenancy integration tests, operations/staff guidance; shared files coordinator-owned.
  - Interfaces: adds `departments`/`practitioners`, consumes Service/department source links and returns exact created/linked staff ids.
- [ ] Slice 5: Timed first-live-shift handover
  - Acceptance: one complete runbook rehearsal covers all six datasets, exclusions and batch reconciliation; markLive records time-to-live once, rejects further new commits and cannot bypass readiness sign-off; role revocation blocks the next call. Record actual elapsed/active/waiting time, not an asserted four-day success.
  - Verify: `bun run check-types`; `bun run test`; `bun run build --filter=web`; `bun run --cwd apps/fumadocs build`; `bunx oxfmt --check docs/specs/onboarding-import.md`; conduct named champion/pharmacist/operator rehearsal and inspect signed evidence.
  - Depends on: Slices 1–4.
  - Owns/Touches: onboarding run/route/API and workflow tests, `docs/operations.md`, `docs/product.md` import boundary wording if needed, `apps/fumadocs/content/docs/`; shared files coordinator-owned.
  - Interfaces: consumes all import summaries; publishes markLive approval/timestamp, run elapsed/active/waiting durations and restricted post-live replay/read behavior.

Verify commands are implementation instructions from [development](../development.md); none were run while drafting. Database-wiping test execution has one integration owner.

## Out of Scope

Historic Invoices/Charges/Payments, old MRN counter adoption, opening receivables/advances, clinical records, live Admissions/Claims, wards/beds, supplier balances, automatic stock adjustments, ongoing synchronization, dual entry, unlicensed medicine catalog harvesting and automated backup systems. Future IPD remains `Admission`/`admissions` at `/$orgSlug/ipd`, Charge source `admission`, `ipd` invoice stream and linked existing Advance Receipt; future `Claim`/`claims` links Admission/Payer with D029's distinct Payer receivable, never a fake Payment method. No import creates these records. Reports read source records only.

## Explicitly Deferred

Arbitrary legacy-column mapping, imports exceeding the bounded template workload without splitting, automatic identity merge, automatic stock reversal, self-service hospital-admin bulk access, third-party medicine-source commercial licensing and a cross-hospital canonical medicine database. Staff retain the existing manual create/correction paths; none of these omissions blocks the defined assisted cutover.

## Open Questions

- **External data gate:** which unrelated hospital supplies a written authorized sample export/count sheets, actual six dataset approvers and representative workload? No such hospital is evidenced; repository access/demo data cannot substitute for its consent.
- A real timed rehearsal must record sizes, missing DOB/phone, loose units, staffing and actual elapsed/active time against the accepted limits/targets. If the hospital requires live IPD/claims or opening-finance migration, this core-only cutover cannot satisfy it; the relevant separate scope gates remain.
- Cross-hospital mapping release is blocked unless actual hospital permission and any third-party reuse licence exist. Tenant-local mappings need no external release and remain the accepted default.

D059 resolves D039/D046 approval, reserved-role authorization, fresh MRN/searchable legacy identity, read-only legacy finance and mapping-release policy. No code is implemented by this decision change; no customer authorization or successful pilot is asserted.
