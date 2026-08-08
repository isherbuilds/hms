# Project intent

## What this repo is

A **hospital management system** built on a multi-tenant application spine:
tenant isolation, an organization-scoped permission model, an audit trail,
private file storage, and a closed account model are implemented once and
protected by tests that fail when isolation breaks.

The live HMS domains are patient registration and search, priced catalog setup,
department and practitioner setup, OPD visits with a daily token queue, charging
and billing through to invoices, payments, credit notes and refunds, dashboard
reporting, and AI chat. Organization settings and the platform surfaces for
members, audit, and files support them. Appointments and encounters, orders,
results, and beds are product direction, not shipped scope. See the
[HMS domain layer](./architecture/domain-layer.md) for the boundary in detail.

Stack: Bun + Turborepo; TanStack Start (`apps/web`) and Hono/oRPC
(`apps/server`) over a shared `packages/api` router; Drizzle + PostgreSQL;
Better Auth with the organization plugin.

## What it is not

- **Not a framework.** Every package is ordinary application code meant to be
  read and edited, not configured from the outside.
- **Not a demo.** `settings`, `patient`, `catalog`, `staff`, `visit`, `billing`,
  `dashboard`, and AI are live product domains. `files`, `members`, and `audit`
  are platform capabilities, not examples.
- **Not a claim that the whole hospital workflow is built.** The product covers
  the OPD front office and its billing path; clinical documentation, orders,
  results, and inpatient workflows are not live.

## Who it is for

Teams building an HMS where one deployment serves many hospitals and where one
hospital seeing another's patient, staff, catalog, or platform row is a
company-ending bug rather than an inconvenience.

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
