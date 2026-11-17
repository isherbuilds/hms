// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 6 (returns and corrections).
// A return before the bill takes the quantity off it; after the bill it is a Credit Note.
// Either way the goods go to quarantine and no Charge is ever deleted.
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { stockMovements } from "@hms/db/schema/stock-movements";
import { and, asc, eq } from "drizzle-orm";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const DAY = 24 * 60 * 60 * 1_000;

const MRP = 112_00n;

const EXPIRY_YEAR = new Date().getUTCFullYear() + 3;

let phoneSequence = 5_620_000;

async function createHospital(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const orgSlug = organization.slug;
  const orgId = organization.id;
  const api = clientFor(owner);

  await api.settings.update({
    orgSlug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "",
    gstin: "",
    drugLicence20: "",
    drugLicence21: "",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    pharmacyInvoicePrefix: "PH",
    ipdInvoicePrefix: "IP",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 1,
    ipdCheckoutMinutes: 720,
  });

  const createService = (name: string, unitPrice: bigint) =>
    api.catalog.create({
      orgSlug,
      name: `${seed} ${name}`,
      category: "procedure",
      unitPrice,
      taxRatePercent: "0",
      taxCode: "",
      customRate: false,
    });

  const room = await createService("Room rent", 1_000_00n);
  const dressing = await createService("Dressing", 500_00n);
  const department = await api.staff.createDepartment({ orgSlug, name: `${seed} Medicine` });

  const practitioner = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed}`,
    departmentId: department.id,
  });

  const ward = await api.ipd.createWard({ orgSlug, name: "Main" });
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General" });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: category.id,
    effectiveFrom: new Date(Date.now() - 60 * DAY),
    lines: [{ catalogItemId: room.id, dailyPrice: 1_000_00n }],
  });

  const beds: Array<Awaited<ReturnType<typeof api.ipd.createBed>>> = [];

  for (const label of ["G-1", "G-2", "G-3"]) {
    beds.push(
      await api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label }),
    );
  }

  /** A received batch of `qty` units at ₹112.00 each. */
  async function stock(qty: number) {
    const product = await api.pharmacy.createProduct({
      orgSlug,
      name: `${seed} Medicine ${uniqueSuffix()}`,
      sold: true,
      taxRatePercent: "12.00",
      taxCode: "3004",
      active: true,
      stockUnit: "tablet",
      unitsPerPack: 1,
      expires: true,
      pack: "10 tablets",
      schedule: "none",
    });

    const received = await api.pharmacy.receiveGoods({
      orgSlug,
      supplierName: `${seed} Supplier`,
      receivedOn: "2026-09-01",
      billTotal: 0n,
      lines: [
        {
          productId: product.productId,
          batchNumber: `B-${uniqueSuffix()}`,
          expiryDate: `${EXPIRY_YEAR}-12`,
          mrp: MRP,
          pricedPer: "unit",
          cost: { freeQty: 0, rate: 0n, discountPercent: "0", gstPercent: "0" },
          qty,
        },
      ],
    });

    const [batch] = received.batches;

    if (!batch) throw new Error("expected a received batch");

    return batch.batchId;
  }

  async function onHand(batchId: string) {
    const { items } = await api.pharmacy.stockOnHand({ orgSlug, includeZero: true });
    const row = items.find((candidate) => candidate.batchId === batchId);

    if (!row) throw new Error(`expected stock for batch ${batchId}`);

    return { shelf: row.shelfQty, quarantine: row.quarantineQty };
  }

  async function admit(bedIndex: number) {
    phoneSequence += 1;

    const patient = await api.patient.register({
      orgSlug,
      name: `${seed} Patient ${uniqueSuffix()}`,
      phone: String(phoneSequence),
      sex: "other",
      dateOfBirth: "1980-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });

    return api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[bedIndex]!.id,
    });
  }

  async function revision(admissionId: string) {
    return (await api.ipd.get({ orgSlug, admissionId })).admission.chargeRevision;
  }

  /** Issues one batch line and returns its issue line id. */
  async function issue(admissionId: string, batchId: string, qty: number) {
    await api.pharmacy.issueToAdmission({
      orgSlug,
      admissionId,
      expectedChargeRevision: await revision(admissionId),
      lines: [{ batchId, qty }],
    });

    const { issues } = await api.pharmacy.listAdmissionIssues({ orgSlug, admissionId });

    const line = issues
      .flatMap((entry) => entry.lines)
      .findLast((entry) => entry.batchId === batchId);

    if (!line) throw new Error("expected the issue line");

    return line.id;
  }

  async function issueLine(admissionId: string, issueLineId: string) {
    const { issues } = await api.pharmacy.listAdmissionIssues({ orgSlug, admissionId });
    const line = issues.flatMap((entry) => entry.lines).find((entry) => entry.id === issueLineId);

    if (!line) throw new Error("expected the issue line");

    return line;
  }

  async function giveBack(
    admissionId: string,
    lines: Array<{ issueLineId: string; qty: number }>,
    client: AppRouterClient = api,
    reason = "Not needed after the dose change",
  ) {
    return client.pharmacy.returnFromAdmission({
      orgSlug,
      admissionId,
      expectedChargeRevision: await revision(admissionId),
      lines,
      reason,
    });
  }

  async function postService(admissionId: string) {
    return api.ipd.postServices({
      orgSlug,
      admissionId,
      expectedChargeRevision: await revision(admissionId),
      lines: [{ catalogItemId: dressing.id, qty: 1 }],
    });
  }

  async function ready(admissionId: string) {
    const { admission } = await api.ipd.get({ orgSlug, admissionId });

    return api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: admission.revision,
    });
  }

  /** Marks the stay ready if it is not, then issues its bill, paid in full by UPI. */
  async function billPaid(admissionId: string) {
    const { admission } = await api.ipd.get({ orgSlug, admissionId });

    if (admission.status === "admitted") await ready(admissionId);

    const quote = await api.ipd.previewInvoice({ orgSlug, admissionId });

    const issued = await api.ipd.issueInvoice({
      orgSlug,
      admissionId,
      expectedChargeRevision: quote.chargeRevision,
      expectedGrandTotal: quote.pending.grandTotal,
      payments: [{ method: "upi", amount: quote.pending.grandTotal, reference: "UPI-1" }],
    });

    if (!issued.invoiceId) throw new Error("expected an Invoice");

    return { invoiceId: issued.invoiceId, total: quote.pending.grandTotal };
  }

  async function chargeRows(admissionId: string) {
    return db
      .select()
      .from(charges)
      .where(and(eq(charges.orgId, orgId), eq(charges.admissionId, admissionId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));
  }

  async function medicineCharges(admissionId: string) {
    return (await chargeRows(admissionId)).filter(
      (charge) => charge.admissionKind === "pharmacy_issue",
    );
  }

  async function movementRows(batchId: string) {
    return db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.orgId, orgId), eq(stockMovements.batchId, batchId)))
      .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
  }

  async function invoiceLineRows(invoiceId: string) {
    return db
      .select({
        id: invoiceLines.id,
        chargeId: invoiceLines.chargeId,
        description: invoiceLines.description,
        qty: invoiceLines.qty,
        gross: invoiceLines.gross,
        admissionKind: charges.admissionKind,
      })
      .from(invoiceLines)
      .innerJoin(charges, and(eq(charges.orgId, orgId), eq(charges.id, invoiceLines.chargeId)))
      .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, invoiceId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));
  }

  async function creditNoteRows() {
    return db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.orgId, orgId))
      .orderBy(asc(creditNotes.createdAt), asc(creditNotes.id));
  }

  async function creditLines(creditNoteId: string) {
    return db
      .select({ invoiceLineId: creditNoteLines.invoiceLineId, gross: creditNoteLines.gross })
      .from(creditNoteLines)
      .where(and(eq(creditNoteLines.orgId, orgId), eq(creditNoteLines.creditNoteId, creditNoteId)));
  }

  async function member(role: Parameters<typeof joinOrganization>[2]) {
    const user: TestUser = await createTestUser(`${seed}-${role}`);
    await joinOrganization(user, orgId, role);

    return clientFor(user);
  }

  async function auditEntries(action: string) {
    await drainAuditWrites();

    return eventually(async () => {
      const log = await api.audit.list({ orgSlug });
      const entries = log.items.filter((entry) => entry.action === action);

      return entries.length > 0 ? entries : undefined;
    });
  }

  return {
    orgSlug,
    orgId,
    api,
    dressing,
    stock,
    onHand,
    admit,
    revision,
    issue,
    issueLine,
    giveBack,
    postService,
    ready,
    billPaid,
    chargeRows,
    medicineCharges,
    movementRows,
    invoiceLineRows,
    creditNoteRows,
    creditLines,
    member,
    auditEntries,
  };
}

// ── Before the bill ─────────────────────────────────────────────────────────

test("a part return before the bill takes the quantity off the running bill and puts the goods in quarantine", async () => {
  const hospital = await createHospital("return-before");
  const { api, orgSlug } = hospital;
  const pharmacist = await hospital.member("pharmacist");
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const issueLineId = await hospital.issue(admission.id, batchId, 5);

  const [original] = await hospital.medicineCharges(admission.id);
  const before = await hospital.revision(admission.id);

  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 0 });

  const result = await hospital.giveBack(admission.id, [{ issueLineId, qty: 2 }], pharmacist);

  expect(result.returnId).toBeTruthy();
  expect(result.creditNoteId).toBeNull();
  expect(result.chargeRevision).toBeGreaterThan(before);
  expect(await hospital.revision(admission.id)).toBe(result.chargeRevision);

  // Quarantine, never the shelf (D041).
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 2 });

  const movement = (await hospital.movementRows(batchId)).at(-1);

  expect(movement).toMatchObject({
    bucket: "quarantine",
    qty: 2,
    reason: "return",
    sourceType: "admission_pharmacy_return",
    sourceId: result.returnId,
  });

  // The old Charge is voided, not deleted, and the rest is posted again unchanged.
  const after = await hospital.medicineCharges(admission.id);

  expect(after).toHaveLength(2);
  expect(after[0]).toMatchObject({
    id: original!.id,
    status: "voided",
    voidReason: "Not needed after the dose change",
    qty: 5,
  });
  expect(after[1]).toMatchObject({
    status: "pending",
    qty: 3,
    admissionIssueLineId: issueLineId,
    stockBatchId: batchId,
    unitPrice: original!.unitPrice,
    priceUnits: original!.priceUnits,
    taxRatePercent: original!.taxRatePercent,
    description: original!.description,
    priceBasis: "inclusive",
    revenueCategory: "pharmacy",
  });

  const quote = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  const medicine = quote.pending.lines.filter((line) => line.admissionKind === "pharmacy_issue");

  expect(medicine.map((line) => [line.qty, line.gross])).toEqual([[3, 3n * MRP]]);
  expect(await hospital.creditNoteRows()).toEqual([]);

  expect(await hospital.issueLine(admission.id, issueLineId)).toMatchObject({
    qty: 5,
    returnedQty: 2,
    chargeStatus: "pending",
  });

  const [entry] = await hospital.auditEntries("pharmacy.returnFromAdmission");

  expect(entry).toMatchObject({
    target: `admissionPharmacyReturn:${result.returnId}`,
    meta: { admissionId: admission.id, reason: "Not needed after the dose change" },
  });
});

test("a full return before the bill leaves nothing of that line to bill", async () => {
  const hospital = await createHospital("return-full");
  const { api, orgSlug } = hospital;
  const batchId = await hospital.stock(4);
  const admission = await hospital.admit(0);
  const issueLineId = await hospital.issue(admission.id, batchId, 4);

  await hospital.giveBack(admission.id, [{ issueLineId, qty: 4 }]);

  const after = await hospital.medicineCharges(admission.id);

  expect(after.map((charge) => charge.status)).toEqual(["voided"]);
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 0, quarantine: 4 });

  const quote = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  expect(quote.pending.lines.filter((line) => line.admissionKind === "pharmacy_issue")).toEqual([]);

  expect(await hospital.issueLine(admission.id, issueLineId)).toMatchObject({
    qty: 4,
    returnedQty: 4,
  });
});

test("a return never exceeds what was issued, across several returns", async () => {
  const hospital = await createHospital("return-limit");
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const issueLineId = await hospital.issue(admission.id, batchId, 5);

  await expectORPCCode(
    hospital.giveBack(admission.id, [{ issueLineId, qty: 6 }]),
    "BAD_REQUEST",
    "more than was issued",
  );

  await hospital.giveBack(admission.id, [{ issueLineId, qty: 2 }]);
  const settled = await hospital.chargeRows(admission.id);
  const moved = await hospital.movementRows(batchId);

  await expectORPCCode(
    hospital.giveBack(admission.id, [{ issueLineId, qty: 4 }]),
    "BAD_REQUEST",
    "more than is left",
  );

  expect(await hospital.chargeRows(admission.id)).toEqual(settled);
  expect(await hospital.movementRows(batchId)).toEqual(moved);

  await hospital.giveBack(admission.id, [{ issueLineId, qty: 3 }]);

  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 5 });
  expect((await hospital.medicineCharges(admission.id)).map((charge) => charge.status)).toEqual([
    "voided",
    "voided",
  ]);

  await expectORPCCode(
    hospital.giveBack(admission.id, [{ issueLineId, qty: 1 }]),
    "BAD_REQUEST",
    "nothing left to return",
  );
});

// ── After the bill ──────────────────────────────────────────────────────────

test("a return after the bill issues a Credit Note for the same line and leaves the Charge alone", async () => {
  const hospital = await createHospital("return-after");
  const { api, orgSlug } = hospital;
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const issueLineId = await hospital.issue(admission.id, batchId, 5);
  const { invoiceId } = await hospital.billPaid(admission.id);

  const billed = await hospital.medicineCharges(admission.id);
  const lines = await hospital.invoiceLineRows(invoiceId);
  const medicineLine = lines.find((line) => line.admissionKind === "pharmacy_issue");

  if (!medicineLine) throw new Error("expected the medicine's Invoice line");

  const result = await hospital.giveBack(admission.id, [{ issueLineId, qty: 2 }]);

  expect(result.creditNoteId).toBeTruthy();

  const [creditNote] = await hospital.creditNoteRows();

  expect(creditNote).toMatchObject({
    id: result.creditNoteId!,
    invoiceId,
    total: 2n * MRP,
    reason: "Not needed after the dose change",
  });
  expect(await hospital.creditLines(creditNote!.id)).toEqual([
    { invoiceLineId: medicineLine.id, gross: 2n * MRP },
  ]);

  // The billed Charge and its line are history: nothing about them changes.
  expect(await hospital.medicineCharges(admission.id)).toEqual(billed);
  expect(await hospital.invoiceLineRows(invoiceId)).toEqual(lines);
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 2 });

  // The Patient paid in full, so the credit is owed back and refunded the usual way.
  const invoice = await api.billing.getInvoice({ orgSlug, invoiceId });
  expect(invoice.balance.outstanding).toBe(-2n * MRP);

  const refund = await api.billing.recordRefund({
    orgSlug,
    creditNoteId: creditNote!.id,
    method: "cash",
    amount: 2n * MRP,
  });

  expect(refund.amount).toBe(2n * MRP);

  // The rest of the line can still come back, and no further.
  await hospital.giveBack(admission.id, [{ issueLineId, qty: 3 }]);

  expect((await hospital.creditNoteRows()).map((note) => note.total)).toEqual([2n * MRP, 3n * MRP]);
  expect(await hospital.issueLine(admission.id, issueLineId)).toMatchObject({
    qty: 5,
    returnedQty: 5,
    chargeStatus: "invoiced",
  });

  await expectORPCCode(
    hospital.giveBack(admission.id, [{ issueLineId, qty: 1 }]),
    "BAD_REQUEST",
    "nothing left to return",
  );
});

test("one return may hold a billed line and a line not yet billed", async () => {
  const hospital = await createHospital("return-mixed");
  const { api, orgSlug } = hospital;
  const billedBatch = await hospital.stock(10);
  const lateBatch = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const billedLine = await hospital.issue(admission.id, billedBatch, 4);
  const { invoiceId } = await hospital.billPaid(admission.id);
  const lateLine = await hospital.issue(admission.id, lateBatch, 3);

  const result = await hospital.giveBack(admission.id, [
    { issueLineId: billedLine, qty: 1 },
    { issueLineId: lateLine, qty: 2 },
  ]);

  const [creditNote] = await hospital.creditNoteRows();

  expect(creditNote).toMatchObject({ id: result.creditNoteId!, invoiceId, total: MRP });
  expect(await hospital.onHand(billedBatch)).toEqual({ shelf: 6, quarantine: 1 });
  expect(await hospital.onHand(lateBatch)).toEqual({ shelf: 7, quarantine: 2 });

  const quote = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  const pending = quote.pending.lines.filter((line) => line.admissionKind === "pharmacy_issue");

  expect(pending.map((line) => [line.qty, line.gross])).toEqual([[1, MRP]]);
});

test("billed lines of two Invoices are returned one bill at a time", async () => {
  const hospital = await createHospital("return-two-bills");
  const batchId = await hospital.stock(20);
  const admission = await hospital.admit(0);
  const first = await hospital.issue(admission.id, batchId, 2);
  await hospital.billPaid(admission.id);
  const second = await hospital.issue(admission.id, batchId, 2);
  await hospital.billPaid(admission.id);

  await expectORPCCode(
    hospital.giveBack(admission.id, [
      { issueLineId: first, qty: 1 },
      { issueLineId: second, qty: 1 },
    ]),
    "BAD_REQUEST",
  );

  expect(await hospital.creditNoteRows()).toEqual([]);
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 16, quarantine: 0 });

  await hospital.giveBack(admission.id, [{ issueLineId: first, qty: 1 }]);
  await hospital.giveBack(admission.id, [{ issueLineId: second, qty: 1 }]);

  expect(await hospital.creditNoteRows()).toHaveLength(2);
});

// ── Refusals ────────────────────────────────────────────────────────────────

test("a return needs the current charge revision and this Admission's own issue lines, each once", async () => {
  const hospital = await createHospital("return-refusals");
  const away = await createHospital("return-refusals-away");
  const { api, orgSlug } = hospital;
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const neighbour = await hospital.admit(1);
  const issueLineId = await hospital.issue(admission.id, batchId, 5);
  const neighbourLine = await hospital.issue(neighbour.id, batchId, 2);
  const current = await hospital.revision(admission.id);

  const attempt = (input: {
    admissionId?: string;
    expectedChargeRevision?: number;
    lines: Array<{ issueLineId: string; qty: number }>;
  }) =>
    api.pharmacy.returnFromAdmission({
      orgSlug,
      admissionId: input.admissionId ?? admission.id,
      expectedChargeRevision: input.expectedChargeRevision ?? current,
      lines: input.lines,
      reason: "Refusal probe",
    });

  await expectORPCCode(
    attempt({ expectedChargeRevision: current - 1, lines: [{ issueLineId, qty: 1 }] }),
    "CONFLICT",
    "a stale revision",
  );
  await expectORPCCode(
    attempt({ lines: [{ issueLineId: neighbourLine, qty: 1 }] }),
    "NOT_FOUND",
    "another Admission's issue line",
  );
  await expectORPCCode(
    attempt({ lines: [{ issueLineId: "missing", qty: 1 }] }),
    "NOT_FOUND",
    "an unknown issue line",
  );
  await expectORPCCode(
    attempt({
      lines: [
        { issueLineId, qty: 1 },
        { issueLineId, qty: 1 },
      ],
    }),
    "BAD_REQUEST",
    "one issue line twice",
  );
  await expectORPCCode(
    attempt({ admissionId: "missing", lines: [{ issueLineId, qty: 1 }] }),
    "NOT_FOUND",
    "an unknown Admission",
  );
  await expectORPCCode(attempt({ lines: [] }), "BAD_REQUEST", "no lines");

  // Another hospital cannot reach this stay or its lines.
  await expectORPCCode(
    away.api.pharmacy.returnFromAdmission({
      orgSlug: away.orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: current,
      lines: [{ issueLineId, qty: 1 }],
      reason: "Refusal probe",
    }),
    "NOT_FOUND",
    "another hospital",
  );

  expect(await hospital.onHand(batchId)).toEqual({ shelf: 3, quarantine: 0 });
  expect(await hospital.revision(admission.id)).toBe(current);
});

test("the pharmacist returns ward medicine; reception and the cashier cannot", async () => {
  const hospital = await createHospital("return-grants");
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  const issueLineId = await hospital.issue(admission.id, batchId, 5);

  for (const role of ["reception", "cashier"] as const) {
    await expectORPCCode(
      hospital.giveBack(admission.id, [{ issueLineId, qty: 1 }], await hospital.member(role)),
      "FORBIDDEN",
      role,
    );
  }

  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 0 });

  const denials = await hospital.auditEntries("rbac.permission");
  expect(denials.length).toBeGreaterThan(0);

  await hospital.giveBack(
    admission.id,
    [{ issueLineId, qty: 1 }],
    await hospital.member("pharmacist"),
  );
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 5, quarantine: 1 });
});

// ── Credit Notes on the IPD bill ────────────────────────────────────────────

test("service and bed-day lines on an IPD Invoice are credited through the Credit Note path", async () => {
  const hospital = await createHospital("return-credit-lines");
  const { api, orgSlug } = hospital;
  const admission = await hospital.admit(0);
  await hospital.postService(admission.id);
  const { invoiceId, total } = await hospital.billPaid(admission.id);

  expect(total).toBe(1_500_00n);

  const lines = await hospital.invoiceLineRows(invoiceId);
  const service = lines.find((line) => line.admissionKind === "service");
  const bedDay = lines.find((line) => line.admissionKind === "bed_day");

  if (!service || !bedDay) throw new Error("expected a service line and a bed-day line");

  const billedDays = (await api.ipd.get({ orgSlug, admissionId: admission.id })).admission
    .bedDaysBilled;

  const credited = await api.billing.issueCreditNote({
    orgSlug,
    invoiceId,
    reason: "Dressing not done; bed day billed in error",
    lines: [
      { invoiceLineId: service.id, gross: 200_00n },
      { invoiceLineId: bedDay.id, full: true },
    ],
  });

  expect(credited.creditNote).toMatchObject({ invoiceId, total: 1_200_00n });
  expect(
    Object.fromEntries(credited.lines.map((line) => [line.invoiceLineId, line.gross])),
  ).toEqual({ [service.id]: 200_00n, [bedDay.id]: 1_000_00n });

  // A billed bed day is corrected on paper only: the count never moves backwards.
  const after = await api.ipd.get({ orgSlug, admissionId: admission.id });

  expect(after.admission.bedDaysBilled).toBe(billedDays);
  expect(
    (await hospital.chargeRows(admission.id)).every((charge) => charge.status === "invoiced"),
  ).toBe(true);

  const invoice = await api.billing.getInvoice({ orgSlug, invoiceId });
  expect(invoice.balance.outstanding).toBe(-1_200_00n);

  // The same line cannot be credited past its value.
  await expectORPCCode(
    api.billing.issueCreditNote({
      orgSlug,
      invoiceId,
      reason: "Twice",
      lines: [{ invoiceLineId: bedDay.id, full: true }],
    }),
    "BAD_REQUEST",
  );
});

test("a medicine line on an IPD Invoice is corrected by a return, not a bare Credit Note", async () => {
  const hospital = await createHospital("return-credit-medicine");
  const { api, orgSlug } = hospital;
  const batchId = await hospital.stock(10);
  const admission = await hospital.admit(0);
  await hospital.issue(admission.id, batchId, 2);
  const { invoiceId } = await hospital.billPaid(admission.id);

  const medicine = (await hospital.invoiceLineRows(invoiceId)).find(
    (line) => line.admissionKind === "pharmacy_issue",
  );

  if (!medicine) throw new Error("expected the medicine's Invoice line");

  await expectORPCCode(
    api.billing.issueCreditNote({
      orgSlug,
      invoiceId,
      reason: "Medicine not given",
      lines: [{ invoiceLineId: medicine.id, full: true }],
    }),
    "CONFLICT",
  );

  expect(await hospital.creditNoteRows()).toEqual([]);
  expect(await hospital.onHand(batchId)).toEqual({ shelf: 8, quarantine: 0 });
});

test("the accountant credits an IPD line; the cashier cannot", async () => {
  const hospital = await createHospital("return-credit-grants");
  const { orgSlug } = hospital;
  const admission = await hospital.admit(0);
  await hospital.postService(admission.id);
  const { invoiceId } = await hospital.billPaid(admission.id);

  const service = (await hospital.invoiceLineRows(invoiceId)).find(
    (line) => line.admissionKind === "service",
  );

  if (!service) throw new Error("expected the service's Invoice line");

  const input = {
    orgSlug,
    invoiceId,
    reason: "Dressing not done",
    lines: [{ invoiceLineId: service.id, full: true as const }],
  };

  const cashier = await hospital.member("cashier");
  await expectORPCCode(cashier.billing.issueCreditNote(input), "FORBIDDEN");

  const accountant = await hospital.member("accountant");
  const credited = await accountant.billing.issueCreditNote(input);

  expect(credited.creditNote.total).toBe(500_00n);
});
