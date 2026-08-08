# Decision records

Short architecture decision records (ADRs) for choices that shape this base,
including decisions **not** to build something. Check here before proposing a
change that may already have been decided.

Decision records are point-in-time documents by design; everything else in
`docs/` describes current behaviour (see
[documentation principles](../documentation.md)).

## Adding a record

1. Copy [`0000-template.md`](./0000-template.md) to the next number with a short
   kebab-case slug.
2. Keep it to roughly half a page: context, decision, consequences.
3. When a later record changes a decision, mark the old one `superseded by NNNN`
   rather than editing or deleting it.
4. Add it to the list below.

## Records

- [0001 — The organization is a per-request claim, not session state](./0001-org-as-request-claim.md)
- [0002 — No fallback tenant scope](./0002-no-fallback-scope.md)
- [0003 — Org-scoped pages are client-rendered](./0003-client-rendered-org-pages.md)
- [0004 — Permissions live in one dependency-free module](./0004-permissions-in-one-module.md)
- [0005 — Audit is fire-and-forget by default](./0005-fire-and-forget-audit.md)
- [0006 — Stored objects are always private](./0006-private-object-storage.md)
- [0007 — Sign-up is invite-only with a first-account bootstrap](./0007-invite-only-signup.md) (superseded by 0013)
- [0008 — Tenant isolation is enforced in application code, not row-level security](./0008-app-level-isolation.md)
- [0009 — Resolve membership in the permission factory](./0009-membership-in-request-context.md)
- [0010 — Organization ID is procedure input](./0010-org-id-in-procedure-input.md)
- [0011 — The organization slug is the request claim](./0011-org-slug-as-request-claim.md)
- [0012 — Migrations run before the server](./0012-migrations-run-before-the-server.md)
- [0013 — Sign-up is disabled; accounts are created by an operator](./0013-signup-disabled.md)
- [0014 — The first organization is created by the founding email](./0014-founding-email-bootstrap.md)
- [0015 — Procedures are declared through orgProcedure only](./0015-org-procedure-only.md)
- [0016 — Organization settings are TTL-cached in-process for derived reads](./0016-settings-ttl-cache.md)
- [0017 — Keep AI streaming as a narrow HTTP exception](./0017-ai-streaming-http-surface.md)
- [0018 — Allocate display MRNs with an organization-scoped counter](./0018-org-scoped-mrn-counter.md)
- [0019 — Client input is a claim: references and prices are server-verified](./0019-server-verified-references-and-prices.md)
- [0020 — Post double-entry journals inside billing transactions](./0020-double-entry-posting-in-billing-transactions.md)
