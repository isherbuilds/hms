# Operations

## Environment

`packages/env` is the runtime source of truth and validates at import time.
Local development uses the single `packages/env/.env`, copied from the example.
Real process variables win over the file; no `.env` is copied into an image.

| Variable                                                  | Used by              | Requirement                                                                                |
| --------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                            | server + web SSR     | PostgreSQL URL; test harness accepts only a `_test` database                               |
| `BETTER_AUTH_SECRET`                                      | server + web SSR     | At least 32 characters; identical on both runtimes                                         |
| `BETTER_AUTH_URL`                                         | server + web SSR     | Public API/auth origin                                                                     |
| `BETTER_AUTH_COOKIE_DOMAIN`                               | split-host web + API | Shared parent domain so web SSR receives the API cookie                                    |
| `CORS_ORIGIN`                                             | server + web SSR     | Exact web origin; also invitation-link base                                                |
| `FOUNDING_EMAIL`                                          | server + web SSR     | Sole Organization-creation account                                                         |
| `NODE_ENV`                                                | both                 | `development`, `production`, or `test`                                                     |
| `VITE_SERVER_URL`                                         | web build            | Public API origin used by browser RPC                                                      |
| `VITE_WEB_URL`                                            | web build            | Public web origin, bare (no path); canonical, sitemap and OG URLs                          |
| `VITE_WHATSAPP_NUMBER`                                    | web build            | Optional founder-managed E.164 digits without `+`; absent/empty hides phone/WhatsApp links |
| `SEAWEEDFS_ENDPOINT`                                      | server + web SSR     | Publicly reachable S3 gateway for direct browser transfer                                  |
| `SEAWEEDFS_BUCKET`                                        | server + web SSR     | Private bucket name                                                                        |
| `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` | server + web SSR     | S3 credentials                                                                             |
| `SEAWEEDFS_MAX_UPLOAD_BYTES`                              | server + web SSR     | Optional positive integer; default 100 MiB                                                 |
| `SKIP_ENV_VALIDATION`                                     | build only           | Never set on a running application                                                         |

Add a variable to the narrowest Zod schema in `packages/env`, the example file,
and deployment configuration. Optional is valid only when the feature fails with
a clear named error or degrades cleanly.

The four core storage values—endpoint, bucket, access key, and secret—are
optional only as a complete group. Omitting all four leaves valid-sized upload
and read-URL operations unavailable with a named configuration error; metadata
listing still works. Supplying only part of the group produces the same error
when the storage client is first used. Upload-size validation runs before client
creation, so an oversized request may fail with the size error even when storage
is unconfigured; `SEAWEEDFS_MAX_UPLOAD_BYTES` controls that independent guard.
File deletion commits metadata before best-effort object cleanup, so missing
storage cannot roll that deletion back.

No secret or server module reaches browser assets. For a production build,
inspect `.output/public` for server imports and actual secret values; library
shims may contain variable names, so a name-only grep is insufficient.

## Deployment topology

Build two independent two-stage application images from the repository root,
plus PostgreSQL and SeaweedFS resources:

| Piece                     | Port             | Exposure                                                  |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| `apps/web` TanStack/Nitro | 3001             | public                                                    |
| `apps/server` Hono/oRPC   | 3000             | public; browser calls it directly                         |
| PostgreSQL                | provider-defined | private to web/server                                     |
| SeaweedFS S3 gateway      | provider-defined | public for signed browser PUT/GET; bucket remains private |

These are the container defaults, not the development ports. The web
Dockerfile sets `PORT=3001` for Nitro's Bun preset; a platform-provided `PORT`
may override it. The API exports its Hono app and lets Bun use `PORT` when supplied,
otherwise Bun listens on 3000. Its Dockerfile's `EXPOSE 3000` documents that
default but does not configure the listener.

The web image also serves the static staff guide at `/docs`, including page
links, images, and search. Its builder compiles `apps/fumadocs` before packaging
the web app. Nitro copies that output into `.output/public/docs`; there is no
separate production docs service or reverse proxy rule.
The guide keeps the default `noindex, nofollow` response header (D030).

The portless proxy is development tooling and never runs in production. It is a
dev dependency, it appears only in each app's `dev` script, and the named
`*.hms.localhost` hosts in [Development](./development.md#development-urls) have
no production counterpart.

There is no production Compose file. The local
`packages/db/docker-compose.dev.yaml` is development-only. Both app containers
receive the server environment because web SSR imports auth/database code. The
web build also receives `VITE_SERVER_URL`, `VITE_WEB_URL` and, optionally,
`VITE_WHATSAPP_NUMBER`. Public email is fixed at `support@edernal.com` (D062);
remove the obsolete `VITE_CONTACT_EMAIL` Coolify build argument.

Coolify deploys each app on a push to `main` through a GitHub push webhook,
filtered by per-app watch paths (`apps/<app>/**`, `packages/**`, and root
workspace files). Each image declares a `HEALTHCHECK` on `/`; Coolify keeps the
old container serving until the new one passes it, so a failed migration or
boot never replaces a running release.

Include `apps/fumadocs/**` in the web application's Coolify watch paths so guide
changes rebuild the bundled pages. After deployment, check `/docs`, a direct
guide URL such as `/docs/opd-desk`, screenshots, and search on the main domain.

The server container applies migrations before accepting traffic. A migration
failure exits startup; concurrent starters serialize through the advisory lock.
Rolling releases require migrations compatible with the previous application
until old instances drain. Use expand-and-contract for destructive production
changes.

A release whose migration the previous application cannot run beside (a changed
money unit, a writer that must advance a new revision) is a coordinated cutover:
pause financial writes, stop the old web and API instances, apply the migration,
deploy both applications together, then resume traffic. Do not add a
compatibility contract for a one-time transition (D031).

## Public site and contact ownership

[D062](./decisions.md#d062--public-search-access-founder-owned-contact-and-engineering-reviewed-legal-drafts)
closes the public-site operational decisions: `support@edernal.com` is the single
public inbox for demos, support, privacy grievances and security reports. The
founder—the actual `FOUNDING_EMAIL` account holder, not every Organization
owner—answers it, acknowledges messages within **48 hours** and resolves
grievances within **one month**. This is not a staffed emergency/clinical hotline;
the ordinary response window never postpones statutory incident reporting.
The founder must monitor optional phone/WhatsApp channels through that same
responsibility, without asking people to send Patient data.

In the Coolify **web build**, either omit/leave empty `VITE_WHATSAPP_NUMBER` or
set the actual operator-controlled number (E.164 digits, no `+`). An absent value
hides every WhatsApp/phone link while email CTAs remain usable; an invalid supplied
value is rejected by environment validation. The number is not a release-required
placeholder, and no demo number is deployable evidence. The production value and
delivery/monitoring of the real inbox cannot be verified from local development.

`/robots.txt` preserves D030 search/sitemap rules and opts out the named
training/dataset agents; PerplexityBot remains allowed because its vendor says
it does not collect for foundation-model training. Robots is a voluntary
public-content preference, not an access-control or retroactive deletion guarantee.

`/terms`, `/privacy` and `/security` are explicitly **engineering-reviewed drafts,
not legal advice**. The review fixes notice/rights, consent withdrawal and Consent
Manager limits, recipient/retention disclosures, grievance timing, future DPDP
phase labels, consumer-rights priority and CERT-In obligations. **Counsel's
publication approval remains the legal release gate**; it includes verifying the
actual operator identity/address and publishing the founder's actual
grievance-officer name/contact particulars. The repo's development
`FOUNDING_EMAIL` is not a verified public officer identity. Role-only wording is
not claimed to satisfy SPDI r5(9) or applicable e-commerce r4 disclosures.
No incorporation identity, independent audit, actual regulator registration,
mail delivery, production log-retention or backup configuration is invented by
this review; the existing production/data-safety gates still require evidence.

## Production hardening

Current behaviour, with the release evidence still to be recorded:

1. Organization roles are `owner`, `admin` (Administrator), `reception`,
   `cashier`, `accountant`, and `pharmacist`, each with explicit grants in
   `packages/auth/src/access.ts`; any other stored role authorizes nothing and
   fails closed. Walking
   the role map with the shift lead is a [pilot readiness](#pilot-readiness) gate.
2. Each public application host sets `nosniff`, referrer, and camera,
   microphone, geolocation, and payment denial headers itself. In production
   both set HSTS; the API CSP is `default-src 'none'` and denies all framing,
   while the web CSP is self-based, permits API and storage connections, and
   allows framing only by itself (the billing PDF is a web route framed
   same-origin).
3. The two-stage application images build in dedicated builder stages. Their
   runtime stages install production-only dependencies, run as the non-root
   `bun` user over root-owned, world-readable files, and contain only Bun, dependency manifests, installed dependencies,
   and application build output; the server image additionally contains the
   database and environment sources required to migrate before serving.
   Image digests, sizes, startup health, and migration behavior are recorded at
   release time.
4. The tenant-safe cleanup reports abandoned `pending` uploads and unreachable
   storage objects older than the requested age. Run
   `bun run cleanup-uploads --older-than-hours 24 [--delete]`; it defaults to a
   dry run, and `--delete` removes only the reported stale rows and orphaned
   objects.

This work closes when the release evidence records image digests, sizes,
startup health, header verification on both hosts, and a reviewed cleanup dry
run, and the production verification below passes against those images.

## Release verification

1. Record the commit and run typecheck, lint/format, tests, and production build.
2. Start both production images with production-like environment.
3. Verify API health, login, and a hard refresh of a signed-in org URL on the
   web host.
4. Inspect representative server-rendered HTML for render-failure markers and
   ensure client assets contain no secret values or database/storage code.
   For public-site changes, confirm the main client bundle contains no changelog
   article bodies. With a saved theme opposite to the OS theme, confirm only
   the displayed hero image downloads. Exercise changelog navigation and the
   Product menu by keyboard.
5. Exercise an org switch, Patient/OPD/Billing reads, one guarded mutation, and
   cross-tenant denial.
6. Upload and read a private file through presigned URLs.
7. Verify a real printer against the itemized bill and payment receipt before
   pilot cutover.

The server sets credentialed CORS only for `CORS_ORIGIN`; session cookies are
HTTP-only, secure, and SameSite Lax. Both application hosts set `nosniff`,
referrer, and permissions policies on every response and add HSTS in production.
The production API CSP is `default-src 'none'; frame-ancestors 'none'`; the web
CSP is self-based, permits its API and storage origins for connections, and
allows same-origin framing only, which the billing PDF viewer requires.

## Pilot readiness

Do not schedule the first live shift until one named pilot owner has recorded
all of these as complete:

1. The shipped [reports and worklists](./reports.md) have been
   exercised by the pilot cashier and shift lead on representative data, or a
   time-bounded manual handover procedure and owner covers any remaining gap.
2. Every pilot staff member has an invitation-created or operator-created
   account and the least privileged role needed for reception, billing,
   pharmacy, correction, reporting, or administration; the role map has been walked with the shift lead.
3. Organization, staff, catalog, tax, timezone, currency, and document-prefix
   configuration has been reviewed against representative real records. Confirm
   the displayed Organization currency before billing begins; it cannot be changed.
4. The pilot accountant has approved representative classifications and
   statutory fields, and a real A4 and 80 mm printer has produced representative
   Invoice, Receipt, Credit Note, and refund documents with the scripts used at
   the hospital.
5. Reception and cashier staff have rehearsed Now, Later, check-in, cancellation,
   no-show, partial/split collection, credit, refund, and end-of-shift handover.
6. A production-like backup and joint PostgreSQL/object-storage restore has been
   timed and verified as described below, with a named cutover and rollback owner.
7. Qualified advisers have recorded the state-specific clinical-establishment,
   GST, DPDP, retention, and other duties applicable to the pilot's live scope,
   including the owner and evidence for each required control.
8. Before incorporation is public, the home page carries the Companies
   (Incorporation) Rules r26 identity block: legal name, CIN, registered office,
   phone, email, and grievance contact. `/about` and `/privacy` state it is owed.
9. For the pharmacy: apply [D052](./decisions.md#d052--gst-registration-determines-document-particulars-and-bounded-numbering),
   not an undecided document label. The pilot operator records evidence of
   the actual organization GSTIN (or lawful unregistered status), legal name,
   address, state code and valid configured Form 20/21 drug licences;
   no CA or licensing-adviser consultation is an approval gate.
   On real A4 and 80 mm prints, confirm registered **Tax Invoice** versus neutral
   **Invoice** without GST claims, inclusive-MRP pricing with GST extracted from
   each discounted line, and the taxable value plus CGST/SGST amounts in the
   rate-wise footer for registered local sales. GST must not be added above MRP:
   [Legal Metrology retail-price definition](https://bombayhighcourt.gov.in/bhc/libweb/legislation/rulec/LegalMetrologyPackagedCommoditiesRules%2C2011.pdf),
   [Consumer Affairs MRP/GST FAQ](https://consumeraffairs.gov.in/public/upload/files/GST_FAQs_0_1733291540.pdf)
   and [CGST Rule 46](https://cbic-gst.gov.in/pdf/03042020-CGST-Rules-2017-Part-A-Rules.pdf).
   Validate purchase-tax eligibility and taxable/exempt-use allocation:
   recoverable eligible ITC is separate from inventory cost; nonrecoverable tax
   is cost under [AS 2 para 7](https://indasaccess.icai.org/Volume-III/AS/asb.html?a=105)
   and [CGST s17](https://cbic-gst.gov.in/pdf/CGST-Act-2017-amended-01012022.pdf).
   Exempt healthcare does not confer blanket ITC eligibility. Stock valuation
   and purchase-ledger implementation remain outside the current billing ledger.

Record evidence and exceptions with the release, not in a permanent parallel
checklist. Re-run only the affected gate after a configuration or workflow
change.

## Pharmacy stock procedures

Stock on hand is the sum of recorded movements (D041); it is never typed over.

### Physical count

Count the shelf batch by batch and post each difference through **Adjust** with
reason `count_correction`, naming the counted sheet in the note. Retain the
sheet as a file. Opening stock is different: it is posted once, as a goods
receipt with **opening stock** set, carrying the count date and the retained
sheet. A batch that already has a movement refuses an opening line, so a later
recount is always a `count_correction` adjustment.

### Downtime re-entry

Sales made on paper during an outage are entered afterwards at the desk, one
sale at a time, with the paper number in the note. Each entry moves its own
stock, so stock is never typed over to match the shelf; a remaining difference
is a counted `count_correction` with its sheet.

## Accounts and Organizations

Public sign-up is closed. Run `create-founder` once for `FOUNDING_EMAIL`; use
`create-user` only for accounts that are not invited. The founder creates an
Organization at `/create`; staff create their account and join from an
invitation link at `/join`.
Organization owners cannot create additional Organizations unless they are also
the configured founder.

No email is sent. The invitation link is the recipient's credential to create
the account for the invited email (D006), so admins must hand it to that person
directly and cancel it if it reaches anyone else. Treat the Members page link
like a temporary password. There is no self-service password reset yet.

## Backups and restore

Back up PostgreSQL and object storage together, off the host, with platform tools:

- **PostgreSQL:** a Coolify scheduled backup of the database resource every 15 minutes
  (`*/15 * * * *`) to a private, versioned S3 bucket in ap-south-1, with a 35-day
  retention.
- **Files:** `weed filer.backup` streams SeaweedFS changes to a private, versioned S3
  bucket in the same region.
- No backup credential reaches an application environment.

Before go-live, monthly, and after any data-rewriting migration:

1. Restore both into an isolated environment.
2. Point a scratch deployment at them.
3. Sign in, open an org and Patient/OPD record, download a private file, and
   run a billing/GST report.
4. Record the restore date, duration, and failures.

A hospital that asks for a full copy of its records, or ends service, gets them
from the operator: an export of its Organization's rows and original files from
a restored copy. There is no in-app export, exit or incident workflow (D057).
