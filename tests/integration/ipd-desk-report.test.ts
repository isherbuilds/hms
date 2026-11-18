// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 7 (the IPD desk report): who left
// with something unbilled, which IPD bills are unpaid, which deposits are still held.
import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@hms/api/routers/index";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const DAY = 24 * 60 * 60 * 1_000;

const IST_OFFSET = 330 * 60 * 1_000;

const BACKDATED = { reason: "Entered from the ward register" };

/** The Asia/Kolkata calendar date `daysAgo` days before today, as YYYY-MM-DD. */
function istDate(daysAgo: number): string {
  return new Date(Date.now() + IST_OFFSET - daysAgo * DAY).toISOString().slice(0, 10);
}

function ist(daysAgo: number, time: string): Date {
  return new Date(`${istDate(daysAgo)}T${time}:00+05:30`);
}

async function workbookSheets(file: File) {
  // Static import cannot resolve this API-only dependency from the root tests.
  const {
    readXlsx,
  }: {
    readXlsx: (
      input: ArrayBuffer,
    ) => Promise<{ sheets: Array<{ name: string; rows: unknown[][] }> }>;
  } = await import(
    Bun.resolveSync("hucre/xlsx", new URL("../../packages/api/", import.meta.url).pathname)
  );

  const workbook = await readXlsx(await file.arrayBuffer());

  return new Map(
    workbook.sheets.map((sheet) => {
      const [headers = [], ...rows] = sheet.rows;

      return [
        sheet.name,
        rows.map((row) =>
          Object.fromEntries(headers.map((header, index) => [String(header), row[index]])),
        ),
      ];
    }),
  );
}

const rupees = (paise: bigint) => Number(paise) / 100;

let phoneSequence = 5_630_000;

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

  let bedSequence = 0;

  /** Every stay gets a bed of its own, so no test waits on a cleaning block. */
  async function admit(at?: Date) {
    bedSequence += 1;
    phoneSequence += 1;

    const bed = await api.ipd.createBed({
      orgSlug,
      wardId: ward.id,
      categoryId: category.id,
      label: `G-${bedSequence}`,
    });

    const patient = await api.patient.register({
      orgSlug,
      name: `${seed} Patient ${uniqueSuffix()}`,
      phone: String(phoneSequence),
      sex: "other",
      dateOfBirth: "1980-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });

    const backdate = at ? { admittedAt: at, ...BACKDATED } : {};

    const admission = await api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: bed.id,
      ...backdate,
    });

    return { patient, admission };
  }

  async function detail(admissionId: string) {
    return api.ipd.get({ orgSlug, admissionId });
  }

  async function ready(admissionId: string, at?: Date) {
    const { admission } = await detail(admissionId);
    const backdate = at ? { effectiveAt: at, ...BACKDATED } : {};

    return api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: admission.revision,
      ...backdate,
    });
  }

  async function depart(admissionId: string, at?: Date) {
    const marked = await ready(admissionId, at);
    const backdate = at ? { effectiveAt: at, ...BACKDATED } : {};

    return api.ipd.discharge({
      orgSlug,
      admissionId,
      expectedRevision: marked.revision,
      dischargeType: "normal",
      ...backdate,
    });
  }

  async function postService(admissionId: string) {
    const { admission } = await detail(admissionId);

    return api.ipd.postServices({
      orgSlug,
      admissionId,
      expectedChargeRevision: admission.chargeRevision,
      lines: [{ catalogItemId: dressing.id, qty: 1 }],
    });
  }

  /** Issues the stay's bill with `paid` in UPI and `applyCredit` from its deposit. */
  async function bill(admissionId: string, paid: bigint, applyCredit = 0n) {
    const quote = await api.ipd.previewInvoice({ orgSlug, admissionId });
    const total = quote.pending.grandTotal;

    const issued = await api.ipd.issueInvoice({
      orgSlug,
      admissionId,
      expectedChargeRevision: quote.chargeRevision,
      expectedGrandTotal: total,
      applyCredit,
      payments: paid > 0n ? [{ method: "upi", amount: paid, reference: "UPI-1" }] : [],
      outstandingReason: paid + applyCredit < total ? "Family settles later" : undefined,
    });

    if (!issued.invoiceId) throw new Error("expected an Invoice");

    return { invoiceId: issued.invoiceId, total };
  }

  function deposit(patientId: string, admissionId: string, amount: bigint) {
    return api.billing.recordAdvance({
      orgSlug,
      patientId,
      admissionId,
      method: "upi",
      amount,
      reference: `REF-${uniqueSuffix()}`,
    });
  }

  async function member(role: Parameters<typeof joinOrganization>[2]) {
    const user: TestUser = await createTestUser(`${seed}-${role}`);
    await joinOrganization(user, orgId, role);

    return clientFor(user);
  }

  function report(asOf = istDate(0), client: AppRouterClient = api) {
    return client.report.ipdDesk({ orgSlug, asOf });
  }

  return {
    orgSlug,
    api,
    admit,
    detail,
    ready,
    depart,
    postService,
    bill,
    deposit,
    member,
    report,
  };
}

test("the desk report lists who left unbilled, the unpaid IPD bills and the deposits still held, each reconciling to its source", async () => {
  const hospital = await createHospital("desk");
  const { api, orgSlug } = hospital;

  // Left with a service and a bed day never billed.
  const unbilled = await hospital.admit();
  await hospital.postService(unbilled.admission.id);
  await hospital.depart(unbilled.admission.id);

  // Left, billed and paid; a service was then posted late.
  const late = await hospital.admit();
  await hospital.depart(late.admission.id);
  await hospital.bill(late.admission.id, 1_000_00n);
  await hospital.postService(late.admission.id);

  // Left with the whole bill owing.
  const owing = await hospital.admit();
  await hospital.depart(owing.admission.id);
  const owed = await hospital.bill(owing.admission.id, 0n);

  // Left having paid part.
  const partPaid = await hospital.admit();
  await hospital.postService(partPaid.admission.id);
  await hospital.depart(partPaid.admission.id);
  const part = await hospital.bill(partPaid.admission.id, 600_00n);

  // Left with deposit over: ₹5,000 taken, ₹1,000 spent on the bill.
  const refundDue = await hospital.admit();
  await hospital.deposit(refundDue.patient.id, refundDue.admission.id, 5_000_00n);
  await hospital.depart(refundDue.admission.id);
  await hospital.bill(refundDue.admission.id, 0n, 1_000_00n);

  // Admitted by mistake after a deposit was taken.
  const mistaken = await hospital.admit();
  await hospital.deposit(mistaken.patient.id, mistaken.admission.id, 700_00n);

  await api.ipd.cancel({
    orgSlug,
    admissionId: mistaken.admission.id,
    expectedRevision: mistaken.admission.revision,
    reason: "Admitted the wrong Patient",
  });

  // Still in the ward: pending Charges and a deposit, but nobody has left.
  const current = await hospital.admit();
  await hospital.postService(current.admission.id);
  await hospital.deposit(current.patient.id, current.admission.id, 2_000_00n);

  // Ready to leave with an unpaid bill: the bill is owed whatever the stay's state.
  const waiting = await hospital.admit();
  await hospital.ready(waiting.admission.id);
  const waitingBill = await hospital.bill(waiting.admission.id, 0n);

  // Left with nothing open.
  const settled = await hospital.admit();
  await hospital.depart(settled.admission.id);
  await hospital.bill(settled.admission.id, 1_000_00n);

  const report = await hospital.report();

  expect(report.asOf).toBe(istDate(0));

  // ── Left unbilled ──
  expect(report.unbilled.rows.map((row) => row.admissionId)).toEqual([
    unbilled.admission.id,
    late.admission.id,
  ]);
  expect(report.unbilled.rows[0]).toMatchObject({
    admissionNumber: unbilled.admission.admissionNumber,
    patientId: unbilled.patient.id,
    patientName: unbilled.patient.name,
    mrn: unbilled.patient.mrn,
    pendingCharges: 1,
    unbilledDays: 1,
    amount: 1_500_00n,
  });
  expect(report.unbilled.rows[1]).toMatchObject({
    pendingCharges: 1,
    unbilledDays: 0,
    amount: 500_00n,
  });
  expect(report.unbilled.total).toBe(2_000_00n);

  for (const row of report.unbilled.rows) {
    const source = await hospital.detail(row.admissionId);

    expect(row.amount).toBe(source.runningBill);
    expect(row.dischargedAt).toEqual(source.admission.dischargedAt!);
  }

  // ── Unpaid bills ──
  expect(report.unpaid.rows.map((row) => row.invoiceId)).toEqual([
    owed.invoiceId,
    part.invoiceId,
    waitingBill.invoiceId,
  ]);
  expect(report.unpaid.rows[0]).toMatchObject({
    admissionId: owing.admission.id,
    admissionNumber: owing.admission.admissionNumber,
    patientName: owing.patient.name,
    businessDate: istDate(0),
    grandTotal: 1_000_00n,
    outstanding: 1_000_00n,
  });
  expect(report.unpaid.rows[1]).toMatchObject({
    admissionId: partPaid.admission.id,
    grandTotal: 1_500_00n,
    outstanding: 900_00n,
  });
  expect(report.unpaid.total).toBe(2_900_00n);

  for (const row of report.unpaid.rows) {
    const source = await api.billing.getInvoice({ orgSlug, invoiceId: row.invoiceId });

    expect(row.outstanding).toBe(source.balance.outstanding);
    expect(row.invoiceNumber).toBe(source.invoice.invoiceNumber);
  }

  // ── Deposits held for Patients who have gone ──
  expect(report.deposits.rows.map((row) => row.admissionId)).toEqual([
    refundDue.admission.id,
    mistaken.admission.id,
  ]);
  expect(report.deposits.rows.map((row) => row.depositHeld)).toEqual([4_000_00n, 700_00n]);
  expect(report.deposits.total).toBe(4_700_00n);

  for (const row of report.deposits.rows) {
    expect(row.depositHeld).toBe((await hospital.detail(row.admissionId)).depositHeld);
  }

  const cancelled = await hospital.detail(mistaken.admission.id);
  expect(report.deposits.rows[1]!.endedAt).toEqual(cancelled.admission.cancelledAt!);

  // Nobody else appears anywhere.
  const listed = new Set([
    ...report.unbilled.rows.map((row) => row.admissionId),
    ...report.deposits.rows.map((row) => row.admissionId),
  ]);

  expect(listed.has(current.admission.id)).toBe(false);
  expect(listed.has(settled.admission.id)).toBe(false);

  // ── The XLSX says the same ──
  const book = await workbookSheets(await api.export.ipdDeskXlsx({ orgSlug, asOf: istDate(0) }));

  expect([...book.keys()]).toEqual(["Left unbilled", "Unpaid bills", "Deposits held"]);

  expect(book.get("Left unbilled")).toMatchObject([
    {
      "IPD No.": unbilled.admission.admissionNumber,
      Patient: unbilled.patient.name,
      MRN: unbilled.patient.mrn,
      "Pending charges": 1,
      "Unbilled days": 1,
      Amount: 1_500,
    },
    { "IPD No.": late.admission.admissionNumber, "Unbilled days": 0, Amount: 500 },
    { "IPD No.": "Total", Amount: rupees(report.unbilled.total) },
  ]);

  expect(book.get("Unpaid bills")).toMatchObject([
    {
      "IPD No.": owing.admission.admissionNumber,
      "Invoice number": report.unpaid.rows[0]!.invoiceNumber,
      "Invoice total": 1_000,
      Outstanding: 1_000,
    },
    { "IPD No.": partPaid.admission.admissionNumber, "Invoice total": 1_500, Outstanding: 900 },
    { "IPD No.": waiting.admission.admissionNumber, Outstanding: 1_000 },
    { "IPD No.": "Total", Outstanding: rupees(report.unpaid.total) },
  ]);

  expect(book.get("Deposits held")).toMatchObject([
    { "IPD No.": refundDue.admission.admissionNumber, "Deposit held": 4_000 },
    { "IPD No.": mistaken.admission.admissionNumber, "Deposit held": 700 },
    { "IPD No.": "Total", "Deposit held": rupees(report.deposits.total) },
  ]);
});

test("the report covers stays and bills dated on or before its date, oldest first", async () => {
  const hospital = await createHospital("desk-as-of");

  // Left three days ago and two days ago, neither billed; one left today.
  const older = await hospital.admit(ist(4, "14:00"));
  await hospital.depart(older.admission.id, ist(3, "10:00"));

  const newer = await hospital.admit(ist(3, "14:00"));
  await hospital.depart(newer.admission.id, ist(2, "10:00"));

  const today = await hospital.admit();
  await hospital.depart(today.admission.id);
  await hospital.bill(today.admission.id, 0n);

  const yesterday = await hospital.report(istDate(1));

  expect(yesterday.asOf).toBe(istDate(1));
  expect(yesterday.unbilled.rows.map((row) => row.admissionId)).toEqual([
    older.admission.id,
    newer.admission.id,
  ]);
  // Today's bill is not yet in a report dated yesterday.
  expect(yesterday.unpaid.rows).toEqual([]);
  expect(yesterday.unpaid.total).toBe(0n);

  // The cut-off is the hospital's calendar date of departure.
  const twoDaysAgo = await hospital.report(istDate(2));
  expect(twoDaysAgo.unbilled.rows).toHaveLength(2);

  const threeDaysAgo = await hospital.report(istDate(3));
  expect(threeDaysAgo.unbilled.rows.map((row) => row.admissionId)).toEqual([older.admission.id]);

  const now = await hospital.report();

  expect(now.unbilled.rows.map((row) => row.admissionId)).toEqual([
    older.admission.id,
    newer.admission.id,
  ]);
  expect(now.unpaid.rows.map((row) => row.admissionId)).toEqual([today.admission.id]);
});

test("a report with nothing open is empty, and so is its workbook but for the totals", async () => {
  const hospital = await createHospital("desk-empty");
  const { api, orgSlug } = hospital;
  const settled = await hospital.admit();
  await hospital.depart(settled.admission.id);
  await hospital.bill(settled.admission.id, 1_000_00n);

  const report = await hospital.report();

  expect(report.unbilled).toEqual({ rows: [], total: 0n });
  expect(report.unpaid).toEqual({ rows: [], total: 0n });
  expect(report.deposits).toEqual({ rows: [], total: 0n });

  const book = await workbookSheets(await api.export.ipdDeskXlsx({ orgSlug, asOf: istDate(0) }));

  expect(book.get("Left unbilled")).toMatchObject([{ "IPD No.": "Total", Amount: 0 }]);
  expect(book.get("Unpaid bills")).toMatchObject([{ "IPD No.": "Total", Outstanding: 0 }]);
  expect(book.get("Deposits held")).toMatchObject([{ "IPD No.": "Total", "Deposit held": 0 }]);
});

test("the desk report is a financial report: owner, admin and accountant read it, the desks do not, and it never crosses hospitals", async () => {
  const hospital = await createHospital("desk-grants");
  const other = await createHospital("desk-grants-other");
  const { orgSlug } = hospital;

  const mine = await hospital.admit();
  await hospital.depart(mine.admission.id);

  const theirs = await other.admit();
  await other.depart(theirs.admission.id);

  for (const role of ["reception", "cashier", "pharmacist"] as const) {
    const client = await hospital.member(role);

    await expectORPCCode(hospital.report(istDate(0), client), "FORBIDDEN", role);
    await expectORPCCode(
      client.export.ipdDeskXlsx({ orgSlug, asOf: istDate(0) }),
      "FORBIDDEN",
      `${role} export`,
    );
  }

  for (const role of ["admin", "accountant"] as const) {
    const report = await hospital.report(istDate(0), await hospital.member(role));

    expect(report.unbilled.rows.map((row) => row.admissionId)).toEqual([mine.admission.id]);
  }

  // The other hospital's owner asking for this hospital is refused outright.
  await expectORPCCode(other.api.report.ipdDesk({ orgSlug, asOf: istDate(0) }), "FORBIDDEN");

  const own = await other.report();
  expect(own.unbilled.rows.map((row) => row.admissionId)).toEqual([theirs.admission.id]);

  await expectORPCCode(
    // @ts-expect-error asOf is a calendar date
    hospital.api.report.ipdDesk({ orgSlug, asOf: new Date() }),
    "BAD_REQUEST",
  );
  await expectORPCCode(hospital.report("2026-02-31"), "BAD_REQUEST", "an impossible date");
});
