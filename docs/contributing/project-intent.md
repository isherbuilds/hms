# Project intent

## What this repo is

A base for **multi-tenant B2B SaaS**: the parts every such product needs and
that are expensive to retrofit — tenant isolation, an organization-scoped
permission model, an audit trail, private file storage, and a closed account
model — implemented once, correctly, with tests that fail when the
isolation breaks.

Stack: Bun + Turborepo; TanStack Start (`apps/web`) and Hono/oRPC
(`apps/server`) over a shared `packages/api` router; Drizzle + PostgreSQL;
Better Auth with the organization plugin.

## What it is not

- **Not a framework.** Every package is ordinary application code meant to be
  read and edited, not configured from the outside.
- **Not a demo.** The worked example (`todo`) has been replaced by the first
  real domain: `settings`. `files`, `members`, and `audit` are not examples —
  they are the product.
- **Not opinionated about your domain.** The hard rules constrain _tenancy,
  authorization, and auditing_ only.

## Who it is for

Teams shipping a product where one deployment serves many customer
organizations, and where one customer seeing another's row is a company-ending
bug rather than an inconvenience.

## Product intent

- **Fail loud, never fall back.** A missing or unproven org claim is FORBIDDEN.
  There is no default scope; a request with an ambiguous tenant is a request
  that must not run.
- **Sensitive actions leave a record.** Not every mutation — the ones a customer
  or auditor will ask about.

## What not to assume

- **Do not assume a "current organization" exists on the session.** It does not;
  see [tenancy](./architecture/tenancy.md).
- **Do not assume a member has one role.** Roles are stored comma-joined and
  authorize as a union.
- **Do not assume an object can be public.** Storage issues presigned URLs only.
