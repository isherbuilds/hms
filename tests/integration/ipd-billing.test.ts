// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 1 (inpatient issue → mixed-basis Invoice).
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { charges } from "@hms/db/schema/charges";
import { counter } from "@hms/db/schema/counter";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import * as ipdSchema from "@hms/db/schema/ipd";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { pharmacySales } from "@hms/db/schema/pharmacy-sales";
import { stockMovements } from "@hms/db/schema/stock-movements";
import { and, eq } from "drizzle-orm";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { settlePendingCharges } from "../support/billing";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const HOUR = 60 * 60 * 1_000;

const RECEIVED_ON = "2026-09-01";

const MRP = 112_00n;

const EXPIRY_YEAR = new Date().getUTCFullYear() + 3;

// The fixture org runs on Asia/Kolkata, so the fiscal year follows that calendar.
function fiscalYearNow(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;

  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function settingsInput(
  orgSlug: string,
  seed: string,
  prefixes: Partial<{
    invoicePrefix: string;
    pharmacyInvoicePrefix: string;
    ipdInvoicePrefix: string;
  }> = {},
) {
  return {
    orgSlug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "GSTIN-TEST",
    gstin: "",
    drugLicence20: "",
    drugLicence21: "",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "MRN",
    invoicePrefix: prefixes.invoicePrefix ?? "INV",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    pharmacyInvoicePrefix: prefixes.pharmacyInvoicePrefix ?? "PH",
    ipdInvoicePrefix: prefixes.ipdInvoicePrefix ?? "IP",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 1,
  };
}

let phoneSequence = 5_570_000;

type Hospital = Awaited<ReturnType<typeof createHospital>>;

async function createHospital(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const orgSlug = organization.slug;
  const orgId = organization.id;
  const api = clientFor(owner);

  await api.settings.update(settingsInput(orgSlug, seed));

  const roomService = await api.catalog.create({
    orgSlug,
    name: `${seed} General ward bed day`,
    category: "other",
    unitPrice: 1_000_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  const department = await api.staff.createDepartment({ orgSlug, name: `${seed} Medicine` });

  const practitioner = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed}`,
    departmentId: department.id,
  });

  const ward = await api.ipd.createWard({ orgSlug, name: "General" });
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General bed" });
  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: category.id,
    catalogItemId: roomService.id,
    dailyPrice: 1_000_00n,
    effectiveFrom: new Date(Date.now() - 24 * 30 * HOUR),
  });

  const beds: Array<Awaited<ReturnType<typeof api.ipd.createBed>>> = [];

  for (const label of ["G-1", "G-2", "G-3", "G-4"]) {
    beds.push(
      await api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label }),
    );
  }

  async function createService(
    overrides: Partial<{ name: string; unitPrice: bigint; taxRatePercent: string }> = {},
  ) {
    return api.catalog.create({
      orgSlug,
      name: overrides.name ?? `${seed} Procedure ${uniqueSuffix()}`,
      category: "procedure",
      unitPrice: overrides.unitPrice ?? 6_000_00n,
      taxRatePercent: overrides.taxRatePercent ?? "5",
      taxCode: "9993",
      customRate: false,
    });
  }

  async function createMedicine(
    overrides: Partial<{
      name: string;
      schedule: "none" | "h" | "h1" | "x";
      taxRatePercent: string;
      sold: boolean;
      unitsPerPack: number;
    }> = {},
  ) {
    const name = overrides.name ?? `${seed} Paracetamol ${uniqueSuffix()}`;

    const created = await api.pharmacy.createProduct({
      orgSlug,
      name,
      sold: overrides.sold ?? true,
      taxRatePercent: overrides.taxRatePercent ?? "12.00",
      taxCode: "3004",
      active: true,
      stockUnit: "tablet",
      unitsPerPack: overrides.unitsPerPack ?? 1,
      expires: true,
      pack: "10 tablets",
      schedule: overrides.schedule ?? "none",
    });

    return { productId: created.productId, name };
  }

  async function receive(
    productId: string,
    line: { expiryDate?: string; mrp?: bigint; pricedPer?: "pack" | "unit"; qty: number },
  ) {
    const batchNumber = `B-${uniqueSuffix()}`;

    const received = await api.pharmacy.receiveGoods({
      orgSlug,
      supplierName: `${seed} Supplier`,
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId,
          batchNumber,
          expiryDate: line.expiryDate ?? `${EXPIRY_YEAR}-12`,
          mrp: line.mrp ?? MRP,
          pricedPer: line.pricedPer ?? "unit",
          cost: { freeQty: 0, rate: 0n, discountPercent: "0", gstPercent: "0" },
          qty: line.qty,
        },
      ],
    });

    const [batch] = received.batches;

    if (!batch) throw new Error("expected a received batch");

    return { batchId: batch.batchId, batchNumber };
  }

  async function shelfQty(batchId: string) {
    const { items } = await api.pharmacy.stockOnHand({ orgSlug, includeZero: true });
    const row = items.find((candidate) => candidate.batchId === batchId);

    if (!row) throw new Error(`expected stock for batch ${batchId}`);

    return row.shelfQty;
  }

  async function admit(bedIndex: number, name = `${seed} Patient ${uniqueSuffix()}`) {
    phoneSequence += 1;

    const patient = await api.patient.register({
      orgSlug,
      name,
      phone: String(phoneSequence),
      sex: "other",
      dateOfBirth: "1980-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });

    const admission = await api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[bedIndex]!.id,
    });

    return { patient, admission };
  }

  async function chargeRevision(admissionId: string, client: AppRouterClient = api) {
    const detail = await client.ipd.get({ orgSlug, admissionId });

    return detail.admission.chargeRevision;
  }

  async function markReady(admissionId: string) {
    const detail = await api.ipd.get({ orgSlug, admissionId });

    return api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: detail.admission.revision,
    });
  }

  async function discharge(admissionId: string) {
    const ready = await markReady(admissionId);

    return api.ipd.discharge({ orgSlug, admissionId, expectedRevision: ready.revision });
  }

  async function member(role: Parameters<typeof joinOrganization>[2]) {
    const user: TestUser = await createTestUser(`${seed}-${role}`);
    await joinOrganization(user, orgId, role);

    return { user, api: clientFor(user) };
  }

  async function issue(
    admissionId: string,
    lines: Array<{ batchId: string; qty: number; supply?: "bundled" | "independent" }>,
    options: { prescriberName?: string; client?: AppRouterClient } = {},
  ) {
    const client = options.client ?? api;

    return client.pharmacy.issueToAdmission({
      orgSlug,
      admissionId,
      expectedChargeRevision: await chargeRevision(admissionId),
      lines,
      prescriberName: options.prescriberName,
    });
  }

  async function postServices(
    admissionId: string,
    lines: Array<{ catalogItemId: string; qty: number }>,
    client: AppRouterClient = api,
  ) {
    return client.ipd.postServices({
      orgSlug,
      admissionId,
      expectedChargeRevision: await chargeRevision(admissionId),
      lines,
    });
  }

  async function issueInvoice(
    admissionId: string,
    settlement: {
      payments?: Array<{ method: "cash" | "upi" | "card"; amount: bigint; reference?: string }>;
      outstandingReason?: string;
      client?: AppRouterClient;
    } = {},
  ) {
    const client = settlement.client ?? api;
    const preview = await client.ipd.previewInvoice({ orgSlug, admissionId });

    return client.ipd.issueInvoice({
      orgSlug,
      admissionId,
      expectedChargeRevision: preview.chargeRevision,
      expectedGrandTotal: preview.grandTotal,
      payments: settlement.payments ?? [],
      outstandingReason:
        settlement.outstandingReason ??
        (settlement.payments === undefined ? "Settling with the family later" : undefined),
    });
  }

  return {
    owner,
    organization,
    orgSlug,
    orgId,
    api,
    practitioner,
    beds,
    createService,
    createMedicine,
    receive,
    shelfQty,
    admit,
    chargeRevision,
    markReady,
    discharge,
    member,
    issue,
    postServices,
    issueInvoice,
  };
}

// ── Direct row reads, always scoped by orgId ────────────────────────────────

async function issueRows(orgId: string) {
  return db
    .select()
    .from(ipdSchema.admissionPharmacyIssues)
    .where(eq(ipdSchema.admissionPharmacyIssues.orgId, orgId));
}

async function issueLineRows(orgId: string) {
  return db
    .select()
    .from(ipdSchema.admissionPharmacyIssueLines)
    .where(eq(ipdSchema.admissionPharmacyIssueLines.orgId, orgId));
}

async function admissionCharges(orgId: string, admissionId: string) {
  return db
    .select()
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.admissionId, admissionId)));
}

async function counterValue(orgId: string, key: string) {
  const [row] = await db
    .select({ value: counter.value })
    .from(counter)
    .where(and(eq(counter.orgId, orgId), eq(counter.key, key)));

  return row?.value;
}

async function counterRows(orgId: string) {
  return db.select().from(counter).where(eq(counter.orgId, orgId));
}

async function journalEntryCount(orgId: string) {
  const rows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId));

  return rows.length;
}

/** Every write an issue must not make, plus the ones a refused issue must not make. */
async function financialSnapshot(orgId: string) {
  return {
    sales: (await db.select().from(pharmacySales).where(eq(pharmacySales.orgId, orgId))).length,
    invoices: (await db.select().from(invoices).where(eq(invoices.orgId, orgId))).length,
    payments: (await db.select().from(payments).where(eq(payments.orgId, orgId))).length,
    journalEntries: await journalEntryCount(orgId),
    counters: (await counterRows(orgId))
      .map((row) => `${row.key}=${row.value}`)
      .sort()
      .join(","),
  };
}

async function journalFor(orgId: string, sourceType: string, sourceId: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );

  if (!entry) throw new Error(`expected a ${sourceType} journal entry`);

  return db
    .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, orgId)))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entry.id)));
}

function sumBy(lines: Array<{ code: string; debit: bigint; credit: bigint }>, code: string) {
  const matching = lines.filter((line) => line.code === code);

  if (matching.length === 0) throw new Error(`expected a journal line for account ${code}`);

  return {
    debit: matching.reduce((sum, line) => sum + line.debit, 0n),
    credit: matching.reduce((sum, line) => sum + line.credit, 0n),
  };
}

async function auditEntries(hospital: Hospital, action: string) {
  await drainAuditWrites();

  return eventually(async () => {
    const log = await hospital.api.audit.list({ orgSlug: hospital.orgSlug });
    const entries = log.items.filter((entry) => entry.action === action);

    return entries.length > 0 ? entries : undefined;
  });
}

async function settled<T>(promise: Promise<T>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    // SAFETY: oRPC client errors carry `code`; asserted by the callers.
    return { ok: false as const, code: (error as { code?: string }).code };
  }
}

/** A refused settlement leaves no Invoice; the next one is still number 1 in the ipd series. */
async function expectFirstInvoiceStillAvailable(hospital: Hospital, admissionId: string) {
  const { orgId } = hospital;
  const key = `invoice:ipd:${fiscalYearNow()}`;

  expect(await counterValue(orgId, key)).toBeUndefined();
  expect(await db.select().from(invoices).where(eq(invoices.orgId, orgId))).toEqual([]);
  expect(await db.select().from(payments).where(eq(payments.orgId, orgId))).toEqual([]);
  expect(
    (await admissionCharges(orgId, admissionId)).every((charge) => charge.status === "pending"),
  ).toBe(true);

  const issued = await hospital.issueInvoice(admissionId);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, issued.invoiceId)));

  expect(invoice?.invoiceNumber).toBe(`IP${fiscalYearNow()}/1`);
  expect(await counterValue(orgId, key)).toBe(1);
}

/** Admission with one ₹6,000.00 service at 5%, ready for its Invoice. */
async function readyAdmissionWithService(hospital: Hospital, bedIndex = 0) {
  const { admission } = await hospital.admit(bedIndex);
  const service = await hospital.createService();
  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }]);
  await hospital.markReady(admission.id);

  return { admission, service };
}

// ── Inpatient issue ─────────────────────────────────────────────────────────

test("an inpatient issue moves shelf stock and posts one pending Admission Charge, with no sale, Invoice, Payment, journal or counter", async () => {
  const hospital = await createHospital("ipd-issue-happy");
  const { orgId, orgSlug, api } = hospital;
  const medicine = await hospital.createMedicine({ name: "Ceftriaxone 1g" });
  const { batchId, batchNumber } = await hospital.receive(medicine.productId, { qty: 10 });
  const { admission } = await hospital.admit(0);
  const before = await financialSnapshot(orgId);
  const revisionBefore = await hospital.chargeRevision(admission.id);

  const issued = await api.pharmacy.issueToAdmission({
    orgSlug,
    admissionId: admission.id,
    expectedChargeRevision: revisionBefore,
    lines: [{ batchId, qty: 3 }],
  });

  expect(issued.chargeRevision).toBe(revisionBefore + 1);
  expect(await hospital.chargeRevision(admission.id)).toBe(revisionBefore + 1);
  expect(await hospital.shelfQty(batchId)).toBe(7);

  const issues = await issueRows(orgId);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ id: issued.issueId, admissionId: admission.id });

  const lines = await issueLineRows(orgId);
  expect(lines).toHaveLength(1);

  const movements = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, orgId), eq(stockMovements.sourceId, lines[0]!.id)));

  // One movement per issue line, traced to that line.
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({
    batchId,
    bucket: "shelf",
    qty: -3,
    reason: "admission_issue",
    sourceType: "admission_pharmacy_issue_line",
    sourceId: lines[0]!.id,
  });

  const posted = await admissionCharges(orgId, admission.id);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    admissionId: admission.id,
    sourceType: "admission",
    sourceId: admission.id,
    admissionKind: "pharmacy_issue",
    admissionIssueLineId: lines[0]!.id,
    stockBatchId: batchId,
    catalogItemId: null,
    opdAppointmentId: null,
    pharmacySaleId: null,
    revenueCategory: "pharmacy",
    priceBasis: "inclusive",
    status: "pending",
    qty: 3,
    unitPrice: MRP,
    priceUnits: 1,
    taxRatePercent: "0.00",
    description: `Ceftriaxone 1g · batch ${batchNumber}`,
    invoiceId: null,
  });

  expect(await financialSnapshot(orgId)).toEqual(before);
});

test("loose units issue against the pack MRP and carry its price units", async () => {
  const hospital = await createHospital("ipd-issue-loose");
  const medicine = await hospital.createMedicine({ unitsPerPack: 10 });

  const { batchId } = await hospital.receive(medicine.productId, {
    qty: 50,
    mrp: MRP,
    pricedPer: "pack",
  });

  const { admission } = await hospital.admit(0);

  await hospital.issue(admission.id, [{ batchId, qty: 4 }]);

  const [charge] = await admissionCharges(hospital.orgId, admission.id);
  expect(charge).toMatchObject({ qty: 4, unitPrice: MRP, priceUnits: 10, stockBatchId: batchId });
  expect(await hospital.shelfQty(batchId)).toBe(46);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(preview.lines[0]).toMatchObject({ qty: 4, priceUnits: 10, lineSubtotal: 44_80n });
});

test("a bundled issue snapshots exempt 0% tax and an independent issue keeps the Product's GST, both inclusive at MRP", async () => {
  const hospital = await createHospital("ipd-issue-supply");
  const medicine = await hospital.createMedicine({ taxRatePercent: "12.00" });
  const { batchId } = await hospital.receive(medicine.productId, { qty: 10 });
  const { admission } = await hospital.admit(0);

  await hospital.issue(admission.id, [
    { batchId, qty: 1 },
    { batchId, qty: 2, supply: "bundled" },
    { batchId, qty: 3, supply: "independent" },
  ]);

  const posted = await admissionCharges(hospital.orgId, admission.id);
  const byQty = new Map(posted.map((charge) => [charge.qty, charge]));

  expect(byQty.get(1)).toMatchObject({ taxRatePercent: "0.00", priceBasis: "inclusive" });
  expect(byQty.get(2)).toMatchObject({ taxRatePercent: "0.00", priceBasis: "inclusive" });
  expect(byQty.get(3)).toMatchObject({
    taxRatePercent: "12.00",
    priceBasis: "inclusive",
    unitPrice: MRP,
  });
  expect(await hospital.shelfQty(batchId)).toBe(4);
});

test("an expired batch is refused and nothing is written, even for the valid line beside it", async () => {
  const hospital = await createHospital("ipd-issue-expired");
  const good = await hospital.createMedicine();
  const expired = await hospital.createMedicine();
  const goodBatch = await hospital.receive(good.productId, { qty: 5 });
  const expiredBatch = await hospital.receive(expired.productId, { qty: 5, expiryDate: "2020-01" });
  const { admission } = await hospital.admit(0);
  const revision = await hospital.chargeRevision(admission.id);

  await expectORPCCode(
    hospital.issue(admission.id, [
      { batchId: goodBatch.batchId, qty: 1 },
      { batchId: expiredBatch.batchId, qty: 1 },
    ]),
    "BAD_REQUEST",
  );

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await admissionCharges(hospital.orgId, admission.id)).toEqual([]);
  expect(await hospital.shelfQty(goodBatch.batchId)).toBe(5);
  expect(await hospital.shelfQty(expiredBatch.batchId)).toBe(5);
  expect(await hospital.chargeRevision(admission.id)).toBe(revision);
});

test("a product that is not sold, or no longer active, is refused without writing", async () => {
  const hospital = await createHospital("ipd-issue-unsold");
  const unsold = await hospital.createMedicine({ sold: false });
  const withdrawn = await hospital.createMedicine();
  const unsoldBatch = await hospital.receive(unsold.productId, { qty: 5 });
  const withdrawnBatch = await hospital.receive(withdrawn.productId, { qty: 5 });

  await hospital.api.pharmacy.updateProduct({
    orgSlug: hospital.orgSlug,
    productId: withdrawn.productId,
    name: withdrawn.name,
    sold: true,
    taxRatePercent: "12.00",
    active: false,
    stockUnit: "tablet",
    unitsPerPack: 1,
    expires: true,
    pack: "10 tablets",
  });

  const { admission } = await hospital.admit(0);

  await expectORPCCode(
    hospital.issue(admission.id, [{ batchId: unsoldBatch.batchId, qty: 1 }]),
    "BAD_REQUEST",
    "a product that is not sold",
  );
  await expectORPCCode(
    hospital.issue(admission.id, [{ batchId: withdrawnBatch.batchId, qty: 1 }]),
    "BAD_REQUEST",
    "an inactive product",
  );

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await admissionCharges(hospital.orgId, admission.id)).toEqual([]);
  expect(await hospital.shelfQty(unsoldBatch.batchId)).toBe(5);
  expect(await hospital.shelfQty(withdrawnBatch.batchId)).toBe(5);
});

test("a Schedule X medicine is refused without writing", async () => {
  const hospital = await createHospital("ipd-issue-schedule-x");
  const medicine = await hospital.createMedicine({ schedule: "x" });
  const { batchId } = await hospital.receive(medicine.productId, { qty: 2 });
  const { admission } = await hospital.admit(0);

  await expectORPCCode(hospital.issue(admission.id, [{ batchId, qty: 1 }]), "BAD_REQUEST");

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(2);
});

test("a Schedule H1 medicine needs the prescriber's name", async () => {
  const hospital = await createHospital("ipd-issue-h1");
  const medicine = await hospital.createMedicine({ schedule: "h1" });
  const { batchId } = await hospital.receive(medicine.productId, { qty: 2 });
  const { admission } = await hospital.admit(0);

  await expectORPCCode(hospital.issue(admission.id, [{ batchId, qty: 1 }]), "BAD_REQUEST");
  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(2);

  await hospital.issue(admission.id, [{ batchId, qty: 1 }], { prescriberName: "Dr Mehta" });

  const listed = await hospital.api.pharmacy.listAdmissionIssues({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(listed.issues[0]?.prescriberName).toBe("Dr Mehta");
  expect(await hospital.shelfQty(batchId)).toBe(1);
});

test("an issue above shelf stock is a CONFLICT and writes nothing", async () => {
  const hospital = await createHospital("ipd-issue-short");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 3 });
  const { admission } = await hospital.admit(0);

  await expectORPCCode(hospital.issue(admission.id, [{ batchId, qty: 4 }]), "CONFLICT");

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await admissionCharges(hospital.orgId, admission.id)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(3);
});

test("requested quantity is aggregated per batch across lines before the shelf check", async () => {
  const hospital = await createHospital("ipd-issue-aggregate");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 3 });
  const { admission } = await hospital.admit(0);

  await expectORPCCode(
    hospital.issue(admission.id, [
      { batchId, qty: 2 },
      { batchId, qty: 2, supply: "independent" },
    ]),
    "CONFLICT",
  );

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await issueLineRows(hospital.orgId)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(3);
});

test("an unknown batch is NOT_FOUND and writes nothing", async () => {
  const hospital = await createHospital("ipd-issue-unknown");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 3 });
  const { admission } = await hospital.admit(0);

  await expectORPCCode(
    hospital.issue(admission.id, [
      { batchId, qty: 1 },
      { batchId: Bun.randomUUIDv7(), qty: 1 },
    ]),
    "NOT_FOUND",
  );
  await expectORPCCode(
    hospital.api.pharmacy.issueToAdmission({
      orgSlug: hospital.orgSlug,
      admissionId: Bun.randomUUIDv7(),
      expectedChargeRevision: 0,
      lines: [{ batchId, qty: 1 }],
    }),
    "NOT_FOUND",
    "an unknown Admission",
  );

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(3);
});

test("a stale charge revision is a CONFLICT and writes nothing", async () => {
  const hospital = await createHospital("ipd-issue-stale");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await hospital.admit(0);
  const stale = await hospital.chargeRevision(admission.id);

  await hospital.issue(admission.id, [{ batchId, qty: 1 }]);

  await expectORPCCode(
    hospital.api.pharmacy.issueToAdmission({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: stale,
      lines: [{ batchId, qty: 1 }],
    }),
    "CONFLICT",
  );

  expect(await issueRows(hospital.orgId)).toHaveLength(1);
  expect(await admissionCharges(hospital.orgId, admission.id)).toHaveLength(1);
  expect(await hospital.shelfQty(batchId)).toBe(4);
});

test("a cancelled or discharged Admission refuses issues; a discharge-ready one accepts them", async () => {
  const hospital = await createHospital("ipd-issue-states");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 10 });

  const cancelled = await hospital.admit(0);
  await hospital.api.ipd.cancel({
    orgSlug: hospital.orgSlug,
    admissionId: cancelled.admission.id,
    expectedRevision: cancelled.admission.revision,
    reason: "Admitted the wrong Patient",
  });
  await expectORPCCode(
    hospital.issue(cancelled.admission.id, [{ batchId, qty: 1 }]),
    "CONFLICT",
    "a cancelled Admission",
  );

  const departed = await hospital.admit(1);
  await hospital.discharge(departed.admission.id);
  await expectORPCCode(
    hospital.issue(departed.admission.id, [{ batchId, qty: 1 }]),
    "CONFLICT",
    "a discharged Admission",
  );

  expect(await issueRows(hospital.orgId)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(10);

  const ready = await hospital.admit(2);
  await hospital.markReady(ready.admission.id);
  await hospital.issue(ready.admission.id, [{ batchId, qty: 1 }]);

  expect(await admissionCharges(hospital.orgId, ready.admission.id)).toHaveLength(1);
  expect(await hospital.shelfQty(batchId)).toBe(9);
});

test("two Admissions issuing the last unit at once: exactly one wins and stock never goes negative", async () => {
  const hospital = await createHospital("ipd-issue-race");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 1 });
  const first = await hospital.admit(0);
  const second = await hospital.admit(1);

  const revisions = [
    await hospital.chargeRevision(first.admission.id),
    await hospital.chargeRevision(second.admission.id),
  ] as const;

  const outcomes = await Promise.all([
    settled(
      hospital.api.pharmacy.issueToAdmission({
        orgSlug: hospital.orgSlug,
        admissionId: first.admission.id,
        expectedChargeRevision: revisions[0],
        lines: [{ batchId, qty: 1 }],
      }),
    ),
    settled(
      hospital.api.pharmacy.issueToAdmission({
        orgSlug: hospital.orgSlug,
        admissionId: second.admission.id,
        expectedChargeRevision: revisions[1],
        lines: [{ batchId, qty: 1 }],
      }),
    ),
  ]);

  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.code)).toEqual([
    "CONFLICT",
  ]);
  expect(await hospital.shelfQty(batchId)).toBe(0);
  expect(await issueRows(hospital.orgId)).toHaveLength(1);
});

test("a successful issue is audited after commit", async () => {
  const hospital = await createHospital("ipd-issue-audit");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await hospital.admit(0);

  await hospital.issue(admission.id, [{ batchId, qty: 2 }]);

  const entries = await auditEntries(hospital, "pharmacy.issueToAdmission");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ actorId: hospital.owner.user.id, orgId: hospital.orgId });
  expect(entries[0]!.denied).toBeFalsy();
});

test("a pharmacist issues to an Admission; reception and cashier are FORBIDDEN and the denials are audited", async () => {
  const hospital = await createHospital("ipd-issue-roles");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await hospital.admit(0);
  const pharmacist = await hospital.member("pharmacist");
  const reception = await hospital.member("reception");
  const cashier = await hospital.member("cashier");

  await hospital.issue(admission.id, [{ batchId, qty: 1 }], { client: pharmacist.api });
  expect(await hospital.shelfQty(batchId)).toBe(4);

  for (const denied of [reception, cashier]) {
    await expectORPCCode(
      hospital.issue(admission.id, [{ batchId, qty: 1 }], { client: denied.api }),
      "FORBIDDEN",
    );
  }

  expect(await hospital.shelfQty(batchId)).toBe(4);

  await drainAuditWrites();
  const log = await hospital.api.audit.list({ orgSlug: hospital.orgSlug });

  for (const denied of [reception, cashier]) {
    const denial = log.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === denied.user.user.id,
    );

    expect(denial?.denied).toBe(true);
    expect(denial?.meta).toMatchObject({ permission: { pharmacy: ["issueAdmission"] } });
  }
});

test("a pharmacist cannot post services or issue the IPD Invoice; a cashier can", async () => {
  const hospital = await createHospital("ipd-billing-roles");
  const { admission } = await hospital.admit(0);
  const service = await hospital.createService();
  const pharmacist = await hospital.member("pharmacist");
  const cashier = await hospital.member("cashier");

  await expectORPCCode(
    hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }], pharmacist.api),
    "FORBIDDEN",
    "pharmacist posting a service",
  );

  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }], cashier.api);
  await hospital.markReady(admission.id);

  await expectORPCCode(
    hospital.issueInvoice(admission.id, { client: pharmacist.api }),
    "FORBIDDEN",
    "pharmacist issuing the Invoice",
  );

  const issued = await hospital.issueInvoice(admission.id, {
    client: cashier.api,
    payments: [{ method: "cash", amount: 6_300_00n }],
  });

  expect(issued.invoiceId).toBeTruthy();
});

test("the Admission's issues list their batch, expiry and Charge", async () => {
  const hospital = await createHospital("ipd-issue-list");
  const medicine = await hospital.createMedicine({ name: "Pantoprazole 40mg" });
  const { batchId, batchNumber } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await hospital.admit(0);
  const pharmacist = await hospital.member("pharmacist");

  const issued = await hospital.issue(admission.id, [{ batchId, qty: 2 }], {
    client: pharmacist.api,
  });

  const cashier = await hospital.member("cashier");

  const listed = await cashier.api.pharmacy.listAdmissionIssues({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const [charge] = await admissionCharges(hospital.orgId, admission.id);

  expect(listed.issues).toHaveLength(1);
  expect(listed.issues[0]).toMatchObject({
    id: issued.issueId,
    prescriberName: null,
    issuedByName: pharmacist.user.user.name,
  });
  expect(listed.issues[0]!.lines).toEqual([
    {
      id: charge!.admissionIssueLineId!,
      batchId,
      productName: "Pantoprazole 40mg",
      batchNumber,
      expiryDate: `${EXPIRY_YEAR}-12-31`,
      qty: 2,
      chargeId: charge!.id,
      chargeStatus: "pending",
    },
  ]);
});

test("cancellation is refused once the Admission has an issue or a posted service", async () => {
  const hospital = await createHospital("ipd-cancel-after-work");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const service = await hospital.createService();

  const issuedTo = await hospital.admit(0);
  await hospital.issue(issuedTo.admission.id, [{ batchId, qty: 1 }]);

  const served = await hospital.admit(1);
  await hospital.postServices(served.admission.id, [{ catalogItemId: service.id, qty: 1 }]);

  for (const { admission } of [issuedTo, served]) {
    const detail = await hospital.api.ipd.get({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
    });

    await expectORPCCode(
      hospital.api.ipd.cancel({
        orgSlug: hospital.orgSlug,
        admissionId: admission.id,
        expectedRevision: detail.admission.revision,
        reason: "Wrong Patient",
      }),
      "CONFLICT",
    );

    const after = await hospital.api.ipd.get({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
    });

    expect(after.admission.status).toBe("admitted");
  }
});

// ── Services ────────────────────────────────────────────────────────────────

test("posting a service snapshots the catalog price, tax and category as an exclusive Admission Charge", async () => {
  const hospital = await createHospital("ipd-services-happy");
  const { admission } = await hospital.admit(0);

  const service = await hospital.createService({
    name: "Dressing change",
    unitPrice: 450_00n,
    taxRatePercent: "5",
  });

  const revision = await hospital.chargeRevision(admission.id);

  const posted = await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 2 }]);

  expect(posted.chargeRevision).toBe(revision + 1);
  expect(await hospital.chargeRevision(admission.id)).toBe(revision + 1);

  const rows = await admissionCharges(hospital.orgId, admission.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    admissionId: admission.id,
    sourceType: "admission",
    sourceId: admission.id,
    admissionKind: "service",
    catalogItemId: service.id,
    stockBatchId: null,
    opdAppointmentId: null,
    pharmacySaleId: null,
    priceBasis: "exclusive",
    description: "Dressing change",
    qty: 2,
    unitPrice: 450_00n,
    priceUnits: 1,
    taxRatePercent: "5.00",
    revenueCategory: "procedure",
    status: "pending",
  });

  // Later master edits never reprice the snapshot.
  await hospital.api.catalog.update({
    orgSlug: hospital.orgSlug,
    itemId: service.id,
    name: "Dressing change",
    category: "procedure",
    unitPrice: 999_00n,
    customRate: false,
    taxRatePercent: "5",
  });
  expect((await admissionCharges(hospital.orgId, admission.id))[0]?.unitPrice).toBe(450_00n);
});

test("services post while ready or discharged, but not on a cancelled Admission or with a stale revision", async () => {
  const hospital = await createHospital("ipd-services-states");
  const service = await hospital.createService();

  const ready = await hospital.admit(0);
  await hospital.markReady(ready.admission.id);
  await hospital.postServices(ready.admission.id, [{ catalogItemId: service.id, qty: 1 }]);

  const departed = await hospital.admit(1);
  await hospital.discharge(departed.admission.id);
  await hospital.postServices(departed.admission.id, [{ catalogItemId: service.id, qty: 1 }]);

  const cancelled = await hospital.admit(2);
  await hospital.api.ipd.cancel({
    orgSlug: hospital.orgSlug,
    admissionId: cancelled.admission.id,
    expectedRevision: cancelled.admission.revision,
    reason: "Wrong Patient",
  });
  await expectORPCCode(
    hospital.postServices(cancelled.admission.id, [{ catalogItemId: service.id, qty: 1 }]),
    "CONFLICT",
    "a cancelled Admission",
  );

  const stale = await hospital.chargeRevision(ready.admission.id);
  await hospital.postServices(ready.admission.id, [{ catalogItemId: service.id, qty: 1 }]);
  await expectORPCCode(
    hospital.api.ipd.postServices({
      orgSlug: hospital.orgSlug,
      admissionId: ready.admission.id,
      expectedChargeRevision: stale,
      lines: [{ catalogItemId: service.id, qty: 1 }],
    }),
    "CONFLICT",
    "a stale revision",
  );

  expect(await admissionCharges(hospital.orgId, ready.admission.id)).toHaveLength(2);
  expect(await admissionCharges(hospital.orgId, departed.admission.id)).toHaveLength(1);
  expect(await admissionCharges(hospital.orgId, cancelled.admission.id)).toEqual([]);
});

test("an unknown, foreign or inactive service is refused and nothing is posted", async () => {
  const hospital = await createHospital("ipd-services-refusals");
  const outsider = await createHospital("ipd-services-outsider");
  const { admission } = await hospital.admit(0);
  const foreign = await outsider.createService();
  const inactive = await hospital.createService();
  await hospital.api.catalog.setActive({
    orgSlug: hospital.orgSlug,
    itemId: inactive.id,
    active: false,
  });
  const revision = await hospital.chargeRevision(admission.id);

  await expectORPCCode(
    hospital.postServices(admission.id, [{ catalogItemId: Bun.randomUUIDv7(), qty: 1 }]),
    "NOT_FOUND",
    "an unknown service",
  );
  await expectORPCCode(
    hospital.postServices(admission.id, [{ catalogItemId: foreign.id, qty: 1 }]),
    "NOT_FOUND",
    "another organization's service",
  );

  const inactiveAttempt = await settled(
    hospital.postServices(admission.id, [{ catalogItemId: inactive.id, qty: 1 }]),
  );

  expect(inactiveAttempt.ok).toBe(false);
  expect(["NOT_FOUND", "BAD_REQUEST"]).toContain(inactiveAttempt.ok ? "" : inactiveAttempt.code!);

  expect(await admissionCharges(hospital.orgId, admission.id)).toEqual([]);
  expect(await hospital.chargeRevision(admission.id)).toBe(revision);
});

// ── Preview and Invoice ─────────────────────────────────────────────────────

test("the bill preview totals the pending Charges and writes nothing", async () => {
  const hospital = await createHospital("ipd-preview");
  const medicine = await hospital.createMedicine({ name: "Ondansetron 4mg" });
  const { batchId, batchNumber } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await hospital.admit(0);
  const service = await hospital.createService({ name: "Physiotherapy session" });
  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }]);
  await hospital.issue(admission.id, [{ batchId, qty: 2 }]);

  const before = await financialSnapshot(hospital.orgId);
  const revision = await hospital.chargeRevision(admission.id);
  const cashier = await hospital.member("cashier");

  const preview = await cashier.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(preview).toMatchObject({
    chargeRevision: revision,
    subtotal: 6_224_00n,
    taxTotal: 300_00n,
    roundOff: 0n,
    grandTotal: 6_524_00n,
    invoiceId: null,
  });

  const serviceLine = preview.lines.find((line) => line.admissionKind === "service");
  const medicineLine = preview.lines.find((line) => line.admissionKind === "pharmacy_issue");

  expect(serviceLine).toMatchObject({
    description: "Physiotherapy session",
    qty: 1,
    unitPrice: 6_000_00n,
    priceUnits: 1,
    priceBasis: "exclusive",
    taxRatePercent: "5.00",
    lineSubtotal: 6_000_00n,
    taxableValue: 6_000_00n,
    taxAmount: 300_00n,
    gross: 6_300_00n,
    batch: null,
  });
  expect(medicineLine).toMatchObject({
    description: `Ondansetron 4mg · batch ${batchNumber}`,
    qty: 2,
    unitPrice: MRP,
    priceBasis: "inclusive",
    taxRatePercent: "0.00",
    lineSubtotal: 224_00n,
    taxableValue: 224_00n,
    taxAmount: 0n,
    gross: 224_00n,
    batch: { batchId, batchNumber, expiryDate: `${EXPIRY_YEAR}-12-31` },
  });

  expect(await financialSnapshot(hospital.orgId)).toEqual(before);
  expect(await hospital.chargeRevision(admission.id)).toBe(revision);
  expect(
    (await admissionCharges(hospital.orgId, admission.id)).every(
      (charge) => charge.status === "pending",
    ),
  ).toBe(true);
});

test("the mixed-basis Invoice: exclusive taxed service, bundled and independent medicines, exact lines, journal and batch trace", async () => {
  const hospital = await createHospital("ipd-mixed-invoice");
  const { orgId, orgSlug, api } = hospital;
  const fiscalYear = fiscalYearNow();

  const medicine = await hospital.createMedicine({
    name: "Amoxiclav 625",
    taxRatePercent: "12.00",
  });

  const { batchId } = await hospital.receive(medicine.productId, { qty: 10 });

  const service = await hospital.createService({
    name: "Minor procedure",
    unitPrice: 6_000_00n,
    taxRatePercent: "5",
  });

  const { admission, patient } = await hospital.admit(0);

  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }]);

  const issued = await hospital.issue(admission.id, [
    { batchId, qty: 2, supply: "bundled" },
    { batchId, qty: 1, supply: "independent" },
  ]);

  await hospital.markReady(admission.id);

  const preview = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  expect(preview.grandTotal).toBe(6_636_00n);

  const result = await api.ipd.issueInvoice({
    orgSlug,
    admissionId: admission.id,
    expectedChargeRevision: preview.chargeRevision,
    expectedGrandTotal: preview.grandTotal,
    payments: [],
    outstandingReason: "Family settles tomorrow",
  });

  expect(result.receiptIds).toEqual([]);
  expect(result.chargeRevision).toBeGreaterThan(preview.chargeRevision);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, result.invoiceId)));

  expect(invoice).toMatchObject({
    stream: "ipd",
    admissionId: admission.id,
    opdAppointmentId: null,
    pharmacySaleId: null,
    patientId: patient.id,
    invoiceNumber: `IP${fiscalYear}/1`,
    discountAmount: 0n,
    subtotal: 6_336_00n,
    taxTotal: 312_00n,
    addedTaxTotal: 300_00n,
    roundOff: 0n,
    grandTotal: 6_636_00n,
  });

  expect(await counterValue(orgId, `invoice:ipd:${fiscalYear}`)).toBe(1);
  expect(await counterValue(orgId, `invoice:${fiscalYear}`)).toBeUndefined();
  expect(await counterValue(orgId, `invoice:pharmacy:${fiscalYear}`)).toBeUndefined();

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, result.invoiceId)));

  const posted = await admissionCharges(orgId, admission.id);
  const chargeById = new Map(posted.map((charge) => [charge.id, charge]));

  const lineFor = (predicate: (charge: (typeof posted)[number]) => boolean) => {
    const line = lines.find((candidate) => predicate(chargeById.get(candidate.chargeId)!));

    if (!line) throw new Error("expected an invoice line");

    return line;
  };

  const serviceLine = lineFor((charge) => charge.admissionKind === "service");
  const bundledLine = lineFor((charge) => charge.stockBatchId !== null && charge.qty === 2);
  const independentLine = lineFor((charge) => charge.stockBatchId !== null && charge.qty === 1);

  expect(lines).toHaveLength(3);
  expect(serviceLine).toMatchObject({
    priceBasis: "exclusive",
    qty: 1,
    unitPrice: 6_000_00n,
    lineSubtotal: 6_000_00n,
    allocatedDiscount: 0n,
    taxableValue: 6_000_00n,
    taxRatePercent: "5.00",
    taxAmount: 300_00n,
    gross: 6_300_00n,
    revenueCategory: "procedure",
  });
  expect(bundledLine).toMatchObject({
    priceBasis: "inclusive",
    qty: 2,
    unitPrice: MRP,
    priceUnits: 1,
    lineSubtotal: 224_00n,
    allocatedDiscount: 0n,
    taxableValue: 224_00n,
    taxRatePercent: "0.00",
    taxAmount: 0n,
    gross: 224_00n,
    revenueCategory: "pharmacy",
  });
  expect(independentLine).toMatchObject({
    priceBasis: "inclusive",
    qty: 1,
    unitPrice: MRP,
    priceUnits: 1,
    lineSubtotal: 112_00n,
    allocatedDiscount: 0n,
    taxableValue: 100_00n,
    taxRatePercent: "12.00",
    taxAmount: 12_00n,
    gross: 112_00n,
    revenueCategory: "pharmacy",
  });

  const journal = await journalFor(orgId, "invoice", result.invoiceId);
  const debits = journal.reduce((sum, line) => sum + line.debit, 0n);
  const credits = journal.reduce((sum, line) => sum + line.credit, 0n);
  expect(debits).toBe(credits);
  expect(sumBy(journal, "1200").debit).toBe(6_636_00n);
  expect(sumBy(journal, "4200").credit).toBe(6_000_00n);
  expect(sumBy(journal, "4500").credit).toBe(324_00n);
  expect(sumBy(journal, "2100").credit).toBe(312_00n);
  expect(journal.some((line) => line.code === "4950")).toBe(false);

  expect(posted.every((charge) => charge.status === "invoiced")).toBe(true);
  expect(posted.every((charge) => charge.invoiceId === result.invoiceId)).toBe(true);

  // Batch trace: invoice line → Charge → batch → issue line.
  const listed = await api.pharmacy.listAdmissionIssues({ orgSlug, admissionId: admission.id });
  expect(listed.issues.map((entry) => entry.id)).toEqual([issued.issueId]);
  const tracedCharge = chargeById.get(independentLine.chargeId)!;

  const issueLine = listed.issues[0]!.lines.find(
    (line) => line.id === tracedCharge.admissionIssueLineId,
  );

  expect(issueLine).toMatchObject({
    batchId,
    chargeId: tracedCharge.id,
    chargeStatus: "invoiced",
    qty: 1,
  });
  expect(tracedCharge.stockBatchId).toBe(batchId);

  const after = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  expect(after.invoiceId).toBe(result.invoiceId);
});

test("an IPD Invoice whose total has paise is never rounded to the rupee", async () => {
  const hospital = await createHospital("ipd-paise");
  const medicine = await hospital.createMedicine({ unitsPerPack: 10, taxRatePercent: "12.00" });

  const { batchId } = await hospital.receive(medicine.productId, {
    qty: 50,
    mrp: MRP,
    pricedPer: "pack",
  });

  const { admission } = await hospital.admit(0);
  await hospital.issue(admission.id, [{ batchId, qty: 4, supply: "independent" }]);
  await hospital.markReady(admission.id);

  const result = await hospital.issueInvoice(admission.id);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, hospital.orgId), eq(invoices.id, result.invoiceId)));

  expect(invoice).toMatchObject({
    subtotal: 44_80n,
    taxTotal: 4_80n,
    roundOff: 0n,
    grandTotal: 44_80n,
  });
});

test("payment at issuance records a receipt and leaves nothing outstanding", async () => {
  const hospital = await createHospital("ipd-paid");
  const { admission } = await readyAdmissionWithService(hospital);

  const result = await hospital.issueInvoice(admission.id, {
    payments: [
      { method: "cash", amount: 6_000_00n },
      { method: "cash", amount: 300_00n },
    ],
  });

  expect(result.receiptIds).toHaveLength(2);

  const recorded = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orgId, hospital.orgId), eq(payments.invoiceId, result.invoiceId)));

  expect(recorded.map((payment) => payment.id).sort()).toEqual([...result.receiptIds].sort());

  const detail = await hospital.api.billing.getInvoice({
    orgSlug: hospital.orgSlug,
    invoiceId: result.invoiceId,
  });

  expect(detail.balance.outstanding).toBe(0n);
});

test("an unpaid or part-paid Invoice needs an outstanding reason", async () => {
  const hospital = await createHospital("ipd-unpaid");
  const { admission } = await readyAdmissionWithService(hospital);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const attempt = (paid: bigint, outstandingReason?: string) =>
    hospital.api.ipd.issueInvoice({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: preview.chargeRevision,
      expectedGrandTotal: preview.grandTotal,
      payments: paid === 0n ? [] : [{ method: "cash", amount: paid }],
      outstandingReason,
    });

  await expectORPCCode(attempt(0n), "BAD_REQUEST", "nothing paid, no reason");
  await expectORPCCode(attempt(1_000_00n), "BAD_REQUEST", "part paid, no reason");
  expect(await db.select().from(invoices).where(eq(invoices.orgId, hospital.orgId))).toEqual([]);

  const result = await attempt(1_000_00n, "Balance after insurer letter");

  const detail = await hospital.api.billing.getInvoice({
    orgSlug: hospital.orgSlug,
    invoiceId: result.invoiceId,
  });

  expect(detail.balance.outstanding).toBe(5_300_00n);
  expect(result.receiptIds).toHaveLength(1);
});

test("the Invoice waits for the discharge handoff", async () => {
  const hospital = await createHospital("ipd-invoice-state");
  const { admission } = await hospital.admit(0);
  const service = await hospital.createService();
  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }]);

  await expectORPCCode(hospital.issueInvoice(admission.id), "CONFLICT");
  expect(await db.select().from(invoices).where(eq(invoices.orgId, hospital.orgId))).toEqual([]);

  await hospital.discharge(admission.id);
  const result = await hospital.issueInvoice(admission.id);
  expect(result.invoiceId).toBeTruthy();
});

test("a stale charge revision rolls the Invoice back completely", async () => {
  const hospital = await createHospital("ipd-stale-revision");
  const { admission } = await readyAdmissionWithService(hospital);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const journalBefore = await journalEntryCount(hospital.orgId);

  await expectORPCCode(
    hospital.api.ipd.issueInvoice({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: preview.chargeRevision - 1,
      expectedGrandTotal: preview.grandTotal,
      payments: [{ method: "cash", amount: preview.grandTotal }],
    }),
    "CONFLICT",
  );

  expect(await journalEntryCount(hospital.orgId)).toBe(journalBefore);
  await expectFirstInvoiceStillAvailable(hospital, admission.id);
});

test("a stale grand total rolls the Invoice back completely", async () => {
  const hospital = await createHospital("ipd-stale-total");
  const { admission } = await readyAdmissionWithService(hospital);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const journalBefore = await journalEntryCount(hospital.orgId);

  await expectORPCCode(
    hospital.api.ipd.issueInvoice({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: preview.chargeRevision,
      expectedGrandTotal: preview.grandTotal - 1n,
      payments: [{ method: "cash", amount: preview.grandTotal - 1n }],
    }),
    "CONFLICT",
  );

  expect(await journalEntryCount(hospital.orgId)).toBe(journalBefore);
  await expectFirstInvoiceStillAvailable(hospital, admission.id);
});

test("overcollection is refused and rolls the Invoice back completely", async () => {
  const hospital = await createHospital("ipd-overcollect");
  const { admission } = await readyAdmissionWithService(hospital);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const journalBefore = await journalEntryCount(hospital.orgId);

  await expectORPCCode(
    hospital.api.ipd.issueInvoice({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: preview.chargeRevision,
      expectedGrandTotal: preview.grandTotal,
      payments: [{ method: "cash", amount: preview.grandTotal + 1_00n }],
    }),
    "BAD_REQUEST",
  );

  expect(await journalEntryCount(hospital.orgId)).toBe(journalBefore);
  await expectFirstInvoiceStillAvailable(hospital, admission.id);
});

test("an issue racing the Invoice leaves one consistent state: either it waits for the next bill or the Invoice is refused", async () => {
  const hospital = await createHospital("ipd-issue-vs-invoice");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await readyAdmissionWithService(hospital);

  const preview = await hospital.api.ipd.previewInvoice({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  const [issueOutcome, invoiceOutcome] = await Promise.all([
    settled(
      hospital.api.pharmacy.issueToAdmission({
        orgSlug: hospital.orgSlug,
        admissionId: admission.id,
        expectedChargeRevision: preview.chargeRevision,
        lines: [{ batchId, qty: 1 }],
      }),
    ),
    settled(
      hospital.api.ipd.issueInvoice({
        orgSlug: hospital.orgSlug,
        admissionId: admission.id,
        expectedChargeRevision: preview.chargeRevision,
        expectedGrandTotal: preview.grandTotal,
        payments: [{ method: "cash", amount: preview.grandTotal }],
      }),
    ),
  ]);

  const posted = await admissionCharges(hospital.orgId, admission.id);
  const pending = posted.filter((charge) => charge.status === "pending");
  const issuedInvoices = await db.select().from(invoices).where(eq(invoices.orgId, hospital.orgId));

  // Never both: an issued Invoice with a pending Charge beside it is the leak.
  expect(issueOutcome.ok && invoiceOutcome.ok).toBe(false);

  if (invoiceOutcome.ok) {
    expect(issueOutcome.ok ? "" : issueOutcome.code).toBe("CONFLICT");
    expect(issuedInvoices).toHaveLength(1);
    expect(pending).toEqual([]);
    expect(await issueRows(hospital.orgId)).toEqual([]);
    expect(await hospital.shelfQty(batchId)).toBe(5);
  } else {
    expect(invoiceOutcome.code).toBe("CONFLICT");
    expect(issueOutcome.ok).toBe(true);
    expect(issuedInvoices).toEqual([]);
    expect(pending).toHaveLength(2);
    expect(await hospital.shelfQty(batchId)).toBe(4);
  }
});

test("after the Invoice, a second Invoice, further issues and further services are refused", async () => {
  const hospital = await createHospital("ipd-after-invoice");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission, service } = await readyAdmissionWithService(hospital);

  const first = await hospital.issueInvoice(admission.id, {
    payments: [{ method: "cash", amount: 6_300_00n }],
  });

  expect(await hospital.chargeRevision(admission.id)).toBe(first.chargeRevision);

  await expectORPCCode(
    hospital.api.ipd.issueInvoice({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: first.chargeRevision,
      expectedGrandTotal: 0n,
      payments: [],
      outstandingReason: "nothing left",
    }),
    "CONFLICT",
    "a second Invoice",
  );
  await expectORPCCode(
    hospital.api.pharmacy.issueToAdmission({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: first.chargeRevision,
      lines: [{ batchId, qty: 1 }],
    }),
    "CONFLICT",
    "an issue after the Invoice",
  );
  await expectORPCCode(
    hospital.api.ipd.postServices({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: first.chargeRevision,
      lines: [{ catalogItemId: service.id, qty: 1 }],
    }),
    "CONFLICT",
    "a service after the Invoice",
  );

  expect(await db.select().from(invoices).where(eq(invoices.orgId, hospital.orgId))).toHaveLength(
    1,
  );
  expect(await admissionCharges(hospital.orgId, admission.id)).toHaveLength(1);
  expect(await hospital.shelfQty(batchId)).toBe(5);
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

test("another organization cannot issue to, bill, list or read this one's Admission, batch or Invoice", async () => {
  const hospital = await createHospital("ipd-billing-home");
  const outsider = await createHospital("ipd-billing-away");
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission, service } = await readyAdmissionWithService(hospital);
  await hospital.issue(admission.id, [{ batchId, qty: 1 }]);
  const issued = await hospital.issueInvoice(admission.id);

  const away = outsider.api;
  const orgSlug = outsider.orgSlug;
  const own = await outsider.admit(0);
  const ownService = await outsider.createService();

  await expectORPCCode(
    away.pharmacy.issueToAdmission({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: 0,
      lines: [{ batchId, qty: 1 }],
    }),
    "NOT_FOUND",
    "a foreign Admission",
  );
  await expectORPCCode(
    away.pharmacy.issueToAdmission({
      orgSlug,
      admissionId: own.admission.id,
      expectedChargeRevision: await outsider.chargeRevision(own.admission.id),
      lines: [{ batchId, qty: 1 }],
    }),
    "NOT_FOUND",
    "a foreign batch",
  );
  await expectORPCCode(
    away.ipd.postServices({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: 0,
      lines: [{ catalogItemId: ownService.id, qty: 1 }],
    }),
    "NOT_FOUND",
    "posting to a foreign Admission",
  );
  await expectORPCCode(
    away.ipd.postServices({
      orgSlug,
      admissionId: own.admission.id,
      expectedChargeRevision: await outsider.chargeRevision(own.admission.id),
      lines: [{ catalogItemId: service.id, qty: 1 }],
    }),
    "NOT_FOUND",
    "a foreign service",
  );
  await expectORPCCode(
    away.ipd.previewInvoice({ orgSlug, admissionId: admission.id }),
    "NOT_FOUND",
    "previewing a foreign Admission",
  );
  await expectORPCCode(
    away.ipd.issueInvoice({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: 0,
      expectedGrandTotal: 0n,
      payments: [],
      outstandingReason: "intrusion",
    }),
    "NOT_FOUND",
    "invoicing a foreign Admission",
  );
  await expectORPCCode(
    away.billing.getInvoice({ orgSlug, invoiceId: issued.invoiceId }),
    "NOT_FOUND",
    "reading the foreign Invoice",
  );

  const listed = await settled(
    away.pharmacy.listAdmissionIssues({ orgSlug, admissionId: admission.id }),
  );

  if (listed.ok) {
    expect(listed.value.issues).toEqual([]);
  } else {
    expect(listed.code).toBe("NOT_FOUND");
  }

  expect(await issueRows(outsider.orgId)).toEqual([]);
  expect(await db.select().from(invoices).where(eq(invoices.orgId, outsider.orgId))).toEqual([]);
  expect(await admissionCharges(outsider.orgId, own.admission.id)).toEqual([]);
  expect(await hospital.shelfQty(batchId)).toBe(4);
});

// ── Settings ────────────────────────────────────────────────────────────────

test("the IPD invoice prefix defaults to IP, must differ from the other invoice prefixes, and is final once used", async () => {
  const owner = await createTestUser("ipd-prefix-owner");
  const organization = await createOrganization(owner, "ipd-prefix-defaults");
  const fresh = clientFor(owner);
  expect((await fresh.settings.get({ orgSlug: organization.slug })).ipdInvoicePrefix).toBe("IP");

  const hospital = await createHospital("ipd-prefix");
  const { api, orgSlug } = hospital;
  const seed = "ipd-prefix";

  await expectORPCCode(
    api.settings.update(settingsInput(orgSlug, seed, { ipdInvoicePrefix: "INV" })),
    "BAD_REQUEST",
    "the OPD prefix",
  );
  await expectORPCCode(
    api.settings.update(settingsInput(orgSlug, seed, { ipdInvoicePrefix: "PH" })),
    "BAD_REQUEST",
    "the pharmacy prefix",
  );

  await api.settings.update(settingsInput(orgSlug, seed, { ipdInvoicePrefix: "IPD" }));
  expect((await api.settings.get({ orgSlug })).ipdInvoicePrefix).toBe("IPD");

  const { admission } = await readyAdmissionWithService(hospital);
  const issued = await hospital.issueInvoice(admission.id);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, hospital.orgId), eq(invoices.id, issued.invoiceId)));

  expect(invoice?.invoiceNumber).toBe(`IPD${fiscalYearNow()}/1`);

  await expectORPCCode(
    api.settings.update(settingsInput(orgSlug, seed, { ipdInvoicePrefix: "IN" })),
    "CONFLICT",
    "changing an issued IPD prefix",
  );

  // The other streams have issued nothing, so their prefixes may still change.
  await api.settings.update(
    settingsInput(orgSlug, seed, { ipdInvoicePrefix: "IPD", invoicePrefix: "OP" }),
  );
  expect((await api.settings.get({ orgSlug })).invoicePrefix).toBe("OP");
});

// ── Cutover of the existing streams ─────────────────────────────────────────

test("existing OPD Charges and lines are exclusive, counter Pharmacy ones are inclusive, and the counter still rounds to rupees", async () => {
  const hospital = await createHospital("ipd-cutover");
  const { api, orgSlug, orgId } = hospital;
  const service = await hospital.createService({ unitPrice: 500_00n, taxRatePercent: "0" });
  phoneSequence += 1;

  const patient = await api.patient.register({
    orgSlug,
    name: "OPD Patient",
    phone: String(phoneSequence),
    sex: "other",
    dateOfBirth: "1990-01-01",
    dobEstimated: true,
    address: "OPD Address",
  });

  const booked = await api.opd.book({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    scheduledLocal: "2030-03-15T10:30",
    services: [{ catalogItemId: service.id }],
  });

  await api.opd.checkIn({ orgSlug, appointmentId: booked.id });
  const settledOpd = await settlePendingCharges(api, { orgSlug, appointmentId: booked.id });

  const opdCharges = await db
    .select()
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.opdAppointmentId, booked.id)));

  const opdLines = await db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, settledOpd.invoice.id)));

  expect(opdCharges.length).toBeGreaterThan(0);
  expect(opdCharges.every((charge) => charge.priceBasis === "exclusive")).toBe(true);
  expect(opdLines.length).toBeGreaterThan(0);
  expect(opdLines.every((line) => line.priceBasis === "exclusive")).toBe(true);

  const medicine = await hospital.createMedicine({ taxRatePercent: "12.00" });
  const { batchId } = await hospital.receive(medicine.productId, { qty: 2, mrp: 122_86n });

  const sold = await api.pharmacy.sell({
    orgSlug,
    lines: [{ batchId, qty: 1 }],
    buyer: { name: "walk in buyer" },
    payments: [{ method: "cash", amount: 123_00n }],
    expectedGrandTotal: 123_00n,
  });

  const saleCharges = await db
    .select()
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.pharmacySaleId, sold.saleId)));

  const saleLines = await db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, sold.invoiceId)));

  const [saleInvoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, sold.invoiceId)));

  expect(saleCharges.map((charge) => charge.priceBasis)).toEqual(["inclusive"]);
  expect(saleLines.map((line) => line.priceBasis)).toEqual(["inclusive"]);
  expect(saleInvoice).toMatchObject({
    stream: "pharmacy",
    subtotal: 122_86n,
    roundOff: 14n,
    grandTotal: 123_00n,
  });
});

// ── Corrections before and after the Invoice ────────────────────────────────

test("undoing ready after the Invoice is refused", async () => {
  const hospital = await createHospital("ipd-undo-after-invoice");
  const { admission } = await readyAdmissionWithService(hospital);
  await hospital.issueInvoice(admission.id);

  const detail = await hospital.api.ipd.get({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  await expectORPCCode(
    hospital.api.ipd.undoDischargeReady({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedRevision: detail.admission.revision,
      reason: "Patient stays another night",
    }),
    "CONFLICT",
  );

  const after = await hospital.api.ipd.get({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(after.admission.status).toBe("discharge_ready");
  expect(after.admission.revision).toBe(detail.admission.revision);
});

test("a wrongly posted service is voided with a reason before the Invoice: it leaves the bill, bumps the charge revision, and is audited like an OPD void", async () => {
  const hospital = await createHospital("ipd-void-service");
  const { orgId, orgSlug } = hospital;
  const { admission } = await hospital.admit(0);
  const kept = await hospital.createService({ name: "Dressing" });
  const wrong = await hospital.createService({ name: "Wrong procedure" });
  await hospital.postServices(admission.id, [{ catalogItemId: kept.id, qty: 1 }]);
  await hospital.postServices(admission.id, [{ catalogItemId: wrong.id, qty: 1 }]);

  const before = await hospital.api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  expect(before.grandTotal).toBe(12_600_00n);

  const wrongCharge = (await admissionCharges(orgId, admission.id)).find(
    (charge) => charge.catalogItemId === wrong.id,
  );

  if (!wrongCharge) throw new Error("expected the wrong service's Charge");

  const cashier = await hospital.member("cashier");
  await cashier.api.billing.voidCharge({
    orgSlug,
    chargeId: wrongCharge.id,
    reason: "Posted to the wrong Patient",
  });

  const after = await hospital.api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });

  expect(after.chargeRevision).toBe(before.chargeRevision + 1);
  expect(after.grandTotal).toBe(6_300_00n);
  expect(after.lines.map((line) => line.description)).toEqual(["Dressing"]);

  const [voided] = await db
    .select()
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.id, wrongCharge.id)));

  expect(voided).toMatchObject({ status: "voided", voidReason: "Posted to the wrong Patient" });

  const [entry] = await auditEntries(hospital, "charge.void");
  expect(entry).toMatchObject({
    target: `charge:${wrongCharge.id}`,
    meta: { reason: "Posted to the wrong Patient" },
  });

  const keptCharge = (await admissionCharges(orgId, admission.id)).find(
    (charge) => charge.catalogItemId === kept.id,
  );

  if (!keptCharge) throw new Error("expected the kept service's Charge");

  await hospital.api.billing.voidCharge({
    orgSlug,
    chargeId: keptCharge.id,
    reason: "Admitted by mistake",
  });

  const detail = await hospital.api.ipd.get({ orgSlug, admissionId: admission.id });

  const cancelled = await hospital.api.ipd.cancel({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: detail.admission.revision,
    reason: "Admitted by mistake",
  });

  expect(cancelled.status).toBe("cancelled");
});

test("an issued medicine Charge cannot be voided, and nothing can be voided after the Invoice", async () => {
  const hospital = await createHospital("ipd-void-refused");
  const { orgId, orgSlug, api } = hospital;
  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const { admission } = await readyAdmissionWithService(hospital);
  await hospital.issue(admission.id, [{ batchId, qty: 2 }]);

  const charged = await admissionCharges(orgId, admission.id);
  const medicineCharge = charged.find((charge) => charge.admissionKind === "pharmacy_issue");
  const serviceCharge = charged.find((charge) => charge.admissionKind === "service");

  if (!medicineCharge || !serviceCharge) throw new Error("expected both Admission Charges");

  const revision = await hospital.chargeRevision(admission.id);

  await expectORPCCode(
    api.billing.voidCharge({ orgSlug, chargeId: medicineCharge.id, reason: "Not given" }),
    "CONFLICT",
    "voiding an issued medicine",
  );

  expect(await hospital.shelfQty(batchId)).toBe(3);
  expect(await admissionCharges(orgId, admission.id)).toEqual(charged);
  expect(await hospital.chargeRevision(admission.id)).toBe(revision);

  await hospital.issueInvoice(admission.id);
  const billed = await admissionCharges(orgId, admission.id);

  await expectORPCCode(
    api.billing.voidCharge({ orgSlug, chargeId: serviceCharge.id, reason: "Too late" }),
    "CONFLICT",
    "voiding a service after the Invoice",
  );
  await expectORPCCode(
    api.billing.voidCharge({ orgSlug, chargeId: medicineCharge.id, reason: "Too late" }),
    "CONFLICT",
    "voiding a medicine after the Invoice",
  );

  expect(await hospital.shelfQty(batchId)).toBe(3);
  expect(await admissionCharges(orgId, admission.id)).toEqual(billed);
});

test("another organization cannot void this one's Admission Charge", async () => {
  const hospital = await createHospital("ipd-void-home");
  const outsider = await createHospital("ipd-void-away");
  const { admission } = await readyAdmissionWithService(hospital);
  const charged = await admissionCharges(hospital.orgId, admission.id);
  const [charge] = charged;

  if (!charge) throw new Error("expected the service Charge");

  await expectORPCCode(
    outsider.api.billing.voidCharge({
      orgSlug: outsider.orgSlug,
      chargeId: charge.id,
      reason: "Not ours",
    }),
    "NOT_FOUND",
  );

  expect(await admissionCharges(hospital.orgId, admission.id)).toEqual(charged);
});

test("a registered organization's ipd Invoice needs the patient's address, and may carry GST", async () => {
  const seed = "ipd-registered";
  const hospital = await createHospital(seed);
  const { orgId, orgSlug, api } = hospital;
  await api.settings.update({ ...settingsInput(orgSlug, seed), gstin: "27ABCDE1234F1Z5" });

  const medicine = await hospital.createMedicine();
  const { batchId } = await hospital.receive(medicine.productId, { qty: 5 });
  const service = await hospital.createService();

  phoneSequence += 1;

  const patient = await api.patient.register({
    orgSlug,
    name: `${seed} Patient without address`,
    phone: String(phoneSequence),
    sex: "other",
    dateOfBirth: "1980-01-01",
    dobEstimated: true,
  });

  const admission = await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: hospital.beds[0]!.id,
  });

  await hospital.postServices(admission.id, [{ catalogItemId: service.id, qty: 1 }]);
  await hospital.issue(admission.id, [{ batchId, qty: 2 }]);
  await hospital.markReady(admission.id);

  let refusal: { code?: string; message?: string } | undefined;

  try {
    await hospital.issueInvoice(admission.id);
  } catch (error) {
    // SAFETY: oRPC client errors carry `code` and `message`; asserted below.
    refusal = error as { code?: string; message?: string };
  }

  expect(refusal?.code).toBe("BAD_REQUEST");
  expect(refusal?.message).toContain("address");
  expect(refusal?.message).not.toContain("Bill of Supply");
  expect(await db.select().from(invoices).where(eq(invoices.orgId, orgId))).toEqual([]);

  await db
    .update(patients)
    .set({ address: `${seed} Patient Address` })
    .where(and(eq(patients.orgId, orgId), eq(patients.id, patient.id)));

  const issued = await hospital.issueInvoice(admission.id);

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, issued.invoiceId)));

  expect(invoice).toMatchObject({
    orgGstin: "27ABCDE1234F1Z5",
    taxTotal: 300_00n,
    grandTotal: 6_524_00n,
  });
});
