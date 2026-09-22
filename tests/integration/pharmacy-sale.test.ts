import { beforeAll, expect, test } from "bun:test";

import { computeInvoiceLines } from "@hms/api/lib/invoice-math";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { pharmacySales } from "@hms/db/schema/pharmacy-sales";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";
import { UNPRICED } from "../support/pharmacy";

const RECEIVED_ON = "2026-09-01";

beforeAll(async () => {
  await resetTestDatabase();
});

const MRP = 112_00n;

const TAX_RATE = "12.00";

/** What the desk's total block shows, computed the same way the invoice is. */
function expectedTotals(qty: number, discount: bigint, unitPrice = MRP, rate = TAX_RATE) {
  return computeInvoiceLines(
    [
      {
        chargeId: "expected",
        description: "expected",
        qty,
        unitPrice,
        taxRatePercent: rate,
        taxCode: null,
      },
    ],
    discount,
    "inclusive",
  );
}

function futureExpiry(): string {
  return `${new Date().getUTCFullYear() + 3}-12`;
}

async function createPharmacyFixture(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const api = clientFor(owner);

  await api.settings.update({
    orgSlug: organization.slug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "GSTIN-TEST",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    pharmacyInvoicePrefix: "PH",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 1,
  });

  async function createMedicine(
    overrides: Partial<{
      name: string;
      schedule: "none" | "h" | "h1" | "x";
      taxRatePercent: string;
      active: boolean;
    }> = {},
  ) {
    return api.pharmacy.createProduct({
      orgSlug: organization.slug,
      name: overrides.name ?? `${seed} Paracetamol ${uniqueSuffix()}`,
      catalog: {
        code: `MED-${uniqueSuffix()}`,
        taxRatePercent: overrides.taxRatePercent ?? TAX_RATE,
        taxCode: "3004",
        active: overrides.active ?? true,
      },
      stockUnit: "tablet",
      unitsPerPack: 10,
      schedule: overrides.schedule ?? "none",
    });
  }

  async function receive(
    productId: string,
    line: { batchNumber?: string; expiryDate?: string; mrp?: bigint; qty: number },
  ) {
    const received = await api.pharmacy.receiveGoods({
      orgSlug: organization.slug,
      supplierName: `${seed} Supplier`,
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId,
          batchNumber: line.batchNumber ?? `B-${uniqueSuffix()}`,
          expiryDate: line.expiryDate ?? futureExpiry(),
          mrp: line.mrp ?? MRP,
          qty: line.qty,
          cost: UNPRICED,
        },
      ],
    });

    const [batch] = received.batches;

    if (!batch) throw new Error("expected a received batch");

    return batch.batchId;
  }

  async function stockFor(batchId: string) {
    const { items: rows } = await api.pharmacy.stockOnHand({
      orgSlug: organization.slug,
      includeZero: true,
    });

    const row = rows.find((candidate) => candidate.batchId === batchId);

    if (!row) throw new Error(`expected stock for batch ${batchId}`);

    return row;
  }

  async function registerPatient() {
    return api.patient.register({
      orgSlug: organization.slug,
      name: `${seed} Patient`,
      phone: "5553100",
      sex: "other",
      dateOfBirth: "1990-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });
  }

  return { owner, organization, api, createMedicine, receive, stockFor, registerPatient };
}

type CounterFixture = { api: AppRouterClient; organization: { slug: string } };

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

  const lines = await db
    .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(accounts, and(eq(accounts.id, journalLines.accountId), eq(accounts.orgId, orgId)))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entry.id)));

  return lines;
}

function lineByCode(lines: Array<{ code: string; debit: bigint; credit: bigint }>, code: string) {
  const line = lines.find((candidate) => candidate.code === code);

  if (!line) throw new Error(`expected a journal line for account ${code}`);

  return line;
}

async function sellTwo(fixture: CounterFixture, batchId: string, qty = 2, discount = 12_00n) {
  const totals = expectedTotals(qty, discount);

  const sold = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty }],
    buyer: { name: "walk in buyer", phone: "5559000" },
    discountAmount: discount,
    note: "counter discount",
    payments: [{ method: "cash", amount: totals.grandTotal }],
    expectedGrandTotal: totals.grandTotal,
  });

  return { sold, totals };
}

test("a walk-in sale numbers in the pharmacy series, extracts tax, and moves stock and money", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-happy");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 5 });

  const { sold, totals } = await sellTwo(fixture, batchId);

  expect(sold.invoiceNumber.startsWith("PH")).toBe(true);
  expect(sold.payments).toHaveLength(1);

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(detail.invoice.stream).toBe("pharmacy");
  expect(detail.invoice.grandTotal).toBe(totals.grandTotal);
  expect(detail.invoice.taxTotal).toBe(totals.taxTotal);
  expect(detail.invoice.subtotal).toBe(totals.subtotal);
  expect(detail.balance.outstanding).toBe(0n);
  expect(detail.sale.buyerName).toBe("walk in buyer");
  expect(detail.sale.forName).toBe("walk in buyer");
  expect(detail.lines).toHaveLength(1);
  expect(detail.lines[0]?.batchNumber).toBeString();
  expect(detail.lines[0]?.taxableValue).toBe(totals.lines[0]!.taxableValue);

  const stock = await fixture.stockFor(batchId);
  expect(stock.shelfQty).toBe(3);

  const journal = await journalFor(fixture.organization.id, "invoice", sold.invoiceId);
  const debits = journal.reduce((sum, line) => sum + line.debit, 0n);
  const credits = journal.reduce((sum, line) => sum + line.credit, 0n);
  expect(debits).toBe(credits);
  expect(lineByCode(journal, "4500").credit).toBe(totals.lines[0]!.taxableValue);
  expect(lineByCode(journal, "2100").credit).toBe(totals.taxTotal);
  expect(lineByCode(journal, "1200").debit).toBe(totals.grandTotal);

  const listed = await fixture.api.pharmacy.listSales({ orgSlug: fixture.organization.slug });
  expect(listed.items[0]?.saleId).toBe(sold.saleId);
  expect(listed.items[0]?.grandTotal).toBe(totals.grandTotal);
});

test("the pharmacy invoice prefix cannot equal the OPD one", async () => {
  const fixture = await createPharmacyFixture("pharmacy-prefix-clash");
  const current = await fixture.api.settings.get({ orgSlug: fixture.organization.slug });

  await expectORPCCode(
    fixture.api.settings.update({
      ...current,
      orgSlug: fixture.organization.slug,
      pharmacyInvoicePrefix: current.invoicePrefix,
    }),
    "BAD_REQUEST",
  );
});

test("an expired batch is refused and writes no sale", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-expired");
  const medicine = await fixture.createMedicine();

  const batchId = await fixture.receive(medicine.productId, {
    qty: 4,
    expiryDate: "2020-01",
  });

  const totals = expectedTotals(1, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "BAD_REQUEST",
  );

  const sales = await db
    .select()
    .from(pharmacySales)
    .where(eq(pharmacySales.orgId, fixture.organization.id));

  expect(sales).toHaveLength(0);
  expect((await fixture.stockFor(batchId)).shelfQty).toBe(4);
});

test("an inactive medicine is refused", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-inactive");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 4 });

  await fixture.api.pharmacy.updateProduct({
    orgSlug: fixture.organization.slug,
    productId: medicine.productId,
    name: "withdrawn tablet",
    catalog: {
      code: `MED-${uniqueSuffix()}`,
      taxRatePercent: TAX_RATE,
      active: false,
    },
    stockUnit: "tablet",
    unitsPerPack: 10,
  });

  const totals = expectedTotals(1, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "BAD_REQUEST",
  );

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.orgId, fixture.organization.id));

  expect(invoiceRows).toHaveLength(0);
});

test("two lines on one batch above shelf stock are refused together", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-overstock");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 3 });

  const totals = expectedTotals(4, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [
        { batchId, qty: 2 },
        { batchId, qty: 2 },
      ],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "CONFLICT",
  );

  expect((await fixture.stockFor(batchId)).shelfQty).toBe(3);

  const chargeRows = await db
    .select()
    .from(charges)
    .where(
      and(eq(charges.orgId, fixture.organization.id), eq(charges.sourceType, "pharmacy_batch")),
    );

  expect(chargeRows).toHaveLength(0);
});

test("a Schedule X medicine is refused and Schedule H1 needs a prescriber", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-schedule");
  const scheduleX = await fixture.createMedicine({ schedule: "x" });
  const scheduleH1 = await fixture.createMedicine({ schedule: "h1" });
  const xBatch = await fixture.receive(scheduleX.productId, { qty: 2 });
  const h1Batch = await fixture.receive(scheduleH1.productId, { qty: 2 });

  const totals = expectedTotals(1, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId: xBatch, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "BAD_REQUEST",
  );

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId: h1Batch, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "BAD_REQUEST",
  );

  await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId: h1Batch, qty: 1 }],
    buyer: { name: "walk in buyer" },
    prescriberName: "dr mehta",
    prescriptionReference: "RX-19",
    payments: [{ method: "cash", amount: totals.grandTotal }],
    expectedGrandTotal: totals.grandTotal,
  });

  expect((await fixture.stockFor(h1Batch)).shelfQty).toBe(1);
  expect((await fixture.stockFor(xBatch)).shelfQty).toBe(2);
});

test("two concurrent sales of the last unit leave exactly one winner", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-race");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 1 });
  const totals = expectedTotals(1, 0n);

  const attempt = () =>
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    });

  const outcomes = await Promise.allSettled([attempt(), attempt()]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  // SAFETY: the rejection is what the oRPC client threw, which carries `code`.
  expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("CONFLICT");
  expect((await fixture.stockFor(batchId)).shelfQty).toBe(0);
});

test("a walk-in sale that is not paid in full is refused", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-partial");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 5 });
  const totals = expectedTotals(1, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      note: "will pay later",
      payments: [{ method: "cash", amount: totals.grandTotal - 100n }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "BAD_REQUEST",
  );

  expect((await fixture.stockFor(batchId)).shelfQty).toBe(5);
});

test("repeated returns reverse the line exactly, quarantine the goods, and cap the refund", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-return");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 2 });
  const { sold, totals } = await sellTwo(fixture, batchId);
  const line = totals.lines[0]!;

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  const invoiceLineId = detail.lines[0]!.id;

  const firstReturn = await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId, qty: 1 }],
  });

  expect(firstReturn.creditNoteNumber?.startsWith("CN")).toBe(true);
  expect(firstReturn.refund).toBeNull();

  const afterFirst = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(afterFirst.returns).toHaveLength(1);
  expect(afterFirst.refundDue).toBe(afterFirst.balance.creditTotal);

  await expectORPCCode(
    fixture.api.pharmacy.returnSale({
      orgSlug: fixture.organization.slug,
      saleId: sold.saleId,
      reasonCode: "unwanted",
      lines: [{ invoiceLineId, qty: 1 }],
      refund: { method: "cash", amount: line.gross },
    }),
    "BAD_REQUEST",
  );

  const secondReturn = await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId, qty: 1 }],
    refund: { method: "cash", amount: line.gross - afterFirst.balance.creditTotal },
  });

  expect(secondReturn.refund?.amount).toBe(line.gross - afterFirst.balance.creditTotal);

  const afterSecond = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  // The two credit notes reverse the line's taxable, tax and gross to the paisa.
  expect(afterSecond.balance.creditTotal).toBe(line.gross);
  expect(afterSecond.refundDue).toBe(afterFirst.balance.creditTotal);
  expect(afterSecond.returns).toHaveLength(2);

  await expectORPCCode(
    fixture.api.pharmacy.returnSale({
      orgSlug: fixture.organization.slug,
      saleId: sold.saleId,
      reasonCode: "unwanted",
      lines: [{ invoiceLineId, qty: 1 }],
    }),
    "BAD_REQUEST",
  );

  const quarantined = await fixture.api.pharmacy.stockOnHand({
    orgSlug: fixture.organization.slug,
    quarantineOnly: true,
  });

  const row = quarantined.items.find((candidate) => candidate.batchId === batchId);
  expect(row?.quarantineQty).toBe(2);
  expect(row?.shelfQty).toBe(0);

  const resale = expectedTotals(1, 0n);

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: resale.grandTotal }],
      expectedGrandTotal: resale.grandTotal,
    }),
    "CONFLICT",
  );
});

test("a return refund cannot exceed the invoice's refundable balance", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-refund-balance");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 10 });
  const patient = await fixture.registerPatient();
  const totals = expectedTotals(10, 0n);

  const sold = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 10 }],
    buyer: { patientId: patient.id },
    note: "settling later",
    payments: [{ method: "cash", amount: 100n }],
    expectedGrandTotal: totals.grandTotal,
  });

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  const invoiceLineId = detail.lines[0]!.id;

  await expectORPCCode(
    fixture.api.pharmacy.returnSale({
      orgSlug: fixture.organization.slug,
      saleId: sold.saleId,
      reasonCode: "unwanted",
      lines: [{ invoiceLineId, qty: 1 }],
      refund: { method: "cash", amount: 100n },
    }),
    "BAD_REQUEST",
  );

  const returned = await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId, qty: 1 }],
  });

  expect(returned.creditNoteId).not.toBeNull();
  expect((await fixture.stockFor(batchId)).quarantineQty).toBe(1);
});

test("a credit note cannot be issued directly on a pharmacy invoice", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-creditnote");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 2 });
  const { sold } = await sellTwo(fixture, batchId);

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  await expectORPCCode(
    fixture.api.billing.issueCreditNote({
      orgSlug: fixture.organization.slug,
      invoiceId: sold.invoiceId,
      reason: "desk correction",
      lines: [{ invoiceLineId: detail.lines[0]!.id, full: true }],
    }),
    "CONFLICT",
  );
});

test("another organization cannot read, return, or sell against this one's sale", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-tenancy");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 4 });
  const { sold } = await sellTwo(fixture, batchId);

  const outsider = await createPharmacyFixture("pharmacy-sale-outsider");

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  await expectORPCCode(
    outsider.api.pharmacy.getSale({
      orgSlug: outsider.organization.slug,
      saleId: sold.saleId,
    }),
    "NOT_FOUND",
  );

  await expectORPCCode(
    outsider.api.pharmacy.returnSale({
      orgSlug: outsider.organization.slug,
      saleId: sold.saleId,
      reasonCode: "unwanted",
      lines: [{ invoiceLineId: detail.lines[0]!.id, qty: 1 }],
    }),
    "NOT_FOUND",
  );

  const totals = expectedTotals(1, 0n);

  await expectORPCCode(
    outsider.api.pharmacy.sell({
      orgSlug: outsider.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: totals.grandTotal }],
      expectedGrandTotal: totals.grandTotal,
    }),
    "NOT_FOUND",
  );
});

test("a patient sale can leave a balance with a note and spends patient credit", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-patient");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 4 });
  const patient = await fixture.registerPatient();
  const totals = expectedTotals(2, 0n);

  const sold = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 2 }],
    buyer: { patientId: patient.id },
    note: "settling at discharge",
    payments: [{ method: "cash", amount: 100n }],
    expectedGrandTotal: totals.grandTotal,
  });

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(detail.invoice.patientId).toBe(patient.id);
  expect(detail.invoice.patientMrn).toBe(patient.mrn);
  expect(detail.balance.outstanding).toBe(totals.grandTotal - 100n);
  expect((await fixture.stockFor(batchId)).shelfQty).toBe(2);
});
