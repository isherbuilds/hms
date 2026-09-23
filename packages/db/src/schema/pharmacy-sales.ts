import { foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { orgIdColumn, user } from "./auth";
import { opdAppointments } from "./opd-appointments";
import { patients } from "./patients";

// The counter sale. A customer needs no Patient record; a Patient or an OPD Appointment
// is linked when known. `forName` and `prescriberName` are the facts the paper H1
// register needs, recorded separately from who is paying.
export const pharmacySales = pgTable(
  "pharmacy_sales",
  {
    id: text("id").primaryKey(),
    orgId: orgIdColumn(),
    patientId: text("patient_id"),
    opdAppointmentId: text("opd_appointment_id"),
    buyerName: text("buyer_name").notNull(),
    buyerPhone: text("buyer_phone"),
    // Who the medicine is for; the buyer when omitted.
    forName: text("for_name"),
    prescriberName: text("prescriber_name"),
    prescriptionReference: text("prescription_reference"),
    note: text("note"),
    soldBy: text("sold_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("pharmacy_sales_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      columns: [table.orgId, table.patientId],
      foreignColumns: [patients.orgId, patients.id],
    }),
    foreignKey({
      columns: [table.orgId, table.opdAppointmentId],
      foreignColumns: [opdAppointments.orgId, opdAppointments.id],
    }),
    index("pharmacy_sales_org_created_idx").on(table.orgId, table.createdAt, table.id),
  ],
);
