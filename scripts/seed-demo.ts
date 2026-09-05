import { businessDate } from "@hms/api/lib/business-date";
import { documentNumber, fiscalYearLabel } from "@hms/api/lib/invoice-math";
import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { organization, user } from "@hms/db/schema/auth";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { organizationSettings } from "@hms/db/schema/organization-settings";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { env } from "@hms/env/server";
import { and, eq, like } from "drizzle-orm";

// Throwaway demo data for screenshots: three weeks of a plausible outpatient
// practice at Mercy General. Every row's id starts with `demo-`, so a re-run
// wipes only its own data and leaves anything you created by hand alone.
// All writes commit together. Existing references to demo rows make a rerun
// fail without changing the database.

if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

const SLUG = "mercy-general";
const HISTORY_DAYS = 20;

const now = new Date();

const [org] = await db.select().from(organization).where(eq(organization.slug, SLUG)).limit(1);
if (!org) throw new Error(`No organization "${SLUG}". Run \`bun run db:seed\` first.`);
const orgId = org.id;
const [settings] = await db
  .select()
  .from(organizationSettings)
  .where(eq(organizationSettings.orgId, orgId));
if (!settings) throw new Error(`No settings for "${SLUG}". Run \`bun run db:seed\` first.`);
const today = businessDate(now, settings.timeZone);

const [actor] = await db.select().from(user).where(eq(user.email, "owner@example.com")).limit(1);
if (!actor) throw new Error("No owner@example.com. Run `bun run db:seed` first.");
const userId = actor.id;

// --- Deterministic ids and randomness ----------------------------------------

let sequence = 0;
const id = (kind: string) => `demo-${kind}-${(sequence += 1).toString().padStart(6, "0")}`;

// A fixed seed, so two runs produce the same screenshots.
let rngState = 0x5eed_2026;
function random(): number {
  rngState = (rngState * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return rngState / 4_294_967_296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

function dayBefore(days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
// An IST wall-clock time on a business date, as an instant.
const at = (day: string, hour: number, minute: number) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);

// --- Catalog, departments, practitioners -------------------------------------

const DEPARTMENTS = [
  { name: "General Medicine", fee: "400.00", code: "CONS-GEN", share: 4 },
  { name: "Orthopaedics", fee: "700.00", code: "CONS-ORT", share: 2 },
  { name: "Dermatology", fee: "650.00", code: "CONS-DRM", share: 2 },
  { name: "Paediatrics", fee: "500.00", code: "CONS-PED", share: 3 },
  { name: "ENT", fee: "550.00", code: "CONS-ENT", share: 2 },
  { name: "Ophthalmology", fee: "600.00", code: "CONS-OPH", share: 1 },
];

const PROCEDURES = [
  { name: "Dressing, minor wound", code: "PROC-DRS", price: "250.00" },
  { name: "Nebulisation", code: "PROC-NEB", price: "300.00" },
  { name: "Suture removal", code: "PROC-SUT", price: "200.00" },
  { name: "Ear syringing", code: "PROC-EAR", price: "350.00" },
  { name: "Plaster cast, forearm", code: "PROC-PLC", price: "1200.00" },
  { name: "Cryotherapy, single lesion", code: "PROC-CRY", price: "900.00" },
  { name: "ECG, 12 lead", code: "PROC-ECG", price: "400.00" },
  { name: "Vision screening", code: "PROC-VIS", price: "300.00" },
];

const DOCTORS = [
  { name: "Dr. Anjali Deshpande", dept: "General Medicine", reg: "MMC-48219" },
  { name: "Dr. Vikram Rao", dept: "General Medicine", reg: "MMC-51004" },
  { name: "Dr. Suresh Iyer", dept: "Orthopaedics", reg: "MMC-39877" },
  { name: "Dr. Nadia Qureshi", dept: "Dermatology", reg: "MMC-60215" },
  { name: "Dr. Rohit Menon", dept: "Paediatrics", reg: "MMC-44530" },
  { name: "Dr. Kavya Pillai", dept: "ENT", reg: "MMC-57781" },
  { name: "Dr. Farhan Baig", dept: "Ophthalmology", reg: "MMC-62190" },
];

const consultItems = DEPARTMENTS.map((d) => ({
  id: id("item"),
  orgId,
  name: `${d.name} consultation`,
  code: d.code,
  category: "consultation" as const,
  unitPrice: d.fee,
  taxRatePercent: "0",
  taxCode: null,
  active: true,
}));
const procedureItems = PROCEDURES.map((p) => ({
  id: id("item"),
  orgId,
  name: p.name,
  code: p.code,
  category: "procedure" as const,
  unitPrice: p.price,
  taxRatePercent: "0",
  taxCode: null,
  active: true,
}));

const deptRows = DEPARTMENTS.map((d, i) => ({
  id: id("dept"),
  orgId,
  name: d.name,
  defaultConsultFeeItemId: consultItems[i]!.id,
  share: d.share,
}));
const deptByName = new Map(deptRows.map((d) => [d.name, d]));

const doctorRows = DOCTORS.map((doc) => {
  const dept = deptByName.get(doc.dept)!;
  return {
    id: id("doc"),
    orgId,
    name: doc.name,
    departmentId: dept.id,
    registrationNumber: doc.reg,
    consultFeeItemId: dept.defaultConsultFeeItemId,
    followUpFeeItemId: null,
    followUpValidityDays: 14,
    share: dept.share,
  };
});

// Weighted so the queue mix is not a flat six-way split.
const DOCTOR_POOL = doctorRows.flatMap((doc) => Array<typeof doc>(doc.share).fill(doc));

// --- Patients -----------------------------------------------------------------

// Kept apart so a record never reads "Fatima Sayed · Male".
const FEMALE_GIVEN = [
  "Meera",
  "Farida",
  "Ananya",
  "Sunita",
  "Divya",
  "Nikita",
  "Lakshmi",
  "Rhea",
  "Ishita",
  "Sneha",
  "Prisha",
  "Deepa",
  "Aisha",
  "Radha",
  "Zoya",
  "Kalpana",
  "Fatima",
  "Pooja",
  "Neelam",
];
const MALE_GIVEN = [
  "Rakesh",
  "Joseph",
  "Imran",
  "Aarav",
  "Prakash",
  "Salman",
  "Harish",
  "Mohan",
  "Tanvir",
  "Kabir",
  "Arjun",
  "Yusuf",
  "Nitin",
  "Girish",
  "Vivek",
  "Manoj",
  "Rohan",
  "Sanjay",
  "Iqbal",
];
const FAMILY = [
  "Nair",
  "Yadav",
  "Sheikh",
  "Mathew",
  "Kulkarni",
  "Qadri",
  "Bhosale",
  "Sharma",
  "Ramesh",
  "Gaikwad",
  "Jain",
  "Ansari",
  "Venkatesh",
  "Pawar",
  "D'Souza",
  "Kamble",
  "Banerjee",
  "Sayed",
  "Chatterjee",
  "Patil",
  "Reddy",
  "Nadkarni",
  "Joshi",
  "Fernandes",
];
const AREAS = ["Kothrud", "Aundh", "Camp", "Hadapsar", "Baner", "Wanowrie", "Kharadi"];

const PATIENT_COUNT = 160;
const patientRows = Array.from({ length: PATIENT_COUNT }, () => {
  const female = random() < 0.52;
  return {
    id: id("pat"),
    orgId,
    mrn: "",
    name: `${pick(female ? FEMALE_GIVEN : MALE_GIVEN)} ${pick(FAMILY)}`,
    phone: `9${between(700000000, 899999999)}`,
    sex: (female ? "female" : "male") as "female" | "male",
    dateOfBirth: `${between(1942, 2022)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`,
    dobEstimated: random() < 0.08,
    address: `${pick(AREAS)}, Pune`,
    email: null,
    bloodGroup: pick(["O+", "B+", "A+", "AB+", "O-", "B-"] as const),
    allergies: random() < 0.12 ? pick(["Penicillin", "Sulfa drugs", "Iodine contrast"]) : null,
    medicalHistory:
      random() < 0.18
        ? pick(["Type 2 diabetes, on metformin", "Hypertension", "Asthma, inhaler as needed"])
        : null,
    uid: null,
    createdBy: userId,
  };
});

// --- The practice, day by day --------------------------------------------------

const fyOf = (day: string) =>
  fiscalYearLabel(new Date(`${day}T06:00:00Z`), settings.fiscalYearStartMonth);

const appointmentRows: (typeof opdAppointments.$inferInsert)[] = [];
const chargeRows: (typeof charges.$inferInsert)[] = [];
const invoiceRows: (typeof invoices.$inferInsert)[] = [];
const invoiceLineRows: (typeof invoiceLines.$inferInsert)[] = [];
const paymentRows: (typeof payments.$inferInsert)[] = [];

type Settlement = "paid" | "part" | "unpaid" | "unbilled";

function visit(
  day: string,
  doctor: (typeof doctorRows)[number],
  options: {
    patient: (typeof patientRows)[number];
    hour: number;
    minute: number;
    settlement: Settlement;
  },
): void {
  const { patient, hour, minute, settlement } = options;
  const arrivedAt = at(day, hour, minute);
  const appointmentId = id("appt");
  appointmentRows.push({
    id: appointmentId,
    orgId,
    patientId: patient.id,
    practitionerId: doctor.id,
    departmentId: doctor.departmentId,
    arrivalMode: random() < 0.35 ? "scheduled" : "walk_in",
    status: "checked_in",
    businessDate: day,
    scheduledFor: arrivedAt,
    tokenNumber: null,
    arrivedAt,
    createdBy: userId,
    createdAt: arrivedAt,
    updatedAt: arrivedAt,
  });

  const fee = consultItems.find((item) => item.id === doctor.consultFeeItemId)!;
  const extras = random() < 0.38 ? [pick(procedureItems)] : [];
  const lines = [
    { item: fee, source: "consult_fee" as const },
    ...extras.map((item) => ({ item, source: "catalog" as const })),
  ];

  const invoiceId = settlement === "unbilled" ? null : id("inv");
  const rows = lines.map(({ item, source }) => ({
    id: id("chg"),
    orgId,
    opdAppointmentId: appointmentId,
    catalogItemId: item.id,
    description: item.name,
    unitPrice: item.unitPrice,
    taxRatePercent: "0",
    taxCode: null,
    revenueCategory: item.category,
    qty: 1,
    sourceType: source,
    sourceId: null,
    status: invoiceId ? ("invoiced" as const) : ("pending" as const),
    invoiceId,
    createdBy: userId,
    createdAt: arrivedAt,
    updatedAt: arrivedAt,
  }));
  chargeRows.push(...rows);
  if (!invoiceId) return;

  const subtotal = rows.reduce((sum, row) => sum + Number(row.unitPrice), 0);
  invoiceRows.push({
    id: invoiceId,
    orgId,
    opdAppointmentId: appointmentId,
    patientId: patient.id,
    invoiceNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    discountAmount: "0.00",
    note: null,
    subtotal: subtotal.toFixed(2),
    taxTotal: "0.00",
    grandTotal: subtotal.toFixed(2),
    orgLegalName: "Mercy General Hospital Pvt. Ltd.",
    orgAddress: "12 Hospital Road, Pune, Maharashtra 411001",
    orgTaxId: "27AAACM1234A1Z5",
    currency: "INR",
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientPhone: patient.phone,
    patientAddress: patient.address,
    issuedBy: userId,
    createdAt: arrivedAt,
  });
  invoiceLineRows.push(
    ...rows.map((row) => ({
      id: id("line"),
      orgId,
      invoiceId,
      chargeId: row.id,
      description: row.description,
      qty: 1,
      unitPrice: row.unitPrice,
      lineSubtotal: row.unitPrice,
      allocatedDiscount: "0.00",
      taxableValue: row.unitPrice,
      taxAmount: "0.00",
      gross: row.unitPrice,
      taxRatePercent: "0",
      taxCode: null,
      revenueCategory: row.revenueCategory,
    })),
  );

  if (settlement === "unpaid") return;
  const paid = settlement === "part" ? Math.round(subtotal / 2) : subtotal;
  paymentRows.push({
    id: id("pay"),
    orgId,
    invoiceId,
    method: pick(["cash", "cash", "upi", "upi", "upi", "card", "bank"] as const),
    amount: paid.toFixed(2),
    reference: null,
    receiptNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    receivedBy: userId,
    createdAt: arrivedAt,
  });
}

let patientCursor = 0;
const nextPatient = () => patientRows[patientCursor++ % patientRows.length]!;

for (let offset = HISTORY_DAYS; offset >= 0; offset--) {
  const day = dayBefore(offset);
  const weekday = new Date(`${day}T06:00:00Z`).getUTCDay();
  const sunday = weekday === 0;
  // A real week has shape: Sundays are short, Mondays are the crush.
  const load = sunday ? between(4, 7) : weekday === 1 ? between(18, 24) : between(11, 18);

  for (let i = 0; i < load; i++) {
    const doctor = pick(DOCTOR_POOL);
    const roll = random();
    const settlement: Settlement =
      roll < 0.82 ? "paid" : roll < 0.9 ? "part" : roll < 0.95 ? "unpaid" : "unbilled";
    const minuteOfDay = 9 * 60 + Math.floor(random() * 9 * 60);
    visit(day, doctor, {
      patient: nextPatient(),
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      settlement: offset === 0 && random() < 0.15 ? "unbilled" : settlement,
    });
  }

  // Bookings still to come, only for today; earlier days are closed out.
  if (offset === 0) {
    for (let i = 0; i < 7; i++) {
      const doctor = pick(DOCTOR_POOL);
      const scheduledFor = at(day, 15 + Math.floor(i / 3), (i % 3) * 20);
      appointmentRows.push({
        id: id("appt"),
        orgId,
        patientId: nextPatient().id,
        practitionerId: doctor.id,
        departmentId: doctor.departmentId,
        arrivalMode: "scheduled",
        status: "booked",
        businessDate: day,
        scheduledFor,
        tokenNumber: null,
        arrivedAt: null,
        createdBy: userId,
        createdAt: at(day, 8, 0),
        updatedAt: at(day, 8, 0),
      });
    }
    // One of each closed state, so the "All" filter is not a wall of one status.
    for (const status of ["cancelled", "no_show"] as const) {
      const doctor = pick(DOCTOR_POOL);
      const scheduledFor = at(day, 11, 30);
      appointmentRows.push({
        id: id("appt"),
        orgId,
        patientId: nextPatient().id,
        practitionerId: doctor.id,
        departmentId: doctor.departmentId,
        arrivalMode: "scheduled",
        status,
        businessDate: day,
        scheduledFor,
        tokenNumber: null,
        arrivedAt: null,
        cancelledAt: status === "cancelled" ? at(day, 10, 5) : null,
        noShowAt: status === "no_show" ? at(day, 12, 30) : null,
        cancelReason: status === "cancelled" ? "Patient called to reschedule" : null,
        createdBy: userId,
        createdAt: at(day, 8, 0),
        updatedAt: at(day, 12, 30),
      });
    }
  }
}

// Allocate through the same counters as the app, then insert in dependency order.
await db.transaction(async (tx) => {
  for (const table of [
    invoiceLines,
    payments,
    charges,
    invoices,
    opdAppointments,
    patients,
    practitioners,
    departments,
    catalogItems,
  ]) {
    await tx.delete(table).where(and(eq(table.orgId, orgId), like(table.id, "demo-%")));
  }

  for (const patient of patientRows) {
    const sequence = await nextCounter(tx, orgId, "mrn");
    patient.mrn = `${settings.mrnPrefix}${String(sequence).padStart(6, "0")}`;
  }
  const patientById = new Map(patientRows.map((patient) => [patient.id, patient]));
  for (const appointment of appointmentRows) {
    if (appointment.status === "checked_in") {
      appointment.tokenNumber = await nextCounter(
        tx,
        orgId,
        `opd-token:${appointment.practitionerId}:${appointment.businessDate}`,
      );
    }
  }
  for (const invoice of invoiceRows) {
    const sequence = await nextCounter(tx, orgId, `invoice:${invoice.fiscalYear}`);
    invoice.invoiceNumber = documentNumber(settings.invoicePrefix, invoice.fiscalYear, sequence);
    invoice.patientMrn = patientById.get(invoice.patientId)!.mrn;
  }
  for (const payment of paymentRows) {
    const sequence = await nextCounter(tx, orgId, `receipt:${payment.fiscalYear}`);
    payment.receiptNumber = documentNumber(settings.receiptPrefix, payment.fiscalYear, sequence);
  }

  await tx.insert(catalogItems).values([...consultItems, ...procedureItems]);
  await tx.insert(departments).values(deptRows.map(({ share: _share, ...row }) => row));
  await tx.insert(practitioners).values(doctorRows.map(({ share: _share, ...row }) => row));
  await tx.insert(patients).values(patientRows);
  await tx.insert(opdAppointments).values(appointmentRows);
  await tx.insert(invoices).values(invoiceRows);
  await tx.insert(charges).values(chargeRows);
  await tx.insert(invoiceLines).values(invoiceLineRows);
  await tx.insert(payments).values(paymentRows);
});

const collectedToday = paymentRows
  .filter((row) => row.businessDate === today)
  .reduce((sum, row) => sum + Number(row.amount), 0);

console.info(
  [
    "",
    "Demo practice seeded.",
    `  ${HISTORY_DAYS + 1} days, ${appointmentRows.length} appointments, ${invoiceRows.length} invoices, ${paymentRows.length} receipts.`,
    `  Today (${today}): ₹${collectedToday.toLocaleString("en-IN")} collected.`,
    `  Sign in as owner@example.com / password123 and open /${SLUG}/dashboard`,
    "",
  ].join("\n"),
);
process.exit(0);
