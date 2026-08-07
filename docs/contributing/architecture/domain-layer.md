# HMS domain layer

This page maps the HMS domain that is live today. It describes current code,
not a proposed schema or migration. The platform invariants still apply: every
domain row is scoped by `orgId`, every query includes its organization
predicate, and every organization procedure is declared through
`orgProcedure(...)`.

## Current boundary

The live front-desk boundary covers organization setup and settings, patient
registration and search, the priced service catalog, and department and
practitioner setup.
The corresponding organization routes are:

- `/org/$orgSlug/admin/settings`
- `/org/$orgSlug/front-desk`, `/front-desk/register`, and
  `/front-desk/patients/$patientId` beneath the same organization prefix
- `/org/$orgSlug/admin/catalog`
- `/org/$orgSlug/admin/staff`

Appointments, encounters, orders, results, charging, and beds are not live.
`encounter` is the working future name; [proposal 02](../../improvements/02-appointments-encounters.md)
owns the visit-versus-encounter naming decision.

## Existing relationships

```ts
// Existing shape, simplified for architecture documentation.
counter: { orgId, key, value } // primary key (orgId, key)
patients: { id, orgId, mrn, createdBy }
catalogItems: { id, orgId, category, unitPrice, active }
practitioners: { id, orgId, departmentId, memberUserId?, consultFeeItemId? }
```

### Patient MRN

Registration reads `mrnPrefix` from the organization settings TTL cache, then
allocates a six-digit per-organization number:

```ts
`${settings.mrnPrefix}${String(seq).padStart(6, "0")}`;
```

The named `mrn` counter increment and patient insert share one database
transaction. The `(orgId, key)` row lock serializes concurrent allocation for
that tenant, and rollback returns the number with the transaction. See
[ADR 0018](../decisions/0018-org-scoped-mrn-counter.md) for the decision and its
limits.

### Chargeable-item catalog

`catalogItems` is the single current registry for chargeable services. Each item
is organization-scoped and carries its category, unit price, tax fields, and
active state. Deactivation hides an item from future selection rather than
deleting it. Charging itself is future scope; the registry exists now so later
charge records can refer to a controlled per-hospital item instead of inventing
prices in each workflow.

### Practitioners and logins

A practitioner is a staff record in an organization and belongs to one of that
organization's departments. `memberUserId` optionally links the practitioner to
a login for future attribution; a practitioner can exist without a login. The
user ID is attribution, never tenant scope or authorization. Handlers must prove
that linked department and catalog rows share the request's organization, and
all later reads still scope the practitioner by `orgId`.

`consultFeeItemId` may point at the organization's catalog item intended for a
future consultation charge. That relationship does not make charging live.

## Procedures and permissions

| Domain        | Procedures                      | Required permission |
| ------------- | ------------------------------- | ------------------- |
| Patient       | `patient.register`              | `patient:create`    |
| Patient       | `patient.search`, `patient.get` | `patient:read`      |
| Patient       | `patient.update`                | `patient:update`    |
| Catalog       | `catalog.list`                  | `catalog:read`      |
| Catalog       | `catalog.create`                | `catalog:create`    |
| Catalog       | `catalog.update`                | `catalog:update`    |
| Departments   | `staff.listDepartments`         | `staff:read`        |
| Departments   | `staff.createDepartment`        | `staff:create`      |
| Departments   | `staff.updateDepartment`        | `staff:update`      |
| Practitioners | `staff.listPractitioners`       | `staff:read`        |
| Practitioners | `staff.createPractitioner`      | `staff:create`      |
| Practitioners | `staff.updatePractitioner`      | `staff:update`      |

These are all `orgProcedure(...)` calls. Permission checks establish what the
member may do; they do not replace the `orgId` predicate on every select,
insert, and update. Optional member linkage likewise never authorizes a row.

Patient registration and update currently call the ordinary fire-and-forget
`audit()` after their database writes; the audit write is not part of the
patient transaction. Follow the [audit architecture](./audit.md) rather than
inventing events or assuming atomic audit behavior.
