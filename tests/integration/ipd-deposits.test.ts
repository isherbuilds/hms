// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 5 (deposits and settlement).
// A deposit is an Advance Receipt tagged to the Admission; it pays only that stay's bills.
import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { payments } from "@hms/db/schema/payments";
import { and, asc, eq } from "drizzle-orm";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { addPendingCatalogCharge, settlePendingCharges } from "../support/billing";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const DAY = 24 * 60 * 60 * 1_000;

// Account codes of the system chart.
const CASH = "1000";

const BANK = "1100";

const RECEIVABLES = "1200";

const ADVANCES = "2200";

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

let phoneSequence = 5_610_000;

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
  const procedure = await createService("Procedure", 8_000_00n);
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

  for (const label of ["G-1", "G-2", "G-3", "G-4"]) {
    beds.push(
      await api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label }),
    );
  }

  async function registerPatient() {
    phoneSequence += 1;

    return api.patient.register({
      orgSlug,
      name: `${seed} Patient ${uniqueSuffix()}`,
      phone: String(phoneSequence),
      sex: "other",
      dateOfBirth: "1980-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });
  }

  /** Admitted now, so a bill issued in this test holds exactly one ₹1,000 bed day. */
  async function admit(bedIndex: number, patientId?: string) {
    const patient = patientId ? { id: patientId } : await registerPatient();

    const admission = await api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[bedIndex]!.id,
    });

    return { patientId: patient.id, admission };
  }

  async function detail(admissionId: string) {
    return api.ipd.get({ orgSlug, admissionId });
  }

  async function ready(admissionId: string) {
    const { admission } = await detail(admissionId);

    return api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: admission.revision,
    });
  }

  async function depart(admissionId: string) {
    const marked = await ready(admissionId);

    return api.ipd.discharge({
      orgSlug,
      admissionId,
      expectedRevision: marked.revision,
      dischargeType: "normal",
    });
  }

  async function postService(admissionId: string, catalogItemId = procedure.id, qty = 1) {
    const { admission } = await detail(admissionId);

    return api.ipd.postServices({
      orgSlug,
      admissionId,
      expectedChargeRevision: admission.chargeRevision,
      lines: [{ catalogItemId, qty }],
    });
  }

  type Method = "cash" | "upi" | "card" | "bank";

  function deposit(
    patientId: string,
    admissionId: string,
    amount: bigint,
    method: Method = "cash",
    client: AppRouterClient = api,
  ) {
    return client.billing.recordAdvance({
      orgSlug,
      patientId,
      admissionId,
      method,
      amount,
      reference: method === "cash" ? undefined : `REF-${uniqueSuffix()}`,
    });
  }

  type Settlement = {
    applyCredit?: bigint;
    payments?: Array<{ method: Method; amount: bigint; reference?: string }>;
    outstandingReason?: string;
    discountAmount?: bigint;
    discountReason?: string;
  };

  /** Issues the bill the preview shows, settled as given. */
  async function bill(admissionId: string, settlement: Settlement = {}) {
    const quote = await api.ipd.previewInvoice({
      orgSlug,
      admissionId,
      discountAmount: settlement.discountAmount,
    });

    return api.ipd.issueInvoice({
      orgSlug,
      admissionId,
      expectedChargeRevision: quote.chargeRevision,
      expectedGrandTotal: quote.pending.grandTotal,
      payments: [],
      ...settlement,
    });
  }

  async function member(role: Parameters<typeof joinOrganization>[2]) {
    const user: TestUser = await createTestUser(`${seed}-${role}`);
    await joinOrganization(user, orgId, role);

    return clientFor(user);
  }

  /** Debits less credits across every journal entry of this hospital, per account code. */
  async function ledger() {
    const lines = await db
      .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, orgId)))
      .where(eq(journalLines.orgId, orgId));

    const net = new Map<string, bigint>();

    for (const line of lines) {
      net.set(line.code, (net.get(line.code) ?? 0n) + line.debit - line.credit);
    }

    return (code: string) => net.get(code) ?? 0n;
  }

  async function journalFor(sourceType: string, sourceId: string) {
    return db
      .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        and(eq(journalEntries.orgId, orgId), eq(journalEntries.id, journalLines.entryId)),
      )
      .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, orgId)))
      .where(
        and(
          eq(journalLines.orgId, orgId),
          eq(journalEntries.sourceType, sourceType),
          eq(journalEntries.sourceId, sourceId),
        ),
      )
      .orderBy(asc(accounts.code));
  }

  async function allocationsFor(invoiceId: string) {
    const rows = await db
      .select({
        advanceReceiptId: advanceAllocations.advanceReceiptId,
        amount: advanceAllocations.amount,
      })
      .from(advanceAllocations)
      .where(and(eq(advanceAllocations.orgId, orgId), eq(advanceAllocations.invoiceId, invoiceId)));

    return new Map(rows.map((row) => [row.advanceReceiptId, row.amount]));
  }

  async function invoiceRows() {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.orgId, orgId))
      .orderBy(asc(invoices.createdAt), asc(invoices.id));
  }

  async function receiptRows() {
    return db
      .select()
      .from(advanceReceipts)
      .where(eq(advanceReceipts.orgId, orgId))
      .orderBy(asc(advanceReceipts.createdAt), asc(advanceReceipts.id));
  }

  return {
    owner,
    orgSlug,
    orgId,
    api,
    procedure,
    practitioner,
    beds,
    createService,
    registerPatient,
    admit,
    detail,
    ready,
    depart,
    postService,
    deposit,
    bill,
    member,
    ledger,
    journalFor,
    allocationsFor,
    invoiceRows,
    receiptRows,
  };
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    // SAFETY: oRPC client errors are Errors carrying the handler's message.
    return (error as Error).message;
  }

  throw new Error("expected the call to be refused");
}

// ── Taking a deposit ────────────────────────────────────────────────────────

test("a deposit on an Admission is an Advance Receipt tagged to the stay, and shows as deposit held", async () => {
  const hospital = await createHospital("deposit-take");
  const { api, orgSlug, orgId, beds } = hospital;
  const cashier = await hospital.member("cashier");
  const { patientId, admission } = await hospital.admit(0);

  expect((await hospital.detail(admission.id)).depositHeld).toBe(0n);

  const receipt = await hospital.deposit(patientId, admission.id, 5_000_00n, "cash", cashier);

  expect(receipt).toMatchObject({
    patientId,
    admissionId: admission.id,
    treatmentPlanId: null,
    method: "cash",
    amount: 5_000_00n,
    receiptNumber: `ADV${fiscalYearNow()}/1`,
    purpose: `IPD deposit · IPD No. ${admission.admissionNumber}`,
  });

  // It prints as the ordinary Advance Receipt.
  const printed = await api.billing.getAdvanceReceipt({ orgSlug, advanceId: receipt.id });

  expect(printed.receipt).toMatchObject({
    id: receipt.id,
    admissionId: admission.id,
    receiptNumber: receipt.receiptNumber,
  });

  // A liability, not a Payment: cash against Patient Advances.
  expect(await db.select().from(payments).where(eq(payments.orgId, orgId))).toEqual([]);
  expect(await hospital.journalFor("advance_receipt", receipt.id)).toEqual([
    { code: CASH, debit: 5_000_00n, credit: 0n },
    { code: ADVANCES, debit: 0n, credit: 5_000_00n },
  ]);

  await hospital.deposit(patientId, admission.id, 2_000_00n, "upi");

  expect((await hospital.detail(admission.id)).depositHeld).toBe(7_000_00n);

  const list = await api.ipd.list({ orgSlug });
  expect(list.items.find((item) => item.id === admission.id)?.depositHeld).toBe(7_000_00n);

  const board = await api.ipd.bedBoard({ orgSlug });
  const bed = board.beds.find((candidate) => candidate.id === beds[0]!.id);
  expect(bed?.admission?.depositHeld).toBe(7_000_00n);

  // Another stay holds nothing.
  const other = await hospital.admit(1);
  expect((await hospital.detail(other.admission.id)).depositHeld).toBe(0n);
});

test("a deposit needs an active Admission of that Patient", async () => {
  const hospital = await createHospital("deposit-refusals");
  const away = await createHospital("deposit-refusals-away");
  const { api, orgSlug } = hospital;
  const { patientId, admission } = await hospital.admit(0);
  const stranger = await hospital.admit(1);
  const foreign = await away.admit(0);

  const attempt = (admissionId: string, extra: { treatmentPlanId?: string } = {}) =>
    api.billing.recordAdvance({
      orgSlug,
      patientId,
      admissionId,
      method: "cash",
      amount: 1_000_00n,
      ...extra,
    });

  await expectORPCCode(attempt(stranger.admission.id), "CONFLICT", "another Patient's stay");
  await expectORPCCode(attempt(foreign.admission.id), "CONFLICT", "another hospital's stay");
  await expectORPCCode(attempt("missing"), "CONFLICT", "an unknown stay");
  await expectORPCCode(
    attempt(admission.id, { treatmentPlanId: "any-plan" }),
    "BAD_REQUEST",
    "a plan and a stay together",
  );

  // Ready to leave is still in the bed, so a deposit is still taken.
  await hospital.ready(admission.id);
  await attempt(admission.id);

  const departed = await hospital.detail(admission.id);

  await api.ipd.discharge({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: departed.admission.revision,
    dischargeType: "normal",
  });
  await expectORPCCode(attempt(admission.id), "CONFLICT", "a discharged stay");

  const mistaken = await hospital.admit(2);

  await api.ipd.cancel({
    orgSlug,
    admissionId: mistaken.admission.id,
    expectedRevision: mistaken.admission.revision,
    reason: "Admitted the wrong Patient",
  });
  await expectORPCCode(
    api.billing.recordAdvance({
      orgSlug,
      patientId: mistaken.patientId,
      admissionId: mistaken.admission.id,
      method: "cash",
      amount: 1_000_00n,
    }),
    "CONFLICT",
    "a cancelled stay",
  );

  expect(await hospital.receiptRows()).toHaveLength(1);
});

// ── Spending it ─────────────────────────────────────────────────────────────

test("the bill spends this Admission's deposit first, then untagged credit, and never another Admission's", async () => {
  const hospital = await createHospital("deposit-rank");
  const { api, orgSlug } = hospital;

  // An earlier stay left ₹3,000 of its deposit unspent.
  const earlier = await hospital.admit(0);
  const patientId = earlier.patientId;
  const earlierDeposit = await hospital.deposit(patientId, earlier.admission.id, 3_000_00n);
  await hospital.depart(earlier.admission.id);

  const untagged = await api.billing.recordAdvance({
    orgSlug,
    patientId,
    method: "cash",
    amount: 1_000_00n,
  });

  const { admission } = await hospital.admit(1, patientId);
  const stayDeposit = await hospital.deposit(patientId, admission.id, 2_000_00n);
  await hospital.postService(admission.id);
  await hospital.ready(admission.id);

  const quote = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });

  expect(quote.pending.grandTotal).toBe(9_000_00n);
  expect(quote.credit).toEqual({ deposit: 2_000_00n, other: 1_000_00n });

  // ₹3,000 more sits on the earlier stay, but it is not this bill's to spend.
  await expectORPCCode(
    hospital.bill(admission.id, {
      applyCredit: 3_000_01n,
      payments: [{ method: "cash", amount: 5_999_99n }],
    }),
    "CONFLICT",
    "more credit than this stay may draw",
  );
  expect(await hospital.invoiceRows()).toEqual([]);

  const issued = await hospital.bill(admission.id, {
    applyCredit: 3_000_00n,
    payments: [{ method: "cash", amount: 6_000_00n }],
  });

  expect(issued.invoiceId).toBeTruthy();
  expect(await hospital.allocationsFor(issued.invoiceId!)).toEqual(
    new Map([
      [stayDeposit.id, 2_000_00n],
      [untagged.id, 1_000_00n],
    ]),
  );

  expect((await hospital.detail(admission.id)).depositHeld).toBe(0n);
  expect((await hospital.detail(earlier.admission.id)).depositHeld).toBe(3_000_00n);

  const printed = await api.billing.getAdvanceReceipt({ orgSlug, advanceId: earlierDeposit.id });
  expect(printed.receipt.amount).toBe(3_000_00n);

  const after = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });
  expect(after.credit).toEqual({ deposit: 0n, other: 0n });
});

test("part of the deposit is applied oldest receipt first, and the rest stays held", async () => {
  const hospital = await createHospital("deposit-partial");
  const { patientId, admission } = await hospital.admit(0);
  const first = await hospital.deposit(patientId, admission.id, 600_00n);
  const second = await hospital.deposit(patientId, admission.id, 5_000_00n, "upi");
  await hospital.ready(admission.id);

  // One ₹1,000 bed day, paid wholly from the deposit: no Payment and no reason needed.
  const issued = await hospital.bill(admission.id, { applyCredit: 1_000_00n });

  expect(issued.receiptIds).toEqual([]);
  expect(await hospital.allocationsFor(issued.invoiceId!)).toEqual(
    new Map([
      [first.id, 600_00n],
      [second.id, 400_00n],
    ]),
  );
  expect((await hospital.detail(admission.id)).depositHeld).toBe(4_600_00n);
});

test("an Admission's deposit never pays an OPD bill, and is not offered there as credit", async () => {
  const hospital = await createHospital("deposit-opd");
  const { api, orgSlug, orgId, owner, practitioner } = hospital;
  const { patientId, admission } = await hospital.admit(0);
  await hospital.deposit(patientId, admission.id, 5_000_00n);

  // Neither figure the OPD desk reads counts the deposit: it can never be spent there.
  const credit = await api.billing.patientCredit({ orgSlug, patientId, treatmentPlanId: null });
  expect(credit).toEqual({ usable: 0n, total: 0n });

  const consult = await hospital.createService("OPD dressing", 300_00n);

  const booked = await api.opd.book({
    orgSlug,
    patientId,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T10:30",
    services: [],
  });

  const { appointment } = await api.opd.checkIn({ orgSlug, appointmentId: booked.id });

  await addPendingCatalogCharge({
    orgId,
    userId: owner.user.id,
    appointmentId: appointment.id,
    catalogItemId: consult.id,
  });

  const review = await api.opd.get({ orgSlug, appointmentId: appointment.id });

  await expectORPCCode(
    api.billing.settleCharges({
      orgSlug,
      appointmentId: appointment.id,
      expectedChargeRevision: review.appointment.chargeRevision,
      expectedGrandTotal: 300_00n,
      applyCredit: 300_00n,
      payments: [],
    }),
    "CONFLICT",
    "settling OPD from the deposit",
  );

  const opdBill = await settlePendingCharges(api, { orgSlug, appointmentId: appointment.id });

  await expectORPCCode(
    api.billing.recordPayments({
      orgSlug,
      invoiceId: opdBill.invoice.id,
      applyCredit: 300_00n,
      payments: [],
    }),
    "CONFLICT",
    "paying an OPD Invoice from the deposit",
  );

  expect((await hospital.detail(admission.id)).depositHeld).toBe(5_000_00n);
});

test("leftover deposit is refunded through the existing advance refund", async () => {
  const hospital = await createHospital("deposit-refund");
  const { api, orgSlug } = hospital;
  const cashier = await hospital.member("cashier");
  const { patientId, admission } = await hospital.admit(0);
  const receipt = await hospital.deposit(patientId, admission.id, 5_000_00n);
  await hospital.depart(admission.id);
  await hospital.bill(admission.id, { applyCredit: 1_000_00n });

  expect((await hospital.detail(admission.id)).depositHeld).toBe(4_000_00n);

  await expectORPCCode(
    cashier.billing.recordAdvanceRefund({
      orgSlug,
      advanceReceiptId: receipt.id,
      method: "cash",
      amount: 4_000_01n,
    }),
    "CONFLICT",
    "more than is left",
  );

  const refund = await cashier.billing.recordAdvanceRefund({
    orgSlug,
    advanceReceiptId: receipt.id,
    method: "cash",
    amount: 4_000_00n,
  });

  expect(refund.amount).toBe(4_000_00n);
  expect((await hospital.detail(admission.id)).depositHeld).toBe(0n);

  const past = await api.ipd.list({ orgSlug, state: "past" });
  expect(past.items.find((item) => item.id === admission.id)?.depositHeld).toBe(0n);
});

// ── Discount and remainder ──────────────────────────────────────────────────

test("a discount on the bill needs a reason and cannot exceed the subtotal", async () => {
  const hospital = await createHospital("deposit-discount");
  const { api, orgSlug } = hospital;
  const { admission } = await hospital.admit(0);
  await hospital.postService(admission.id);
  await hospital.ready(admission.id);

  const quote = await api.ipd.previewInvoice({
    orgSlug,
    admissionId: admission.id,
    discountAmount: 500_00n,
  });

  expect(quote.pending.subtotal).toBe(9_000_00n);
  expect(quote.pending.grandTotal).toBe(8_500_00n);
  expect(quote.pending.lines.reduce((sum, line) => sum + line.allocatedDiscount, 0n)).toBe(500_00n);

  await expectORPCCode(
    hospital.bill(admission.id, { discountAmount: 500_00n, outstandingReason: "Pays tomorrow" }),
    "BAD_REQUEST",
    "a discount without a reason",
  );
  await expectORPCCode(
    api.ipd.previewInvoice({ orgSlug, admissionId: admission.id, discountAmount: 9_000_01n }),
    "BAD_REQUEST",
    "a discount above the subtotal",
  );
  expect(await hospital.invoiceRows()).toEqual([]);

  await hospital.bill(admission.id, {
    discountAmount: 500_00n,
    discountReason: "Staff relative",
    payments: [{ method: "cash", amount: 8_500_00n }],
  });

  const [invoice] = await hospital.invoiceRows();

  expect(invoice).toMatchObject({
    discountAmount: 500_00n,
    subtotal: 9_000_00n,
    grandTotal: 8_500_00n,
  });
  expect(invoice?.note).toContain("Staff relative");
});

test("a deposit, a top-up, the bill, a part-payment and a refund reconcile to the journals", async () => {
  const hospital = await createHospital("deposit-reconcile");
  const { api, orgSlug } = hospital;
  const { patientId, admission } = await hospital.admit(0);
  const deposit = await hospital.deposit(patientId, admission.id, 2_000_00n);
  const topUp = await hospital.deposit(patientId, admission.id, 1_500_00n, "upi");
  await hospital.postService(admission.id);
  await hospital.ready(admission.id);

  // ₹9,000 bill: ₹3,000 from the deposit, ₹3,000 cash, ₹3,000 left owing.
  await expectORPCCode(
    hospital.bill(admission.id, {
      applyCredit: 3_000_00n,
      payments: [{ method: "cash", amount: 3_000_00n }],
    }),
    "BAD_REQUEST",
    "a balance without a reason",
  );

  const issued = await hospital.bill(admission.id, {
    applyCredit: 3_000_00n,
    payments: [{ method: "cash", amount: 3_000_00n }],
    outstandingReason: "Balance on Friday",
  });

  expect(issued.receiptIds).toHaveLength(1);
  expect(await hospital.allocationsFor(issued.invoiceId!)).toEqual(
    new Map([
      [deposit.id, 2_000_00n],
      [topUp.id, 1_000_00n],
    ]),
  );
  expect((await hospital.detail(admission.id)).depositHeld).toBe(500_00n);

  await api.billing.recordAdvanceRefund({
    orgSlug,
    advanceReceiptId: topUp.id,
    method: "cash",
    amount: 500_00n,
  });

  const net = await hospital.ledger();

  // Cash: 2,000 deposit + 3,000 payment − 500 refund. Bank: the UPI top-up.
  expect(net(CASH)).toBe(4_500_00n);
  expect(net(BANK)).toBe(1_500_00n);
  // Receivable: 9,000 billed − 3,000 deposit − 3,000 cash.
  expect(net(RECEIVABLES)).toBe(3_000_00n);
  // Every rupee of deposit was spent or returned.
  expect(net(ADVANCES)).toBe(0n);
  expect((await hospital.detail(admission.id)).depositHeld).toBe(0n);

  const invoice = await api.billing.getInvoice({ orgSlug, invoiceId: issued.invoiceId! });
  expect(invoice.balance.outstanding).toBe(3_000_00n);
});

// ── Cash limit ──────────────────────────────────────────────────────────────

test("cash deposits that would take one stay to ₹2,00,000 are refused; other methods and refunds are counted right", async () => {
  const hospital = await createHospital("deposit-cash-limit");
  const { api, orgSlug } = hospital;
  const { patientId, admission } = await hospital.admit(0);

  const first = await hospital.deposit(patientId, admission.id, 150_000_00n);

  // Exactly ₹2,00,000 is already too much.
  const refusal = hospital.deposit(patientId, admission.id, 50_000_00n);

  await expectORPCCode(refusal, "BAD_REQUEST", "reaching the limit");
  expect(await messageOf(hospital.deposit(patientId, admission.id, 50_000_00n))).toContain(
    "2,00,000",
  );

  await hospital.deposit(patientId, admission.id, 49_999_99n);

  // Cash is the only method the limit counts.
  await hospital.deposit(patientId, admission.id, 100_000_00n, "upi");
  await expectORPCCode(
    hospital.deposit(patientId, admission.id, 1n),
    "BAD_REQUEST",
    "one paisa more in cash",
  );

  // Cash handed back makes room again.
  await api.billing.recordAdvanceRefund({
    orgSlug,
    advanceReceiptId: first.id,
    method: "cash",
    amount: 20_000_00n,
  });
  await hospital.deposit(patientId, admission.id, 20_000_00n);
  await expectORPCCode(
    hospital.deposit(patientId, admission.id, 1n),
    "BAD_REQUEST",
    "back at the limit",
  );

  expect(await hospital.receiptRows()).toHaveLength(4);

  // The limit is each stay's own.
  const other = await hospital.admit(1);
  await hospital.deposit(other.patientId, other.admission.id, 150_000_00n);
});

test("cash handed back out of money that did not come in as cash makes no room under the limit", async () => {
  const hospital = await createHospital("deposit-cash-limit-refund");
  const { api, orgSlug } = hospital;
  const { patientId, admission } = await hospital.admit(0);
  const byUpi = await hospital.deposit(patientId, admission.id, 150_000_00n, "upi");

  await api.billing.recordAdvanceRefund({
    orgSlug,
    advanceReceiptId: byUpi.id,
    method: "cash",
    amount: 150_000_00n,
  });

  // The stay has taken no cash at all, so the whole limit applies to it, and no more.
  await expectORPCCode(
    hospital.deposit(patientId, admission.id, 200_000_00n),
    "BAD_REQUEST",
    "the whole limit in cash",
  );

  await hospital.deposit(patientId, admission.id, 199_999_99n);
  await expectORPCCode(
    hospital.deposit(patientId, admission.id, 1n),
    "BAD_REQUEST",
    "one paisa more",
  );
});

test("a cash Payment on the bill, at issue or later, counts toward the same limit", async () => {
  const hospital = await createHospital("deposit-cash-limit-bill");
  const { api, orgSlug } = hospital;
  const costly = await hospital.createService("Surgery", 250_000_00n);
  const { patientId, admission } = await hospital.admit(0);
  await hospital.deposit(patientId, admission.id, 150_000_00n);
  await hospital.postService(admission.id, costly.id);
  await hospital.ready(admission.id);

  // ₹2,51,000 bill. ₹1,50,000 is already in as cash, so ₹50,000 more reaches the limit.
  await expectORPCCode(
    hospital.bill(admission.id, {
      applyCredit: 150_000_00n,
      payments: [{ method: "cash", amount: 50_000_00n }],
      outstandingReason: "Balance by cheque",
    }),
    "BAD_REQUEST",
    "cash at issue",
  );
  expect(await hospital.invoiceRows()).toEqual([]);
  expect((await hospital.detail(admission.id)).depositHeld).toBe(150_000_00n);

  const issued = await hospital.bill(admission.id, {
    applyCredit: 150_000_00n,
    payments: [
      { method: "cash", amount: 40_000_00n },
      { method: "upi", amount: 30_000_00n, reference: "UPI-777" },
    ],
    outstandingReason: "Balance by cheque",
  });

  const pay = (method: "cash" | "bank", amount: bigint) =>
    api.billing.recordPayments({
      orgSlug,
      invoiceId: issued.invoiceId!,
      payments: [{ method, amount, reference: method === "cash" ? undefined : "CHQ-1" }],
    });

  await expectORPCCode(pay("cash", 10_000_00n), "BAD_REQUEST", "cash after issue");
  expect(await messageOf(pay("cash", 10_000_00n))).toContain("2,00,000");

  await pay("cash", 9_999_99n);
  await pay("bank", 21_000_01n);

  const invoice = await api.billing.getInvoice({ orgSlug, invoiceId: issued.invoiceId! });
  expect(invoice.balance.outstanding).toBe(0n);
});
