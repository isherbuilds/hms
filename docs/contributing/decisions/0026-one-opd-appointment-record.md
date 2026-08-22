# 0026: One OPD appointment record

- **Status:** accepted
- **Date:** 2026-08-22
- **Supersedes:** [0023](./0023-charges-hang-off-the-clinical-encounter.md) and the
  appointment/Clinical Encounter parts of
  [0022](./0022-care-settings-are-separate-destinations.md)

## Decision

Use one `opd_appointments` record for scheduled and walk-in outpatient work. `arrivalMode`, `kind`,
and lifecycle `status` are separate axes. Check-in enriches the same booked row with a Patient,
arrival time, token, and consult charge; it does not create another operational or clinical wrapper.

Staff navigation keeps the familiar OPD, IPD, and Emergency labels. Internal records are
`opdAppointment`, `admission`, and `emergencyCase`. IPD and Emergency remain separate workflows and
tables when implemented.

Charges, invoices, and OPD attachments reference `opdAppointmentId` directly. A shared care anchor
may be reconsidered only after another live setting has a concrete cross-setting child record or
query that cannot be expressed cleanly with typed foreign keys.

## Consequences

- Booking and queue screens are projections of one record, eliminating check-in identity mapping.
- Walk-ins and scheduled arrivals share token, fee, billing, and consultation code after arrival.
- The row remains an operational parent; clinical notes, observations, orders, files, charges, and
  financial documents remain typed child records rather than columns on the appointment.
- There is no compatibility layer because the product has no production data.
- The staff-facing separation of OPD, IPD, and Emergency from ADR 0022 remains accepted.
