import { formatDecimal, parseDecimal } from "@hms/api/core/money";
import { admissionIssueDescription } from "@hms/api/lib/admission-charges";
import { businessDate } from "@hms/api/lib/business-date";
import {
  computeInvoiceLines,
  documentNumber,
  fiscalYearLabel,
  roundsToRupee,
} from "@hms/api/lib/invoice-math";
import { postJournalEntries, revenueAccountFor, settlementAccountFor } from "@hms/api/lib/ledger";
import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { member, organization, user } from "@hms/db/schema/auth";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { goodsReceiptLines } from "@hms/db/schema/goods-receipt-lines";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import {
  admissionBedStays,
  admissionPharmacyIssueLines,
  admissionPharmacyIssues,
  admissions,
  bedCategories,
  bedReservations,
  bedTariffs,
  beds,
  wards,
} from "@hms/db/schema/ipd";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { organizationSettings } from "@hms/db/schema/organization-settings";
import { patients } from "@hms/db/schema/patients";
import { patientPayers } from "@hms/db/schema/patient-payers";
import { payers } from "@hms/db/schema/payers";
import { payments } from "@hms/db/schema/payments";
import { pharmacySales } from "@hms/db/schema/pharmacy-sales";
import { practitioners } from "@hms/db/schema/practitioners";
import { products } from "@hms/db/schema/products";
import { refunds } from "@hms/db/schema/refunds";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { stockMovements } from "@hms/db/schema/stock-movements";
import {
  equipmentUnits,
  resourceBlocks,
  surgicalCaseEquipment,
  surgicalCases,
  theatreRooms,
} from "@hms/db/schema/theatre";
import { treatmentPlanItems } from "@hms/db/schema/treatment-plan-items";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { env } from "@hms/env/server";
import { type AnyColumn, and, eq, inArray, like, sql } from "drizzle-orm";

if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

/*
 * Default: the local `mercy-general` from `bun run db:seed`, renamed for screenshots.
 * `--org <slug> --actor <email>` replaces all of that org's patient, billing, pharmacy,
 * and journal rows, keeps its name and paper identity, and leaves other orgs alone. `--dry-run` rolls the whole transaction back.
 */
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);

  return at === -1 ? undefined : process.argv[at + 1];
}

const targetSlug = flag("--org");

const SLUG = targetSlug ?? "mercy-general";

const ACTOR_EMAIL = flag("--actor") ?? "owner@example.com";

const DRY_RUN = process.argv.includes("--dry-run");

if (targetSlug && !flag("--actor")) throw new Error("--org needs --actor <member email>.");

const HISTORY_DAYS = 45;

const now = new Date();

const [org] = await db.select().from(organization).where(eq(organization.slug, SLUG)).limit(1);

if (!org) throw new Error(`No organization "${SLUG}". Run \`bun run db:seed\` first.`);

const orgId = org.id;

const [settings] = await db
  .select()
  .from(organizationSettings)
  .where(eq(organizationSettings.orgId, orgId));

if (!settings) throw new Error(`No settings for "${SLUG}". Run \`bun run db:seed\` first.`);

const HOSPITAL = targetSlug
  ? {
      name: org.name,
      legalName: settings.legalName,
      address: settings.address,
      taxId: settings.taxId,
    }
  : {
      name: "Navjeevan Hospital",
      legalName: "Navjeevan Hospital Pvt. Ltd.",
      address: "12 Hospital Road, Pune, Maharashtra 411001",
      taxId: "27AAACM1234A1Z5",
    };

const today = businessDate(now, settings.timeZone);

const [actor] = await db.select().from(user).where(eq(user.email, ACTOR_EMAIL)).limit(1);

if (!actor) throw new Error(`No user ${ACTOR_EMAIL}.`);

const [membership] = await db
  .select({ id: member.id })
  .from(member)
  .where(and(eq(member.organizationId, orgId), eq(member.userId, actor.id)));

if (!membership) throw new Error(`${ACTOR_EMAIL} is not a member of "${SLUG}".`);

const userId = actor.id;

let sequence = 0;

const id = (kind: string) => `demo-${kind}-${(sequence += 1).toString().padStart(6, "0")}`;

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

const at = (day: string, hour: number, minute: number) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);

const DEPARTMENTS = [
  { name: "General Medicine", fee: "400.00", share: 4 },
  { name: "Orthopaedics", fee: "700.00", share: 2 },
  { name: "Dermatology", fee: "650.00", share: 2 },
  { name: "Paediatrics", fee: "500.00", share: 3 },
  { name: "ENT", fee: "550.00", share: 2 },
  { name: "Ophthalmology", fee: "600.00", share: 1 },
  { name: "Cardiology", fee: "900.00", share: 2 },
  { name: "Gynaecology", fee: "800.00", share: 2 },
  { name: "Gastroenterology", fee: "850.00", share: 1 },
  { name: "Pulmonology", fee: "750.00", share: 1 },
  { name: "Dental", fee: "500.00", share: 2 },
  { name: "Neurology", fee: "1000.00", share: 1 },
  { name: "Psychiatry", fee: "1000.00", share: 1 },
];

/* `depts` limits an extra to the departments that would really bill it. */
const PROCEDURES: { name: string; price: string; customRate?: true; depts: string[] }[] = [
  {
    name: "Dressing, minor wound",
    price: "250.00",
    depts: ["General Medicine", "Orthopaedics", "Paediatrics", "ENT"],
  },
  {
    name: "Nebulisation",
    price: "300.00",
    depts: ["Paediatrics", "Pulmonology", "General Medicine"],
  },
  {
    name: "Suture removal",
    price: "200.00",
    depts: ["Orthopaedics", "General Medicine", "Dermatology"],
  },
  { name: "Ear syringing", price: "350.00", depts: ["ENT"] },
  { name: "Nasal endoscopy", price: "1500.00", depts: ["ENT"] },
  { name: "Audiometry", price: "800.00", depts: ["ENT"] },
  { name: "Plaster cast, forearm", price: "1200.00", depts: ["Orthopaedics"] },
  { name: "Joint injection", price: "1800.00", depts: ["Orthopaedics"] },
  {
    name: "Physiotherapy session",
    price: "500.00",
    customRate: true,
    depts: ["Orthopaedics", "Neurology"],
  },
  { name: "Cryotherapy, single lesion", price: "900.00", depts: ["Dermatology"] },
  { name: "Skin biopsy", price: "2200.00", depts: ["Dermatology"] },
  { name: "Chemical peel", price: "3500.00", depts: ["Dermatology"] },
  { name: "ECG, 12 lead", price: "400.00", depts: ["Cardiology", "General Medicine"] },
  { name: "2D echocardiography", price: "2200.00", depts: ["Cardiology"] },
  { name: "Treadmill stress test", price: "2500.00", depts: ["Cardiology"] },
  { name: "Vision screening", price: "300.00", depts: ["Ophthalmology", "Paediatrics"] },
  { name: "Eye pressure check", price: "400.00", depts: ["Ophthalmology"] },
  { name: "Fundus examination", price: "700.00", depts: ["Ophthalmology"] },
  { name: "Spirometry", price: "600.00", depts: ["Pulmonology"] },
  { name: "Pap smear", price: "700.00", depts: ["Gynaecology"] },
  { name: "Obstetric ultrasound", price: "1200.00", depts: ["Gynaecology"] },
  { name: "IUCD insertion", price: "1500.00", depts: ["Gynaecology"] },
  { name: "Upper GI endoscopy", price: "4500.00", depts: ["Gastroenterology"] },
  { name: "Scaling and polishing", price: "1200.00", depts: ["Dental"] },
  { name: "Tooth extraction", price: "1000.00", depts: ["Dental"] },
  { name: "Composite filling", price: "1500.00", depts: ["Dental"] },
  { name: "Root canal, single sitting", price: "6500.00", depts: ["Dental"] },
  { name: "EEG", price: "2000.00", depts: ["Neurology"] },
  { name: "Counselling session", price: "1500.00", depts: ["Psychiatry"] },
  { name: "Vaccination, administration", price: "150.00", depts: ["Paediatrics"] },
];

const DOCTORS = [
  { name: "Dr. Anjali Deshpande", dept: "General Medicine", reg: "MMC-48219" },
  { name: "Dr. Vikram Rao", dept: "General Medicine", reg: "MMC-51004" },
  { name: "Dr. Suresh Iyer", dept: "Orthopaedics", reg: "MMC-39877" },
  { name: "Dr. Nadia Qureshi", dept: "Dermatology", reg: "MMC-60215" },
  { name: "Dr. Rohit Menon", dept: "Paediatrics", reg: "MMC-44530" },
  { name: "Dr. Kavya Pillai", dept: "ENT", reg: "MMC-57781" },
  { name: "Dr. Farhan Baig", dept: "Ophthalmology", reg: "MMC-62190" },
  { name: "Dr. Meera Kapoor", dept: "Cardiology", reg: "MMC-52308" },
  { name: "Dr. Arvind Joshi", dept: "Cardiology", reg: "MMC-41876" },
  { name: "Dr. Sunita Bhat", dept: "Gynaecology", reg: "MMC-47731" },
  { name: "Dr. Pallavi Nene", dept: "Gynaecology", reg: "MMC-58102" },
  { name: "Dr. Imran Shaikh", dept: "Gastroenterology", reg: "MMC-49967" },
  { name: "Dr. Lakshmi Narayan", dept: "Pulmonology", reg: "MMC-53410" },
  { name: "Dr. Tanvi Kulkarni", dept: "Dental", reg: "MDC-1184" },
  { name: "Dr. Rahul Gokhale", dept: "Dental", reg: "MDC-2057" },
  { name: "Dr. Anita Sathe", dept: "Neurology", reg: "MMC-55026" },
  { name: "Dr. Ishaan Verma", dept: "Psychiatry", reg: "MMC-61549" },
];

const consultItems = DEPARTMENTS.map((d) => ({
  id: id("item"),
  orgId,
  name: `${d.name} consultation`,
  category: "consultation" as const,
  unitPrice: parseDecimal(d.fee),
  taxRatePercent: "0",
  taxCode: null,
  active: true,
}));

const procedureItems = PROCEDURES.map((p) => ({
  id: id("item"),
  orgId,
  name: p.name,
  category: "procedure" as const,
  unitPrice: parseDecimal(p.price),
  customRate: p.customRate === true,
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

type StockUnit = NonNullable<(typeof products.$inferInsert)["stockUnit"]>;

type Schedule = NonNullable<(typeof products.$inferInsert)["schedule"]>;

type ProductSpec = {
  name: string;
  generic?: string;
  form?: string;
  strength?: string;
  unit: StockUnit;
  perPack: number;
  pack?: string;
  schedule?: Schedule;
  mfr?: string;
  gst: string;
  hsn?: string;
  /** Rupees per `mrpUnits` stock units. */
  mrp: number;
  mrpUnits: number;
  sold?: boolean;
  active?: boolean;
  expires: boolean;
  /** Stock units per counter sale line. */
  sell?: number[];
  batches: { no: string; exp: number | null; qty: number }[];
};

const MEDICO = "Medico Labs";

const VEDA = "Veda Pharma";

const AAROGYA = "Aarogya Remedies";

const KONKAN = "Konkan Biotech";

const SAHYADRI = "Sahyadri Drugs";

const tab = (
  name: string,
  generic: string,
  strength: string,
  mrp: number,
  perPack: number,
  qty: number,
  mfr: string,
  extra: Partial<ProductSpec> = {},
): ProductSpec => ({
  name: `${name} ${strength}`,
  generic,
  form: "tablet",
  strength,
  unit: "tablet",
  perPack,
  pack: `${perPack} tablets`,
  mfr,
  gst: "12.00",
  hsn: "3004",
  mrp,
  mrpUnits: perPack,
  expires: true,
  sell: [perPack, perPack, perPack * 2],
  batches: [
    {
      no: `${generic.slice(0, 3).toUpperCase()}-${between(2310, 2409)}`,
      exp: between(240, 560),
      qty,
    },
  ],
  ...extra,
});

const goods = (
  name: string,
  form: string,
  unit: StockUnit,
  mrp: number,
  qty: number,
  mfr: string,
  extra: Partial<ProductSpec> = {},
): ProductSpec => ({
  name,
  generic: undefined,
  form,
  unit,
  perPack: 1,
  mfr,
  gst: "12.00",
  hsn: "3004",
  mrp,
  mrpUnits: 1,
  expires: true,
  sell: [1, 1, 2],
  batches: [
    { no: `${name.slice(0, 3).toUpperCase()}-${between(2310, 2409)}`, exp: between(200, 520), qty },
  ],
  ...extra,
});

const device = (name: string, mrp: number, qty: number, extra: Partial<ProductSpec> = {}) =>
  ({
    name,
    unit: "piece",
    perPack: 1,
    gst: "18.00",
    hsn: "9018",
    mrp,
    mrpUnits: 1,
    expires: false,
    sell: [1],
    batches: [{ no: "DV-01", exp: null, qty }],
    ...extra,
  }) satisfies ProductSpec;

const supply = (name: string, pack: string, perPack: number, qty: number): ProductSpec => ({
  name,
  unit: "piece",
  perPack,
  pack,
  gst: "0",
  mrp: 0,
  mrpUnits: perPack,
  sold: false,
  expires: false,
  batches: [{ no: "SUP-01", exp: null, qty }],
});

const PRODUCT_SPECS: ProductSpec[] = [
  tab("Paracetamol", "Paracetamol", "500 mg", 30, 10, 1800, MEDICO, {
    sell: [10, 10, 20, 30],
    batches: [
      { no: "PCM-2301", exp: -40, qty: 60 },
      { no: "PCM-2406", exp: 380, qty: 1800 },
    ],
  }),
  tab("Azithromycin", "Azithromycin", "500 mg", 120, 3, 450, VEDA, { schedule: "h", sell: [3, 6] }),
  tab("Amoxicillin + Clavulanate", "Amoxicillin", "625 mg", 220, 10, 600, VEDA, {
    schedule: "h",
    sell: [10, 15],
    batches: [
      { no: "AMX-2311", exp: 24, qty: 80 },
      { no: "AMX-2407", exp: 330, qty: 600 },
    ],
  }),
  tab("Metformin", "Metformin", "500 mg", 28, 10, 2400, AAROGYA, { sell: [30, 60] }),
  tab("Amlodipine", "Amlodipine", "5 mg", 42, 10, 1500, AAROGYA, { sell: [30, 30, 60] }),
  tab("Atorvastatin", "Atorvastatin", "10 mg", 95, 10, 1200, MEDICO, { sell: [30, 30] }),
  tab("Telmisartan", "Telmisartan", "40 mg", 110, 10, 900, KONKAN, { sell: [30, 30] }),
  tab("Pantoprazole", "Pantoprazole", "40 mg", 135, 10, 1500, VEDA, {
    schedule: "h",
    sell: [10, 15],
  }),
  tab("Cetirizine", "Cetirizine", "10 mg", 24, 10, 1000, SAHYADRI, {
    schedule: "none",
    sell: [10],
  }),
  tab("Montelukast", "Montelukast", "10 mg", 165, 10, 700, KONKAN, {
    schedule: "h",
    sell: [10, 15],
  }),
  tab("Levothyroxine", "Levothyroxine", "50 mcg", 220, 100, 1500, SAHYADRI, {
    schedule: "h",
    sell: [30, 60],
  }),
  tab("Ibuprofen", "Ibuprofen", "400 mg", 32, 10, 1100, MEDICO, { sell: [10, 15] }),
  tab("Diclofenac", "Diclofenac", "50 mg", 26, 10, 1100, AAROGYA, {
    schedule: "h",
    sell: [10, 20],
  }),
  tab("Ondansetron", "Ondansetron", "4 mg", 54, 10, 500, KONKAN, { schedule: "h", sell: [6, 10] }),
  tab("Alprazolam", "Alprazolam", "0.25 mg", 38, 10, 300, SAHYADRI, { schedule: "h1", sell: [10] }),
  {
    ...tab("Omeprazole", "Omeprazole", "20 mg", 55, 10, 1300, VEDA, { schedule: "h" }),
    form: "capsule",
    unit: "capsule",
    pack: "10 capsules",
  },
  {
    ...tab("Doxycycline", "Doxycycline", "100 mg", 118, 10, 600, MEDICO, { schedule: "h" }),
    form: "capsule",
    unit: "capsule",
    pack: "10 capsules",
  },
  {
    ...tab("Vitamin D3", "Cholecalciferol", "60000 IU", 120, 4, 400, AAROGYA, { schedule: "none" }),
    form: "capsule",
    unit: "capsule",
    pack: "4 capsules",
    sell: [4, 8],
  },
  goods("Cough syrup 100 ml", "syrup", "bottle", 120, 80, MEDICO, {
    generic: "Dextromethorphan",
    strength: "100 ml",
    pack: "100 ml",
    schedule: "h",
  }),
  goods("Paracetamol suspension 60 ml", "syrup", "bottle", 58, 90, SAHYADRI, {
    generic: "Paracetamol",
    strength: "60 ml",
    pack: "60 ml",
  }),
  goods("Cetirizine syrup 60 ml", "syrup", "bottle", 62, 70, SAHYADRI, {
    generic: "Cetirizine",
    strength: "60 ml",
    pack: "60 ml",
  }),
  goods("Antacid gel 170 ml", "syrup", "bottle", 135, 60, VEDA, { pack: "170 ml" }),
  goods("ORS sachet", "powder", "piece", 22, 300, AAROGYA, { sell: [5, 10] }),
  goods("Ceftriaxone injection 1 g", "injection", "vial", 95, 60, KONKAN, {
    generic: "Ceftriaxone",
    strength: "1 g",
    schedule: "h",
  }),
  goods("Diclofenac injection 3 ml", "injection", "vial", 18, 120, AAROGYA, {
    generic: "Diclofenac",
    strength: "3 ml",
    schedule: "h",
    sell: [1, 2, 3],
  }),
  goods("Clobetasol cream 15 g", "cream", "tube", 88, 70, VEDA, {
    generic: "Clobetasol",
    strength: "15 g",
    schedule: "h",
  }),
  goods("Povidone iodine ointment 20 g", "ointment", "tube", 64, 90, MEDICO, {
    generic: "Povidone iodine",
    strength: "20 g",
  }),
  goods("Diclofenac gel 30 g", "gel", "tube", 108, 80, KONKAN, {
    generic: "Diclofenac",
    strength: "30 g",
  }),
  goods("Mupirocin ointment 5 g", "ointment", "tube", 138, 50, VEDA, {
    generic: "Mupirocin",
    strength: "5 g",
    schedule: "h",
  }),
  goods("Moxifloxacin eye drops 5 ml", "drops", "bottle", 96, 60, SAHYADRI, {
    generic: "Moxifloxacin",
    strength: "5 ml",
    schedule: "h",
  }),
  goods("Lubricant eye drops 10 ml", "drops", "bottle", 168, 50, KONKAN, { pack: "10 ml" }),
  device("Digital BP monitor", 2500, 14),
  device("Pulse oximeter", 1800, 10),
  device("Digital thermometer", 280, 40),
  device("Glucose test strips, 50", 880, 36),
  device("N95 mask", 95, 120, { gst: "12.00", hsn: "6307" }),
  supply("Examination gloves", "Box of 100", 100, 300),
  supply("Disposable syringe 5 ml", "Pack of 100", 100, 800),
  supply("Cotton roll 500 g", "Roll", 1, 40),
  supply("Bandage roll 6 inch", "Roll", 1, 150),
  supply("Surgical mask, 3-ply", "Box of 50", 50, 600),
  {
    name: "Old antiseptic cream",
    unit: "tube",
    perPack: 1,
    gst: "12.00",
    mrp: 60,
    mrpUnits: 1,
    expires: true,
    active: false,
    batches: [],
  },
];

const productRows: (typeof products.$inferInsert)[] = PRODUCT_SPECS.map((spec) => ({
  id: id("product"),
  orgId,
  name: spec.name,
  genericName: spec.generic ?? null,
  form: spec.form ?? null,
  strength: spec.strength ?? null,
  stockUnit: spec.unit,
  unitsPerPack: spec.perPack,
  expires: spec.expires,
  pack: spec.pack ?? null,
  schedule: spec.schedule ?? "none",
  manufacturer: spec.mfr ?? null,
  sold: spec.sold ?? true,
  taxRatePercent: spec.gst,
  taxCode: spec.hsn ?? null,
  active: spec.active ?? true,
}));

const openingReceiptId = id("receipt");

const receiptRows: (typeof goodsReceipts.$inferInsert)[] = [
  {
    id: openingReceiptId,
    orgId,
    opening: true,
    receivedOn: dayBefore(HISTORY_DAYS + 1),
    receivedBy: userId,
    note: "Opening count",
  },
];

const receiptLineRows: (typeof goodsReceiptLines.$inferInsert)[] = [];

const productBatches: (typeof stockBatches.$inferInsert)[] = [];

const movementRows: (typeof stockMovements.$inferInsert)[] = [];

/* The batches the counter can sell from, tracked as the sales below draw them down. */
type Shelf = {
  batchId: string;
  productIndex: number;
  expiry: string | null;
  qty: number;
  availableFrom: string;
};

const shelf: Shelf[] = [];

const batchSpecOf = new Map<string, ProductSpec>();

function addBatch(
  productIndex: number,
  batch: { no: string; exp: number | null; qty: number },
  day: string,
  receiptId: string,
  reason: "opening" | "receipt",
): string {
  const spec = PRODUCT_SPECS[productIndex]!;
  const batchId = id("batch");

  productBatches.push({
    id: batchId,
    orgId,
    productId: productRows[productIndex]!.id,
    batchNumber: batch.no,
    expiryDate: batch.exp === null ? null : dayBefore(-batch.exp),
    mrp: BigInt(spec.mrp * 100),
    mrpUnits: spec.mrpUnits,
  });
  movementRows.push({
    id: id("movement"),
    orgId,
    batchId,
    bucket: "shelf",
    qty: batch.qty,
    reason,
    sourceType: "goods_receipt",
    sourceId: receiptId,
    createdBy: userId,
    createdAt: at(day, 10, 0),
  });
  shelf.push({
    batchId,
    productIndex,
    expiry: batch.exp === null ? null : dayBefore(-batch.exp),
    qty: batch.qty,
    availableFrom: day,
  });
  batchSpecOf.set(batchId, spec);

  return batchId;
}

PRODUCT_SPECS.forEach((spec, index) => {
  for (const batch of spec.batches) {
    addBatch(index, batch, dayBefore(HISTORY_DAYS + 1), openingReceiptId, "opening");
  }
});

/* Supplier deliveries restock a third of the catalogue each, as new batches. */
const DELIVERIES = [
  { ago: 32, supplier: "Pune Medical Supplies", reference: "PMS-2291" },
  { ago: 17, supplier: "Sahyadri Distributors", reference: "SD-8841" },
  { ago: 4, supplier: "Pune Medical Supplies", reference: "PMS-2418" },
];

DELIVERIES.forEach((delivery, deliveryIndex) => {
  const day = dayBefore(delivery.ago);
  const receiptId = id("receipt");
  let billTotal = 0n;

  PRODUCT_SPECS.forEach((spec, index) => {
    if (spec.batches.length === 0 || spec.sold === false || index % 3 !== deliveryIndex) return;

    const qty = Math.max(
      spec.perPack,
      Math.round((spec.batches.at(-1)!.qty * 0.6) / spec.perPack) * spec.perPack,
    );

    const batchId = addBatch(
      index,
      { no: `R${delivery.ago}-${index}`, exp: between(300, 600), qty },
      day,
      receiptId,
      "receipt",
    );

    const rate = BigInt(Math.round(spec.mrp * 65));
    const base = (BigInt(qty) * rate) / BigInt(spec.mrpUnits);
    const gst = Number(spec.gst);

    billTotal += (base * BigInt(Math.round((100 + gst) * 100))) / 10_000n;
    receiptLineRows.push({
      id: id("receipt-line"),
      orgId,
      receiptId,
      batchId,
      qty,
      freeQty: 0,
      rate,
      packSize: spec.mrpUnits,
      discountPercent: "0",
      gstPercent: spec.gst,
      hsnCode: spec.hsn ?? null,
    });
  });
  receiptRows.push({
    id: receiptId,
    orgId,
    opening: false,
    supplierName: delivery.supplier,
    supplierReference: delivery.reference,
    receivedOn: day,
    billTotal,
    receivedBy: userId,
    note: null,
  });
});

/* Stock the counter cannot sell: an expired batch set aside and written off in part,
   breakage, and internal supplies issued to the departments that use them. */
const expiredBatch = productBatches.find((batch) => batch.batchNumber === "PCM-2301")!;

const departmentIds = deptRows.map((dept) => dept.id);

function adjustment(
  batchId: string,
  bucket: "shelf" | "quarantine",
  qty: number,
  reason: NonNullable<(typeof stockMovements.$inferInsert)["reason"]>,
  ago: number,
  extra: { departmentId?: string; note?: string } = {},
) {
  movementRows.push({
    id: id("movement"),
    orgId,
    batchId,
    bucket,
    qty,
    reason,
    sourceType: "adjustment",
    sourceId: id("adjustment"),
    createdBy: userId,
    createdAt: at(dayBefore(ago), 16, 0),
    ...extra,
  });
}

{
  const sourceId = id("adjustment");

  for (const [bucket, qty] of [
    ["shelf", -60],
    ["quarantine", 60],
  ] as const) {
    movementRows.push({
      id: id("movement"),
      orgId,
      batchId: expiredBatch.id,
      bucket,
      qty,
      reason: "quarantine",
      sourceType: "adjustment",
      sourceId,
      createdBy: userId,
      createdAt: at(dayBefore(6), 15, 0),
    });
  }

  adjustment(expiredBatch.id, "quarantine", -20, "writeoff", 3, {
    note: "Expired stock destroyed",
  });
  shelf.find((row) => row.batchId === expiredBatch.id)!.qty = 0;
}

for (const [name, qty, ago, deptIndex] of [
  ["Examination gloves", 20, 21, 0],
  ["Examination gloves", 12, 9, 1],
  ["Disposable syringe 5 ml", 80, 14, 0],
  ["Disposable syringe 5 ml", 40, 5, 6],
  ["Cotton roll 500 g", 4, 11, 1],
  ["Bandage roll 6 inch", 25, 8, 1],
  ["Surgical mask, 3-ply", 100, 12, 4],
] as const) {
  const batch = productBatches.find(
    (row) =>
      row.productId === productRows[PRODUCT_SPECS.findIndex((spec) => spec.name === name)]!.id,
  )!;

  adjustment(batch.id, "shelf", -qty, "internal_issue", ago, {
    departmentId: departmentIds[deptIndex]!,
  });
}

{
  const breakage = productBatches.find((batch) => batch.batchNumber.startsWith("COU"))!;

  adjustment(breakage.id, "shelf", -2, "breakage", 7, { note: "Dropped in store" });
  shelf.find((row) => row.batchId === breakage.id)!.qty -= 2;
}

const deptNameByDoctor = new Map(
  DOCTORS.map((doc, index) => [doctorRows[index]!.id, doc.dept] as const),
);

const DOCTOR_POOL = doctorRows.flatMap((doc) => Array<typeof doc>(doc.share).fill(doc));

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

const PATIENT_COUNT = 420;

/* Showcase list: no repeated full name, and given names come off a shuffled
   deck so a screen of rows reads as varied rather than as random draws. */
function deck<T>(items: readonly T[]): () => T {
  let rest: T[] = [];

  return () => {
    if (rest.length === 0) {
      rest = [...items];

      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));

        [rest[i], rest[j]] = [rest[j]!, rest[i]!];
      }
    }

    return rest.pop()!;
  };
}

const nextFemale = deck(FEMALE_GIVEN);

const nextMale = deck(MALE_GIVEN);

const usedNames = new Set<string>();

const patientRows = Array.from({ length: PATIENT_COUNT }, (_, index) => {
  const female = random() < 0.52;
  const sex: "female" | "male" = female ? "female" : "male";

  let name = "";

  do name = `${female ? nextFemale() : nextMale()} ${pick(FAMILY)}`;
  while (usedNames.has(name));
  usedNames.add(name);

  return {
    id: id("pat"),
    orgId,
    mrn: "",
    name,
    createdAt: at(dayBefore(Math.floor(((PATIENT_COUNT - 1 - index) / PATIENT_COUNT) * 90)), 9, 30),
    phone: `9${between(700000000, 899999999)}`,
    sex,
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
  const deptName = deptNameByDoctor.get(doctor.id)!;
  const pool = procedureItems.filter((_item, index) => PROCEDURES[index]!.depts.includes(deptName));
  const extras = random() < 0.42 && pool.length > 0 ? [pick(pool)] : [];

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

  const subtotal = rows.reduce((sum, row) => sum + row.unitPrice, 0n);
  invoiceRows.push({
    id: invoiceId,
    orgId,
    opdAppointmentId: appointmentId,
    patientId: patient.id,
    invoiceNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    discountAmount: 0n,
    note: null,
    subtotal,
    taxTotal: 0n,
    grandTotal: subtotal,
    orgLegalName: HOSPITAL.legalName,
    orgAddress: HOSPITAL.address,
    orgTaxId: HOSPITAL.taxId,
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
      allocatedDiscount: 0n,
      taxableValue: row.unitPrice,
      taxAmount: 0n,
      gross: row.unitPrice,
      taxRatePercent: "0",
      taxCode: null,
      revenueCategory: row.revenueCategory,
    })),
  );

  if (settlement === "unpaid") return;
  const paid = settlement === "part" ? subtotal / 2n : subtotal;
  paymentRows.push({
    id: id("pay"),
    orgId,
    invoiceId,
    method: pick(["cash", "cash", "upi", "upi", "upi", "card", "bank"] as const),
    amount: paid,
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
  const load = sunday ? between(6, 10) : weekday === 1 ? between(26, 34) : between(18, 27);

  for (let i = 0; i < load; i++) {
    const doctor = pick(DOCTOR_POOL);
    const roll = random();

    // Old days are settled apart from a rare part payment; open money and
    // unbilled charges belong to the last few days, as at a desk that follows up.
    const settlement: Settlement =
      offset > 30
        ? roll < 0.97
          ? "paid"
          : roll < 0.985
            ? "part"
            : "unpaid"
        : offset > 6
          ? roll < 0.96
            ? "paid"
            : "part"
          : roll < 0.82
            ? "paid"
            : roll < 0.9
              ? "part"
              : roll < 0.95 || offset > 3
                ? "unpaid"
                : "unbilled";

    const minuteOfDay = 9 * 60 + Math.floor(random() * 9 * 60);
    visit(day, doctor, {
      patient: nextPatient(),
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      settlement: offset === 0 && random() < 0.15 ? "unbilled" : settlement,
    });
  }

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

const addDays = (day: string, delta: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);

  return date.toISOString().slice(0, 10);
};

const METHODS = ["cash", "cash", "upi", "upi", "upi", "card", "bank"] as const;

/* The pharmacy counter: a sale a few minutes apart, each one a pharmacy-stream
   invoice priced from the batch MRP, with the stock drawn down as it goes. */
const saleRows: (typeof pharmacySales.$inferInsert)[] = [];

const walkInNames = new Set<string>();

while (walkInNames.size < 80) {
  walkInNames.add(`${pick([...MALE_GIVEN, ...FEMALE_GIVEN])} ${pick(FAMILY)}`);
}

const WALK_IN_NAMES = [...walkInNames];

const sellable = PRODUCT_SPECS.flatMap((spec, index) =>
  spec.sold === false || spec.active === false ? [] : [index],
);

for (let offset = HISTORY_DAYS; offset >= 0; offset--) {
  const day = dayBefore(offset);
  const weekday = new Date(`${day}T06:00:00Z`).getUTCDay();
  const count = weekday === 0 ? between(5, 8) : between(14, 24);

  for (let i = 0; i < count; i++) {
    const wanted = new Map<string, number>();

    for (let n = between(1, 4); n > 0; n--) {
      const productIndex = pick(sellable);
      const spec = PRODUCT_SPECS[productIndex]!;
      const qty = pick(spec.sell ?? [1]);

      const batch = shelf
        .filter(
          (row) =>
            row.productIndex === productIndex &&
            row.availableFrom <= day &&
            (row.expiry === null || row.expiry > day) &&
            row.qty >= qty,
        )
        .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"))[0];

      if (batch && !wanted.has(batch.batchId)) {
        wanted.set(batch.batchId, qty);
        batch.qty -= qty;
      }
    }

    if (wanted.size === 0) continue;

    const minuteOfDay = 9 * 60 + Math.floor(random() * 11 * 60);
    const soldAt = at(day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
    const saleId = id("sale");
    const invoiceId = id("inv");
    const patient = random() < 0.6 ? nextPatient() : null;
    const buyerName = patient ? patient.name : pick(WALK_IN_NAMES);
    const buyerPhone = patient ? patient.phone : `9${between(700000000, 899999999)}`;

    const batchRows = [...wanted.entries()].map(([batchId, qty]) => {
      const batch = productBatches.find((row) => row.id === batchId)!;

      return {
        batch,
        spec: batchSpecOf.get(batchId)!,
        qty,
        product: productRows.find((row) => row.id === batch.productId)!,
      };
    });

    const regulated = batchRows.some(
      (row) => row.product.schedule === "h" || row.product.schedule === "h1",
    );

    const prescriber = regulated ? pick(DOCTORS).name : null;

    saleRows.push({
      id: saleId,
      orgId,
      patientId: patient?.id ?? null,
      opdAppointmentId: null,
      buyerName,
      buyerPhone,
      forName: buyerName,
      prescriberName: prescriber,
      prescriptionReference: regulated ? `RX-${between(10000, 99999)}` : null,
      note: null,
      soldBy: userId,
      createdAt: soldAt,
    });

    const chargeIds = batchRows.map(() => id("chg"));

    batchRows.forEach(({ batch, spec, qty, product }, index) => {
      chargeRows.push({
        id: chargeIds[index]!,
        orgId,
        opdAppointmentId: null,
        pharmacySaleId: saleId,
        catalogItemId: null,
        description: `${product.name} · batch ${batch.batchNumber}`,
        unitPrice: batch.mrp,
        priceUnits: batch.mrpUnits,
        taxRatePercent: spec.gst,
        taxCode: spec.hsn ?? null,
        revenueCategory: "pharmacy",
        qty,
        sourceType: "pharmacy_batch",
        sourceId: null,
        stockBatchId: batch.id,
        status: "invoiced",
        invoiceId,
        createdBy: userId,
        createdAt: soldAt,
        updatedAt: soldAt,
      });
      movementRows.push({
        id: id("movement"),
        orgId,
        batchId: batch.id,
        bucket: "shelf",
        qty: -qty,
        reason: "sale",
        sourceType: "pharmacy_sale",
        sourceId: saleId,
        createdBy: userId,
        createdAt: soldAt,
      });
    });

    const computed = computeInvoiceLines(
      batchRows.map(({ batch, spec, qty, product }, index) => ({
        chargeId: chargeIds[index]!,
        description: `${product.name} · batch ${batch.batchNumber}`,
        qty,
        unitPrice: batch.mrp,
        priceUnits: batch.mrpUnits,
        taxRatePercent: spec.gst,
        taxCode: spec.hsn ?? null,
        priceBasis: "inclusive" as const,
      })),
      0n,
      { roundToRupee: roundsToRupee("pharmacy") },
    );

    invoiceRows.push({
      id: invoiceId,
      orgId,
      stream: "pharmacy",
      opdAppointmentId: null,
      pharmacySaleId: saleId,
      patientId: patient?.id ?? null,
      invoiceNumber: "",
      fiscalYear: fyOf(day),
      businessDate: day,
      discountAmount: 0n,
      note: null,
      subtotal: computed.subtotal,
      taxTotal: computed.taxTotal,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal,
      orgLegalName: HOSPITAL.legalName,
      orgAddress: HOSPITAL.address,
      orgTaxId: HOSPITAL.taxId,
      currency: "INR",
      patientName: buyerName,
      patientMrn: patient?.mrn ?? null,
      patientPhone: buyerPhone,
      patientAddress: patient?.address ?? null,
      issuedBy: userId,
      createdAt: soldAt,
    });
    invoiceLineRows.push(
      ...computed.lines.map((line, index) => ({
        id: id("line"),
        orgId,
        invoiceId,
        chargeId: chargeIds[index]!,
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        priceUnits: line.priceUnits,
        lineSubtotal: line.lineSubtotal,
        allocatedDiscount: line.allocatedDiscount,
        taxableValue: line.taxableValue,
        taxAmount: line.taxAmount,
        gross: line.gross,
        taxRatePercent: line.taxRatePercent,
        taxCode: line.taxCode,
        revenueCategory: "pharmacy" as const,
      })),
    );

    // A walk-in has no record to chase, so pays in full; a patient may leave part due.
    const roll = random();
    const owes = patient !== null && offset <= 6 && roll > 0.9;
    const paid = owes ? (roll > 0.96 ? 0n : computed.grandTotal / 2n) : computed.grandTotal;

    if (paid > 0n) {
      paymentRows.push({
        id: id("pay"),
        orgId,
        invoiceId,
        method: pick(METHODS),
        amount: paid,
        reference: null,
        receiptNumber: "",
        fiscalYear: fyOf(day),
        businessDate: day,
        receivedBy: userId,
        createdAt: soldAt,
      });
    }
  }
}

/* Payers, and the patients who carry a policy. */
const payerRows = [
  { name: "Star Health Insurance", type: "insurer" },
  { name: "ICICI Lombard", type: "insurer" },
  { name: "HDFC ERGO", type: "insurer" },
  { name: "Medi Assist", type: "tpa" },
  { name: "Paramount Health", type: "tpa" },
  { name: "Ayushman Bharat PM-JAY", type: "scheme" },
  { name: "Bharat Forge Employees", type: "corporate" },
].map((row) => ({
  id: id("payer"),
  orgId,
  name: row.name,
  // SAFETY: the literals above are exactly the payer types.
  type: row.type as "insurer" | "tpa" | "scheme" | "corporate",
}));

const patientPayerRows = patientRows.slice(0, 60).map((patient, index) => ({
  id: id("patient-payer"),
  orgId,
  patientId: patient.id,
  payerId: payerRows[index % payerRows.length]!.id,
  policyNumber: `POL${between(1000000, 9999999)}`,
  employeeNumber:
    payerRows[index % payerRows.length]!.type === "corporate" ? `EMP${between(1000, 9999)}` : null,
}));

/* Courses of treatment. A few carry an advance, one is complete and one closed. */
const PLAN_SPECS = [
  { dept: "Orthopaedics", items: [["Physiotherapy session", 5000, 10]], next: 2, status: "open" },
  {
    dept: "Dental",
    items: [
      ["Root canal, single sitting", 6500, 2],
      ["Composite filling", 1500, 1],
    ],
    next: 5,
    status: "open",
  },
  { dept: "Dermatology", items: [["Chemical peel", 3500, 4]], next: 8, status: "open" },
  { dept: "Dental", items: [["Scaling and polishing", 1200, 1]], next: null, status: "completed" },
  { dept: "Neurology", items: [["Physiotherapy session", 4000, 8]], next: 1, status: "open" },
  { dept: "Orthopaedics", items: [["Joint injection", 1800, 3]], next: null, status: "closed" },
] as const;

const planRows: (typeof treatmentPlans.$inferInsert)[] = [];

const planItemRows: (typeof treatmentPlanItems.$inferInsert)[] = [];

PLAN_SPECS.forEach((spec, index) => {
  const doctor = doctorRows.find((row) => deptNameByDoctor.get(row.id) === spec.dept)!;
  const patient = patientRows[100 + index * 7]!;
  const planId = id("plan");
  const startedAt = at(dayBefore(12 + index * 4), 11, 0);

  planRows.push({
    id: planId,
    orgId,
    patientId: patient.id,
    practitionerId: doctor.id,
    status: spec.status,
    nextSittingOn: spec.next === null ? null : addDays(today, spec.next),
    nextSittingNote: spec.next === null ? null : "Bring previous reports",
    closeReason: spec.status === "closed" ? "Patient moved to another city" : null,
    completedAt: spec.status === "completed" ? at(dayBefore(2), 12, 0) : null,
    closedAt: spec.status === "closed" ? at(dayBefore(3), 12, 0) : null,
    createdBy: userId,
    createdAt: startedAt,
    updatedAt: startedAt,
  });

  for (const [name, quoted, sittings] of spec.items) {
    const itemIndex = PROCEDURES.findIndex((procedure) => procedure.name === name);
    const item = procedureItems[itemIndex]!;

    planItemRows.push({
      id: id("plan-item"),
      orgId,
      treatmentPlanId: planId,
      catalogItemId: item.id,
      description: item.name,
      quotedPrice: parseDecimal(`${quoted}.00`),
      taxRatePercent: "0",
      taxCode: null,
      revenueCategory: "procedure",
      sittingsPlanned: sittings,
      note: null,
      status: "open",
      createdBy: userId,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
  }
});

/* Advances held for patients: two settle part of an open bill, the rest wait. */
const advanceRows: (typeof advanceReceipts.$inferInsert)[] = [];

const allocationRows: (typeof advanceAllocations.$inferInsert)[] = [];

const refundRows: (typeof refunds.$inferInsert)[] = [];

const patientById2 = new Map(patientRows.map((patient) => [patient.id, patient]));

function advance(
  patientId: string,
  amount: bigint,
  day: string,
  purpose: string,
  planId: string | null,
): string {
  const patient = patientById2.get(patientId)!;
  const advanceId = id("adv");

  advanceRows.push({
    id: advanceId,
    orgId,
    patientId,
    treatmentPlanId: planId,
    method: pick(METHODS),
    amount,
    reference: null,
    note: null,
    purpose,
    receiptNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    orgLegalName: HOSPITAL.legalName,
    orgAddress: HOSPITAL.address,
    orgTaxId: HOSPITAL.taxId,
    currency: "INR",
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientPhone: patient.phone,
    patientAddress: patient.address,
    receivedBy: userId,
    createdAt: at(day, 9, 45),
  });

  return advanceId;
}

const paidInvoiceIds = new Set(paymentRows.map((payment) => payment.invoiceId));

const openOpdInvoices = invoiceRows.filter(
  (invoice) =>
    invoice.stream !== "pharmacy" &&
    invoice.patientId &&
    !paidInvoiceIds.has(invoice.id) &&
    invoice.businessDate >= dayBefore(6),
);

openOpdInvoices.slice(0, 2).forEach((invoice, index) => {
  const held = advance(
    invoice.patientId!,
    invoice.grandTotal + 100_000n,
    invoice.businessDate,
    "Deposit at registration",
    null,
  );

  allocationRows.push({
    id: id("alloc"),
    orgId,
    advanceReceiptId: held,
    invoiceId: invoice.id,
    amount: index === 0 ? invoice.grandTotal : invoice.grandTotal / 2n,
    allocatedBy: userId,
    createdAt: invoice.createdAt,
  });
});

planRows.slice(0, 5).forEach((plan, index) => {
  const held = advance(
    plan.patientId,
    BigInt([200_000, 350_000, 150_000, 600_000, 250_000][index]!) * 1n,
    dayBefore(10 + index * 3),
    "Advance for course of treatment",
    plan.id,
  );

  if (index === 0) {
    refundRows.push({
      id: id("refund"),
      orgId,
      invoiceId: null,
      creditNoteId: null,
      advanceReceiptId: held,
      method: "upi",
      amount: 50_000n,
      reference: null,
      refundNumber: "",
      fiscalYear: fyOf(dayBefore(4)),
      businessDate: dayBefore(4),
      refundedBy: userId,
      createdAt: at(dayBefore(4), 14, 0),
    });
  }
});

/* Credit notes on settled consultations: some already refunded, some still due. */
const creditNoteRows: (typeof creditNotes.$inferInsert)[] = [];

const creditNoteLineRows: (typeof creditNoteLines.$inferInsert)[] = [];

const CREDIT_REASONS = [
  "Charged for a procedure that was not done",
  "Duplicate consultation entered",
  "Patient asked to cancel the procedure",
  "Wrong department billed",
  "Package discount agreed after billing",
];

const methodByInvoice = new Map(paymentRows.map((payment) => [payment.invoiceId, payment.method]));

const creditable = invoiceRows.filter(
  (invoice) =>
    invoice.stream !== "pharmacy" &&
    invoice.businessDate <= dayBefore(2) &&
    invoice.businessDate >= dayBefore(26) &&
    paidInvoiceIds.has(invoice.id) &&
    invoiceLineRows.some((line) => line.invoiceId === invoice.id && line.gross > 0n),
);

for (let i = 0; i < 7; i++) {
  const invoice = creditable[Math.floor((i * creditable.length) / 7)]!;
  const line = invoiceLineRows.find((row) => row.invoiceId === invoice.id)!;
  const creditNoteId = id("cn");
  const day = addDays(invoice.businessDate, 1);

  creditNoteRows.push({
    id: creditNoteId,
    orgId,
    invoiceId: invoice.id,
    creditNoteNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    reason: CREDIT_REASONS[i % CREDIT_REASONS.length]!,
    subtotal: line.taxableValue,
    taxTotal: line.taxAmount,
    roundOff: 0n,
    total: line.gross,
    issuedBy: userId,
    createdAt: at(day, 11, 15),
  });
  creditNoteLineRows.push({
    id: id("cn-line"),
    orgId,
    creditNoteId,
    invoiceLineId: line.id,
    taxableValue: line.taxableValue,
    taxAmount: line.taxAmount,
    gross: line.gross,
  });

  if (i < 4) {
    refundRows.push({
      id: id("refund"),
      orgId,
      invoiceId: invoice.id,
      creditNoteId,
      advanceReceiptId: null,
      method: methodByInvoice.get(invoice.id) ?? "cash",
      amount: line.gross,
      reference: null,
      refundNumber: "",
      fiscalYear: fyOf(day),
      businessDate: day,
      refundedBy: userId,
      createdAt: at(day, 15, 30),
    });
  }
}

class DryRun extends Error {}

// IPD: three wards, a handful of current admissions (one moved out of ICU, some ready
// to leave), past stays, one cancelled admission and two blocked beds. Each bed's
// stays never overlap, as the app enforces.
const HOUR_MS = 60 * 60 * 1_000;

const ipdTimeZone = settings.timeZone;

const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);

const ipdServices = [
  {
    key: "general",
    ward: "General Ward",
    category: "General bed",
    prefix: "GW-",
    beds: 12,
    price: "1500.00",
  },
  {
    key: "private",
    ward: "Private Rooms",
    category: "Private room",
    prefix: "P-",
    beds: 6,
    price: "4000.00",
  },
  { key: "icu", ward: "ICU", category: "ICU bed", prefix: "ICU-", beds: 4, price: "9000.00" },
] as const;

const ipdItems = ipdServices.map((service) => ({
  id: id("item"),
  orgId,
  name: `${service.category} day`,
  category: "other" as const,
  unitPrice: parseDecimal(service.price),
  taxRatePercent: "0",
  taxCode: null,
  active: true,
}));

const wardRows = ipdServices.map((service) => ({ id: id("ward"), orgId, name: service.ward }));

const bedCategoryRows = ipdServices.map((service) => ({
  id: id("bedcat"),
  orgId,
  name: service.category,
}));

const tariffRows = ipdServices.map((service, index) => ({
  id: id("tariff"),
  orgId,
  categoryId: bedCategoryRows[index]!.id,
  catalogItemId: ipdItems[index]!.id,
  dailyPrice: parseDecimal(service.price),
  effectiveFrom: hoursAgo(24 * 120),
  createdBy: userId,
}));

type SeedBed = typeof beds.$inferInsert & { id: string };

const bedRows = ipdServices.flatMap((service, index): SeedBed[] =>
  Array.from({ length: service.beds }, (_, n) => ({
    id: id("bed"),
    orgId,
    wardId: wardRows[index]!.id,
    categoryId: bedCategoryRows[index]!.id,
    label:
      service.key === "private"
        ? `${service.prefix}${101 + n}`
        : `${service.prefix}${String(n + 1).padStart(2, "0")}`,
    active: true,
  })),
);

const bedsOf = (key: (typeof ipdServices)[number]["key"]) =>
  bedRows.filter((bed) => bed.wardId === wardRows[ipdServices.findIndex((s) => s.key === key)]!.id);

const tariffOf = (bed: (typeof bedRows)[number]) =>
  tariffRows.find((tariff) => tariff.categoryId === bed.categoryId)!;

const admissionRows: (typeof admissions.$inferInsert)[] = [];

const stayRows: (typeof admissionBedStays.$inferInsert)[] = [];

const ipdPatients = patientRows.slice(0, 40)[Symbol.iterator]();

function ipdAdmission(
  stays: { bed: (typeof bedRows)[number]; from: Date; to: Date | null }[],
  end: { status: "admitted" | "discharge_ready" | "discharged" | "cancelled"; readyAt?: Date },
) {
  const patient = ipdPatients.next().value;

  if (!patient) throw new Error("Seed ran out of IPD patients");

  const admissionId = id("adm");
  const last = stays.at(-1)!;
  const doctor = doctorRows[admissionRows.length % doctorRows.length]!;

  const admission = {
    id: admissionId,
    orgId,
    patientId: patient.id,
    practitionerId: doctor.id,
    status: end.status,
    admittedAt: stays[0]!.from,
    readyAt: end.readyAt ?? null,
    dischargedAt: end.status === "discharged" ? last.to : null,
    cancelledAt: end.status === "cancelled" ? last.to : null,
    cancelReason: end.status === "cancelled" ? "Admitted under the wrong Patient" : null,
    timeZone: ipdTimeZone,
    revision:
      stays.length -
      1 +
      (end.readyAt ? 1 : 0) +
      (end.status === "discharged" || end.status === "cancelled" ? 1 : 0),
    createdBy: userId,
    createdAt: stays[0]!.from,
  } satisfies typeof admissions.$inferInsert;

  admissionRows.push(admission);

  for (const stay of stays) {
    const tariff = tariffOf(stay.bed);
    stayRows.push({
      id: id("stay"),
      orgId,
      admissionId,
      bedId: stay.bed.id,
      tariffId: tariff.id,
      dailyPrice: tariff.dailyPrice,
      startedAt: stay.from,
      endedAt: stay.to,
      createdBy: userId,
      createdAt: stay.from,
    });
  }

  return admission;
}

/* IPD Slice 1: medicines issued to the ward and services posted against a stay, as
   pending Admission Charges that the stay's single ipd Invoice later bills. The demo
   hospital has no GSTIN, so it adds no GST and every ward medicine is bundled (D063):
   services are priced without tax and medicine keeps its MRP. */
const issueRows: (typeof admissionPharmacyIssues.$inferInsert)[] = [];

const issueLineRows: (typeof admissionPharmacyIssueLines.$inferInsert)[] = [];

const roomSupplementItem = {
  id: id("item"),
  orgId,
  name: "Deluxe room supplement",
  category: "other" as const,
  unitPrice: parseDecimal("1200.00"),
  taxRatePercent: "0.00",
  taxCode: "996311",
  active: true,
};

type SeedAdmission = (typeof admissionRows)[number];

const doctorOf = (admission: SeedAdmission) =>
  doctorRows.find((doctor) => doctor.id === admission.practitionerId)!;

function wardBatch(name: string, qty: number) {
  const productIndex = PRODUCT_SPECS.findIndex((spec) => spec.name === name);

  const row = shelf
    .filter(
      (batch) =>
        batch.productIndex === productIndex &&
        (batch.expiry === null || batch.expiry > today) &&
        batch.qty >= qty,
    )
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"))[0];

  if (!row) throw new Error(`Seed has no ${name} on the shelf for the ward`);
  row.qty -= qty;

  return {
    batch: productBatches.find((batch) => batch.id === row.batchId)!,
    spec: PRODUCT_SPECS[productIndex]!,
    product: productRows[productIndex]!,
  };
}

function issueToWard(
  admission: SeedAdmission,
  issuedAt: Date,
  lines: { name: string; qty: number; supply: "bundled" | "independent" }[],
) {
  const issueId = id("issue");

  issueRows.push({
    id: issueId,
    orgId,
    admissionId: admission.id,
    prescriberName: doctorOf(admission).name,
    issuedBy: userId,
    createdAt: issuedAt,
  });

  for (const line of lines) {
    const { batch, spec, product } = wardBatch(line.name, line.qty);
    const lineId = id("issue-line");

    issueLineRows.push({
      id: lineId,
      orgId,
      issueId,
      admissionId: admission.id,
      batchId: batch.id!,
      qty: line.qty,
      supply: line.supply,
    });
    chargeRows.push({
      id: id("chg"),
      orgId,
      admissionId: admission.id,
      admissionKind: "pharmacy_issue",
      admissionIssueLineId: lineId,
      catalogItemId: null,
      description: admissionIssueDescription({
        name: product.name,
        batchNumber: batch.batchNumber!,
        expiryDate: batch.expiryDate ?? null,
      }),
      unitPrice: batch.mrp!,
      priceUnits: batch.mrpUnits,
      taxRatePercent: line.supply === "independent" ? spec.gst : "0.00",
      taxCode: spec.hsn ?? null,
      priceBasis: "inclusive",
      revenueCategory: "pharmacy",
      qty: line.qty,
      sourceType: "admission",
      sourceId: admission.id,
      stockBatchId: batch.id!,
      status: "pending",
      createdBy: userId,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
    movementRows.push({
      id: id("movement"),
      orgId,
      batchId: batch.id!,
      bucket: "shelf",
      qty: -line.qty,
      reason: "admission_issue",
      sourceType: "admission_pharmacy_issue_line",
      sourceId: lineId,
      createdBy: userId,
      createdAt: issuedAt,
    });
  }

  admission.chargeRevision = (admission.chargeRevision ?? 0) + 1;
}

function postWardServices(
  admission: SeedAdmission,
  postedAt: Date,
  lines: { item: (typeof procedureItems)[number] | typeof roomSupplementItem; qty: number }[],
) {
  for (const { item, qty } of lines) {
    chargeRows.push({
      id: id("chg"),
      orgId,
      admissionId: admission.id,
      admissionKind: "service",
      catalogItemId: item.id,
      description: item.name,
      unitPrice: item.unitPrice,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
      priceBasis: "exclusive",
      revenueCategory: item.category,
      qty,
      sourceType: "admission",
      sourceId: admission.id,
      status: "pending",
      createdBy: userId,
      createdAt: postedAt,
      updatedAt: postedAt,
    });
  }

  admission.chargeRevision = (admission.chargeRevision ?? 0) + 1;
}

// The stay's one ipd Invoice from its pending Charges, paid in full at the desk.
function billAdmission(admission: SeedAdmission, issuedAt: Date) {
  const invoiceId = id("inv");
  const day = businessDate(issuedAt, ipdTimeZone);
  const patient = patientRows.find((row) => row.id === admission.patientId)!;

  const pending = chargeRows
    .filter((charge) => charge.admissionId === admission.id && charge.status === "pending")
    .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime() || a.id!.localeCompare(b.id!));

  const computed = computeInvoiceLines(
    pending.map((charge) => ({
      chargeId: charge.id!,
      description: charge.description,
      qty: charge.qty!,
      unitPrice: charge.unitPrice,
      priceUnits: charge.priceUnits ?? 1,
      taxRatePercent: charge.taxRatePercent,
      taxCode: charge.taxCode ?? null,
      priceBasis: charge.priceBasis,
    })),
    0n,
    { roundToRupee: roundsToRupee("ipd") },
  );

  for (const charge of pending) {
    charge.status = "invoiced";
    charge.invoiceId = invoiceId;
    charge.updatedAt = issuedAt;
  }

  invoiceRows.push({
    id: invoiceId,
    orgId,
    stream: "ipd",
    admissionId: admission.id,
    patientId: patient.id,
    invoiceNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    discountAmount: 0n,
    note: null,
    subtotal: computed.subtotal,
    taxTotal: computed.taxTotal,
    addedTaxTotal: computed.addedTaxTotal,
    roundOff: computed.roundOff,
    grandTotal: computed.grandTotal,
    orgLegalName: HOSPITAL.legalName,
    orgAddress: HOSPITAL.address,
    orgTaxId: HOSPITAL.taxId,
    orgGstin: settings.gstin,
    currency: "INR",
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientPhone: patient.phone,
    patientAddress: patient.address,
    issuedBy: userId,
    createdAt: issuedAt,
  });
  invoiceLineRows.push(
    ...computed.lines.map((line, index) => ({
      id: id("line"),
      orgId,
      invoiceId,
      chargeId: line.chargeId,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      priceUnits: line.priceUnits,
      lineSubtotal: line.lineSubtotal,
      allocatedDiscount: line.allocatedDiscount,
      taxableValue: line.taxableValue,
      taxAmount: line.taxAmount,
      gross: line.gross,
      taxRatePercent: line.taxRatePercent,
      taxCode: line.taxCode,
      priceBasis: line.priceBasis,
      revenueCategory: pending[index]!.revenueCategory,
    })),
  );
  paymentRows.push({
    id: id("pay"),
    orgId,
    invoiceId,
    method: "upi",
    amount: computed.grandTotal,
    reference: null,
    receiptNumber: "",
    fiscalYear: fyOf(day),
    businessDate: day,
    receivedBy: userId,
    createdAt: issuedAt,
  });

  admission.chargeRevision = (admission.chargeRevision ?? 0) + 1;
}

{
  const general = bedsOf("general");
  const privateRooms = bedsOf("private");
  const icu = bedsOf("icu");

  // Past stays on the first four general beds, all ended weeks ago.
  for (const [n, bed] of general.slice(0, 4).entries()) {
    const from = hoursAgo(24 * (40 - n * 2) + 3 * n);
    ipdAdmission([{ bed, from, to: new Date(from.getTime() + 24 * (2 + n) * HOUR_MS) }], {
      status: "discharged",
      readyAt: new Date(from.getTime() + 24 * (2 + n) * HOUR_MS - 3 * HOUR_MS),
    });
    const later = hoursAgo(24 * (24 - n));
    ipdAdmission([{ bed, from: later, to: new Date(later.getTime() + 24 * 4 * HOUR_MS) }], {
      status: "discharged",
      readyAt: new Date(later.getTime() + 24 * 4 * HOUR_MS - 2 * HOUR_MS),
    });
  }

  // Left a few hours ago; the bed waits for cleaning.
  const leftToday = ipdAdmission([{ bed: general[2]!, from: hoursAgo(24 * 5), to: hoursAgo(3) }], {
    status: "discharged",
    readyAt: hoursAgo(6),
  });

  general[2]!.blockedAt = hoursAgo(3);
  general[2]!.blockedReason = "Awaiting cleaning after discharge";

  icu[3]!.blockedAt = hoursAgo(30);
  icu[3]!.blockedReason = "Ventilator under service";

  // In hospital now.
  for (const [n, bed] of general.slice(4, 11).entries()) {
    ipdAdmission(
      [{ bed, from: hoursAgo(10 + n * 17), to: null }],
      n % 3 === 1
        ? { status: "discharge_ready", readyAt: hoursAgo(2 + n) }
        : { status: "admitted" },
    );
  }

  for (const [n, bed] of privateRooms.slice(0, 3).entries()) {
    ipdAdmission([{ bed, from: hoursAgo(20 + n * 30), to: null }], { status: "admitted" });
  }

  ipdAdmission([{ bed: icu[0]!, from: hoursAgo(14), to: null }], { status: "admitted" });

  // Stepped down from ICU to a private room two days ago.
  const steppedDown = ipdAdmission(
    [
      { bed: icu[2]!, from: hoursAgo(24 * 6), to: hoursAgo(48) },
      { bed: privateRooms[3]!, from: hoursAgo(48), to: null },
    ],
    { status: "admitted" },
  );

  ipdAdmission([{ bed: privateRooms[4]!, from: hoursAgo(24 * 10), to: hoursAgo(24 * 10 - 0.3) }], {
    status: "cancelled",
  });

  // Still in the ward: two issues and a service, all waiting for the bill.
  issueToWard(steppedDown, hoursAgo(100), [
    { name: "Paracetamol 500 mg", qty: 20, supply: "bundled" },
  ]);
  issueToWard(steppedDown, hoursAgo(30), [
    { name: "Pantoprazole 40 mg", qty: 10, supply: "bundled" },
  ]);
  postWardServices(steppedDown, hoursAgo(20), [{ item: roomSupplementItem, qty: 2 }]);

  // Ready to leave: one service and one bundled medicine, ready to bill.
  const readyToBill = admissionRows.find((row) => row.status === "discharge_ready")!;
  issueToWard(readyToBill, new Date(readyToBill.admittedAt.getTime() + 2 * HOUR_MS), [
    { name: "Paracetamol 500 mg", qty: 10, supply: "bundled" },
  ]);
  postWardServices(readyToBill, new Date(readyToBill.admittedAt.getTime() + 4 * HOUR_MS), [
    { item: procedureItems[1]!, qty: 2 },
  ]);

  // Left today with the bill issued and paid: a service priced before tax and two
  // medicines at MRP on one ipd Invoice.
  issueToWard(leftToday, hoursAgo(100), [
    { name: "Paracetamol 500 mg", qty: 20, supply: "bundled" },
    { name: "Pantoprazole 40 mg", qty: 15, supply: "bundled" },
  ]);
  postWardServices(leftToday, hoursAgo(30), [{ item: roomSupplementItem, qty: 3 }]);
  billAdmission(leftToday, hoursAgo(4));
}

/* Future bed reservations: two holds arriving soon, two waiting-list requests, one hold
   whose bed went for maintenance, one lapsed hold, one cancelled and one already
   admitted. Holds sit on beds that are free and unblocked now, as the app requires. */
const reservationRows: (typeof bedReservations.$inferInsert)[] = [];

{
  const general = bedsOf("general");
  const privateRooms = bedsOf("private");
  const icu = bedsOf("icu");
  const hoursAhead = (hours: number) => hoursAgo(-hours);

  // Patients past the IPD block, so no reservation collides with a seeded stay.
  const [arriving, arrivingTomorrow, waiting, waitingIcu, disrupted, lapsed, cancelled] =
    patientRows.slice(40, 47);

  const reserve = (
    patient: (typeof patientRows)[number] | undefined,
    bed: (typeof bedRows)[number] | null,
    categoryKey: (typeof ipdServices)[number]["key"],
    window: { from: Date; to: Date; holdUntil: Date | null },
    state: Partial<typeof bedReservations.$inferInsert> &
      Pick<typeof bedReservations.$inferInsert, "status">,
  ) => {
    if (!patient) throw new Error("Seed ran out of patients for reservations");
    reservationRows.push({
      id: id("resv"),
      orgId,
      patientId: patient.id,
      categoryId: bedCategoryRows[ipdServices.findIndex((s) => s.key === categoryKey)]!.id,
      bedId: bed?.id ?? null,
      plannedArrivalAt: window.from,
      plannedDepartureAt: window.to,
      holdUntil: window.holdUntil,
      createdBy: userId,
      createdAt: hoursAgo(48),
      ...state,
    });
  };

  reserve(
    arriving,
    general[0]!,
    "general",
    { from: hoursAhead(3), to: hoursAhead(3 + 24 * 3), holdUntil: hoursAhead(7) },
    { status: "confirmed", revision: 1 },
  );
  reserve(
    arrivingTomorrow,
    privateRooms[5]!,
    "private",
    { from: hoursAhead(26), to: hoursAhead(26 + 24 * 4), holdUntil: hoursAhead(30) },
    { status: "confirmed", revision: 1 },
  );
  reserve(
    waiting,
    null,
    "general",
    { from: hoursAhead(24 * 2), to: hoursAhead(24 * 5), holdUntil: null },
    { status: "requested" },
  );
  reserve(
    waitingIcu,
    null,
    "icu",
    { from: hoursAhead(24 * 3), to: hoursAhead(24 * 6), holdUntil: null },
    { status: "requested" },
  );
  reserve(
    disrupted,
    icu[3]!,
    "icu",
    { from: hoursAhead(20), to: hoursAhead(20 + 24 * 2), holdUntil: hoursAhead(24) },
    { status: "disrupted", revision: 2, disruptedReason: "Ventilator under service" },
  );
  reserve(
    lapsed,
    general[1]!,
    "general",
    { from: hoursAgo(10), to: hoursAhead(24 * 2), holdUntil: hoursAgo(4) },
    { status: "confirmed", revision: 1 },
  );
  reserve(
    cancelled,
    null,
    "private",
    { from: hoursAhead(24 * 4), to: hoursAhead(24 * 7), holdUntil: null },
    { status: "cancelled", revision: 1, cancelReason: "Surgery postponed by the Patient" },
  );

  // The ICU Patient admitted 14 hours ago came in on a hold for that bed.
  const icuStay = stayRows.find((stay) => stay.bedId === icu[0]!.id && stay.endedAt === null)!;
  const icuAdmission = admissionRows.find((row) => row.id === icuStay.admissionId)!;
  reserve(
    patientRows.find((row) => row.id === icuAdmission.patientId),
    icu[0]!,
    "icu",
    {
      from: new Date(icuAdmission.admittedAt.getTime() - 2 * HOUR_MS),
      to: new Date(icuAdmission.admittedAt.getTime() + 24 * 3 * HOUR_MS),
      holdUntil: new Date(icuAdmission.admittedAt.getTime() + 2 * HOUR_MS),
    },
    { status: "converted", revision: 2, admissionId: icuAdmission.id },
  );
}

/* Theatre schedule: two operating theatres, a procedure room and four named units.
   Today and tomorrow carry three confirmed cases that clash on no room, unit or
   consultant, two drafts, one case put out by the workstation's service and one
   cancelled. Booking writes no Charge, so nothing here touches billing. */
const ot1 = id("otroom");

const ot2 = id("otroom");

const procedureRoom = id("otroom");

const roomRows: (typeof theatreRooms.$inferInsert)[] = [
  { id: ot1, orgId, name: "OT 1", kind: "operating_theatre" },
  { id: ot2, orgId, name: "OT 2", kind: "operating_theatre" },
  { id: procedureRoom, orgId, name: "Procedure room", kind: "procedure_room" },
];

const cArm = id("unit");

const workstation1 = id("unit");

const workstation2 = id("unit");

const unitRows: (typeof equipmentUnits.$inferInsert)[] = [
  { id: cArm, orgId, name: "C-arm 1", kind: "C-arm" },
  { id: id("unit"), orgId, name: "Laparoscopy tower 1", kind: "Laparoscopy tower" },
  { id: workstation1, orgId, name: "Anaesthesia workstation 1", kind: "Anaesthesia workstation" },
  { id: workstation2, orgId, name: "Anaesthesia workstation 2", kind: "Anaesthesia workstation" },
];

const resourceBlockRows: (typeof resourceBlocks.$inferInsert)[] = [];

const caseRows: (typeof surgicalCases.$inferInsert)[] = [];

const caseEquipmentRows: (typeof surgicalCaseEquipment.$inferInsert)[] = [];

{
  const tomorrow = addDays(today, 1);

  const MINUTE_MS = 60_000;

  // Today's first slot: the next half hour at least an hour from now.
  const soon = new Date(Math.ceil((now.getTime() + HOUR_MS) / (30 * MINUTE_MS)) * 30 * MINUTE_MS);

  const later = (minutes: number) => new Date(soon.getTime() + minutes * MINUTE_MS);

  const doctor = (name: string) => doctorRows.find((row) => row.name === name)!;

  const procedure = (name: string) =>
    procedureItems[PROCEDURES.findIndex((row) => row.name === name)]!;

  const [biopsyPatient, endoscopyPatient, nasalPatient, iucdPatient, postponedPatient] =
    patientRows.slice(47, 52);

  const inWard = admissionRows.find((row) => row.status === "admitted")!;

  const tomorrowsHold = reservationRows[1]!;

  // The cast follows the patient's arrival on the hold, whatever the hour of seeding.
  const afterArrival = new Date(tomorrowsHold.plannedArrivalAt.getTime() + 2 * HOUR_MS);

  resourceBlockRows.push(
    {
      id: id("block"),
      orgId,
      equipmentId: workstation2,
      startsAt: hoursAgo(5),
      endsAt: hoursAgo(-30),
      reason: "Annual service by the vendor",
      createdBy: userId,
      createdAt: hoursAgo(5),
    },
    {
      id: id("block"),
      orgId,
      roomId: procedureRoom,
      startsAt: at(addDays(today, 2), 8, 0),
      endsAt: at(addDays(today, 2), 13, 0),
      reason: "Air-handling filter change",
      createdBy: userId,
      createdAt: hoursAgo(24),
    },
  );

  const book = (
    patientId: string | undefined,
    consultant: string,
    procedureName: string,
    plan: { roomId: string | null; from: Date; to: Date; prep: number; cleanup: number },
    unitIds: string[],
    state: Partial<typeof surgicalCases.$inferInsert> &
      Pick<typeof surgicalCases.$inferInsert, "status">,
  ) => {
    if (!patientId) throw new Error("Seed ran out of patients for theatre cases");

    const caseId = id("case");

    caseRows.push({
      id: caseId,
      orgId,
      patientId,
      practitionerId: doctor(consultant).id,
      procedureItemId: procedure(procedureName).id,
      procedureName,
      roomId: plan.roomId,
      plannedStartAt: plan.from,
      plannedEndAt: plan.to,
      prepMinutes: plan.prep,
      cleanupMinutes: plan.cleanup,
      createdBy: userId,
      createdAt: hoursAgo(30),
      ...state,
    });

    for (const equipmentId of unitIds) caseEquipmentRows.push({ orgId, caseId, equipmentId });
  };

  // Confirmed: three rooms, three consultants, and no unit booked twice at once.
  book(
    inWard.patientId,
    "Dr. Suresh Iyer",
    "Joint injection",
    { roomId: ot1, from: soon, to: later(90), prep: 30, cleanup: 30 },
    [cArm, workstation1],
    { status: "confirmed", revision: 2, admissionId: inWard.id },
  );
  book(
    endoscopyPatient?.id,
    "Dr. Imran Shaikh",
    "Upper GI endoscopy",
    { roomId: procedureRoom, from: later(60), to: later(105), prep: 15, cleanup: 15 },
    [],
    { status: "confirmed", revision: 1 },
  );
  book(
    nasalPatient?.id,
    "Dr. Kavya Pillai",
    "Nasal endoscopy",
    { roomId: ot2, from: at(tomorrow, 9, 0), to: at(tomorrow, 10, 30), prep: 30, cleanup: 30 },
    [workstation1],
    { status: "confirmed", revision: 1 },
  );

  // Drafts hold nothing; the second waits on tomorrow's private-room hold.
  book(
    iucdPatient?.id,
    "Dr. Sunita Bhat",
    "IUCD insertion",
    { roomId: ot2, from: at(tomorrow, 14, 0), to: at(tomorrow, 15, 0), prep: 15, cleanup: 15 },
    [],
    { status: "draft" },
  );
  book(
    tomorrowsHold.patientId,
    "Dr. Suresh Iyer",
    "Plaster cast, forearm",
    {
      roomId: null,
      from: afterArrival,
      to: new Date(afterArrival.getTime() + HOUR_MS),
      prep: 15,
      cleanup: 15,
    },
    [cArm],
    {
      status: "draft",
      bedReservationId: tomorrowsHold.id,
      notes: "Arrives on the private-room hold",
    },
  );

  // The workstation went for service over this case, so it needs a new slot.
  book(
    biopsyPatient?.id,
    "Dr. Nadia Qureshi",
    "Skin biopsy",
    { roomId: ot2, from: later(120), to: later(180), prep: 15, cleanup: 15 },
    [workstation2],
    {
      status: "disrupted",
      revision: 2,
      disruptedReason: "Anaesthesia workstation 2 is under service",
    },
  );
  book(
    postponedPatient?.id,
    "Dr. Sunita Bhat",
    "IUCD insertion",
    { roomId: ot1, from: at(tomorrow, 11, 0), to: at(tomorrow, 11, 45), prep: 15, cleanup: 15 },
    [],
    { status: "cancelled", revision: 2, cancelReason: "Patient asked to postpone" },
  );
}

const seeding = db.transaction(async (tx) => {
  // Bulk inserts to a remote server can outlast the app's 15s statement timeout.
  await tx.execute(sql`set local statement_timeout = 0`);

  if (!targetSlug) {
    await tx.update(user).set({ name: "Priya Nair" }).where(eq(user.id, userId));
    await tx.update(organization).set({ name: HOSPITAL.name }).where(eq(organization.id, orgId));
    await tx
      .update(organizationSettings)
      .set({ legalName: HOSPITAL.legalName, address: HOSPITAL.address, taxId: HOSPITAL.taxId })
      .where(eq(organizationSettings.orgId, orgId));
  }

  // Locally only `demo-` rows go; a target org's activity is cleared with them.
  const replaced = <T extends { orgId: AnyColumn; id: AnyColumn }>(table: T) =>
    targetSlug ? eq(table.orgId, orgId) : and(eq(table.orgId, orgId), like(table.id, "demo-%"));

  // Demo journals are found by the demo document they post.
  const journalScope = targetSlug
    ? eq(journalEntries.orgId, orgId)
    : and(eq(journalEntries.orgId, orgId), like(journalEntries.sourceId, "demo-%"));

  const demoJournals = tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(journalScope);

  await tx
    .delete(journalLines)
    .where(and(eq(journalLines.orgId, orgId), inArray(journalLines.entryId, demoJournals)));
  await tx.delete(journalEntries).where(journalScope);

  await tx
    .delete(surgicalCaseEquipment)
    .where(
      targetSlug
        ? eq(surgicalCaseEquipment.orgId, orgId)
        : and(eq(surgicalCaseEquipment.orgId, orgId), like(surgicalCaseEquipment.caseId, "demo-%")),
    );

  for (const table of [
    surgicalCases,
    resourceBlocks,
    equipmentUnits,
    theatreRooms,
    refunds,
    advanceAllocations,
    creditNoteLines,
    creditNotes,
    advanceReceipts,
    payments,
    invoiceLines,
    charges,
    invoices,
    bedReservations,
    admissionPharmacyIssueLines,
    admissionPharmacyIssues,
    admissionBedStays,
    admissions,
    bedTariffs,
    beds,
    bedCategories,
    wards,
    pharmacySales,
    stockMovements,
    goodsReceiptLines,
    stockBatches,
    goodsReceipts,
    products,
    treatmentPlanItems,
    treatmentPlans,
    patientPayers,
    payers,
    opdAppointments,
    patients,
    practitioners,
    departments,
    catalogItems,
  ]) {
    await tx.delete(table).where(replaced(table));
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

  // Documents are numbered in the order they were issued, as the app would have.
  const issued = (row: { createdAt?: Date | null }) => row.createdAt?.getTime() ?? 0;

  const invoiceSeries = {
    opd: { counter: "invoice:", prefix: settings.invoicePrefix },
    pharmacy: { counter: "invoice:pharmacy:", prefix: settings.pharmacyInvoicePrefix },
    ipd: { counter: "invoice:ipd:", prefix: settings.ipdInvoicePrefix },
  };

  for (const invoice of [...invoiceRows].sort((a, b) => issued(a) - issued(b))) {
    const pharmacy = invoice.stream === "pharmacy";
    const series = invoiceSeries[invoice.stream ?? "opd"];
    const sequence = await nextCounter(tx, orgId, `${series.counter}${invoice.fiscalYear}`);

    invoice.invoiceNumber = documentNumber(series.prefix, invoice.fiscalYear, sequence);

    const patient = invoice.patientId ? patientById.get(invoice.patientId) : undefined;

    if (!pharmacy && !patient) throw new Error(`Seed invoice ${invoice.id} has no patient`);
    invoice.patientMrn = patient?.mrn ?? null;
  }

  for (const payment of [...paymentRows].sort((a, b) => issued(a) - issued(b))) {
    const sequence = await nextCounter(tx, orgId, `receipt:${payment.fiscalYear}`);
    payment.receiptNumber = documentNumber(settings.receiptPrefix, payment.fiscalYear, sequence);
  }

  for (const note of creditNoteRows) {
    const sequence = await nextCounter(tx, orgId, `creditNote:${note.fiscalYear}`);
    note.creditNoteNumber = documentNumber(settings.creditNotePrefix, note.fiscalYear, sequence);
  }

  for (const receipt of advanceRows) {
    const sequence = await nextCounter(tx, orgId, `advance:${receipt.fiscalYear}`);
    receipt.receiptNumber = documentNumber(
      settings.advanceReceiptPrefix,
      receipt.fiscalYear,
      sequence,
    );
    receipt.patientMrn = patientById.get(receipt.patientId)!.mrn;
  }

  for (const refund of refundRows) {
    const sequence = await nextCounter(tx, orgId, `refund:${refund.fiscalYear}`);
    refund.refundNumber = documentNumber("RF", refund.fiscalYear, sequence);
  }

  // Postgres caps one statement at 65,535 parameters, so big tables go in batches.
  async function insertAll<Row extends Record<string, unknown>>(
    table: Parameters<typeof tx.insert>[0],
    rows: Row[],
  ) {
    for (let from = 0; from < rows.length; from += 400) {
      // SAFETY: each caller passes rows built as that table's insert type.
      await tx.insert(table).values(rows.slice(from, from + 400) as never);
    }
  }

  await insertAll(catalogItems, [
    ...consultItems,
    ...procedureItems,
    ...ipdItems,
    roomSupplementItem,
  ]);
  await insertAll(
    departments,
    deptRows.map(({ share: _share, ...row }) => row),
  );
  await insertAll(
    practitioners,
    doctorRows.map(({ share: _share, ...row }) => row),
  );
  await insertAll(patients, patientRows);
  await insertAll(payers, payerRows);
  await insertAll(patientPayers, patientPayerRows);
  await insertAll(opdAppointments, appointmentRows);
  await insertAll(products, productRows);
  await insertAll(goodsReceipts, receiptRows);
  await insertAll(stockBatches, productBatches);
  await insertAll(wards, wardRows);
  await insertAll(bedCategories, bedCategoryRows);
  await insertAll(beds, bedRows);
  await insertAll(bedTariffs, tariffRows);
  await insertAll(admissions, admissionRows);
  await insertAll(admissionBedStays, stayRows);
  await insertAll(bedReservations, reservationRows);
  await insertAll(theatreRooms, roomRows);
  await insertAll(equipmentUnits, unitRows);
  await insertAll(resourceBlocks, resourceBlockRows);
  await insertAll(surgicalCases, caseRows);
  await insertAll(surgicalCaseEquipment, caseEquipmentRows);
  await insertAll(admissionPharmacyIssues, issueRows);
  await insertAll(admissionPharmacyIssueLines, issueLineRows);
  await insertAll(pharmacySales, saleRows);
  await insertAll(invoices, invoiceRows);
  await insertAll(charges, chargeRows);
  await insertAll(invoiceLines, invoiceLineRows);
  await insertAll(payments, paymentRows);
  await insertAll(creditNotes, creditNoteRows);
  await insertAll(creditNoteLines, creditNoteLineRows);
  await insertAll(treatmentPlans, planRows);
  await insertAll(treatmentPlanItems, planItemRows);
  await insertAll(advanceReceipts, advanceRows);
  await insertAll(advanceAllocations, allocationRows);
  await insertAll(refunds, refundRows);
  await insertAll(goodsReceiptLines, receiptLineRows);
  await insertAll(stockMovements, movementRows);

  // The same balanced entries the billing documents post in the app, so the trial
  // balance and balance sheet agree with the seeded invoices and receipts.
  const entry = (
    row: { id?: string; createdAt?: Date | null },
    sourceType: string,
    narration: string,
    lines: Parameters<typeof postJournalEntries>[2][number]["lines"],
  ) => {
    if (!row.id || !row.createdAt) throw new Error(`Seed ${sourceType} has no id or time`);

    return {
      sourceType,
      sourceId: row.id,
      narration,
      createdBy: userId,
      now: row.createdAt,
      timeZone: settings.timeZone,
      lines,
    };
  };

  const revenueLines = (
    rows: { revenueCategory: Parameters<typeof revenueAccountFor>[0]; taxableValue: bigint }[],
    side: "debit" | "credit",
  ) => {
    const byAccount = new Map<ReturnType<typeof revenueAccountFor>, bigint>();

    for (const row of rows) {
      const account = revenueAccountFor(row.revenueCategory);
      byAccount.set(account, (byAccount.get(account) ?? 0n) + row.taxableValue);
    }

    return [...byAccount].map(([account, amount]) => ({ account, [side]: amount }));
  };

  const roundOffLine = (roundOff: bigint, side: "debit" | "credit") => {
    if (roundOff === 0n) return [];
    const other = side === "debit" ? "credit" : "debit";

    return [
      {
        account: "round_off" as const,
        [roundOff > 0n ? side : other]: roundOff > 0n ? roundOff : -roundOff,
      },
    ];
  };

  const linesByInvoice = Map.groupBy(invoiceLineRows, (line) => line.invoiceId);
  const lineById = new Map(invoiceLineRows.map((line) => [line.id, line]));
  const notesLines = Map.groupBy(creditNoteLineRows, (line) => line.creditNoteId);

  const invoiceNumberById = new Map(
    invoiceRows.map((invoice) => [invoice.id, invoice.invoiceNumber]),
  );

  const journals = [
    // A zero invoice with no round-off posts nothing, as in the app.
    ...invoiceRows.flatMap((invoice) =>
      invoice.grandTotal > 0n || (invoice.roundOff ?? 0n) !== 0n
        ? [
            entry(invoice, "invoice", `Invoice ${invoice.invoiceNumber}`, [
              { account: "patient_receivables", debit: invoice.grandTotal },
              ...revenueLines(linesByInvoice.get(invoice.id!) ?? [], "credit"),
              ...((invoice.taxTotal ?? 0n) > 0n
                ? [{ account: "gst_output" as const, credit: invoice.taxTotal }]
                : []),
              ...roundOffLine(invoice.roundOff ?? 0n, "credit"),
            ]),
          ]
        : [],
    ),
    ...paymentRows.map((payment) =>
      entry(payment, "payment", `Receipt ${payment.receiptNumber}`, [
        { account: settlementAccountFor(payment.method), debit: payment.amount },
        { account: "patient_receivables", credit: payment.amount },
      ]),
    ),
    ...advanceRows.map((receipt) =>
      entry(receipt, "advance_receipt", `Advance receipt ${receipt.receiptNumber}`, [
        { account: settlementAccountFor(receipt.method), debit: receipt.amount },
        { account: "patient_advances", credit: receipt.amount },
      ]),
    ),
    ...allocationRows.map((allocation) =>
      entry(
        allocation,
        "advance_allocation",
        `Advance allocation · Invoice ${invoiceNumberById.get(allocation.invoiceId)}`,
        [
          { account: "patient_advances", debit: allocation.amount },
          { account: "patient_receivables", credit: allocation.amount },
        ],
      ),
    ),
    ...creditNoteRows.map((note) => {
      const lines = (notesLines.get(note.id!) ?? []).map((line) => ({
        revenueCategory: lineById.get(line.invoiceLineId)!.revenueCategory,
        taxableValue: line.taxableValue,
      }));

      return entry(note, "credit_note", `Credit note ${note.creditNoteNumber}`, [
        ...revenueLines(lines, "debit"),
        ...(note.taxTotal > 0n ? [{ account: "gst_output" as const, debit: note.taxTotal }] : []),
        ...roundOffLine(note.roundOff ?? 0n, "debit"),
        { account: "patient_receivables", credit: note.total },
      ]);
    }),
    ...refundRows.map((refund) =>
      entry(refund, "refund", `Refund ${refund.refundNumber}`, [
        {
          account: refund.advanceReceiptId ? "patient_advances" : "patient_receivables",
          debit: refund.amount,
        },
        { account: settlementAccountFor(refund.method), credit: refund.amount },
      ]),
    ),
  ];

  for (let from = 0; from < journals.length; from += 400) {
    await postJournalEntries(tx, orgId, journals.slice(from, from + 400));
  }

  if (DRY_RUN) throw new DryRun();
});

await seeding.catch((error: unknown) => {
  if (!(error instanceof DryRun)) throw error;
});

const collectedToday = paymentRows
  .filter((row) => row.businessDate === today)
  .reduce((sum, row) => sum + row.amount, 0n);

console.info(
  [
    "",
    DRY_RUN ? "Dry run: rolled back, nothing written." : "Demo practice seeded.",
    `  ${HISTORY_DAYS + 1} days, ${appointmentRows.length} appointments, ${invoiceRows.length} invoices, ${paymentRows.length} receipts.`,
    `  ${deptRows.length} departments, ${doctorRows.length} doctors, ${patientRows.length} patients.`,
    `  Pharmacy: ${productRows.length} products, ${productBatches.length} batches, ${saleRows.length} counter sales, ${movementRows.length} stock movements.`,
    `  IPD: ${bedRows.length} beds in ${wardRows.length} wards, ${admissionRows.length} admissions, ${reservationRows.length} reservations, ${issueRows.length} ward issues.`,
    `  Theatre: ${roomRows.length} rooms, ${unitRows.length} equipment units, ${caseRows.length} cases, ${resourceBlockRows.length} blocks.`,
    `  ${creditNoteRows.length} credit notes, ${refundRows.length} refunds, ${advanceRows.length} advances, ${planRows.length} treatment plans, ${payerRows.length} payers.`,
    `  Today (${today}): ₹${formatDecimal(collectedToday)} collected.`,
    `  Sign in as ${ACTOR_EMAIL} and open /${SLUG}/dashboard`,
    "",
  ].join("\n"),
);

process.exit(0);
