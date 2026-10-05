import { beforeAll, expect, test } from "bun:test";

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

const RECEIVED_ON = "2026-09-01";

beforeAll(async () => {
  await resetTestDatabase();
});

const MRP = 112_00n;

const TAX_RATE = "12.00";

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
      unitsPerPack: number;
    }> = {},
  ) {
    return api.pharmacy.createProduct({
      orgSlug: organization.slug,
      name: overrides.name ?? `${seed} Paracetamol ${uniqueSuffix()}`,
      sold: true,
      taxRatePercent: overrides.taxRatePercent ?? TAX_RATE,
      taxCode: "3004",
      active: overrides.active ?? true,
      stockUnit: "tablet",
      unitsPerPack: overrides.unitsPerPack ?? 1,
      expires: true,
      pack: "10 tablets",
      schedule: overrides.schedule ?? "none",
    });
  }

  async function receive(
    productId: string,
    line: { expiryDate?: string; mrp?: bigint; pricedPer?: "pack" | "unit"; qty: number },
  ) {
    const received = await api.pharmacy.receiveGoods({
      orgSlug: organization.slug,
      supplierName: `${seed} Supplier`,
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId,
          batchNumber: `B-${uniqueSuffix()}`,
          expiryDate: line.expiryDate ?? futureExpiry(),
          mrp: line.mrp ?? MRP,
          pricedPer: line.pricedPer ?? "unit",
          cost: { freeQty: 0, rate: 0n, discountPercent: "0", gstPercent: "0" },
          qty: line.qty,
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

/** Two units at ₹112 MRP (12% GST inside) less ₹12: ₹212, taxable ₹189.29, tax ₹22.71. */
async function sellTwo(fixture: CounterFixture, batchId: string) {
  return fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 2 }],
    buyer: { name: "walk in buyer", phone: "5559000" },
    discountAmount: 12_00n,
    note: "counter discount",
    payments: [{ method: "cash", amount: 212_00n }],
    expectedGrandTotal: 212_00n,
  });
}

test("a walk-in sale numbers in the pharmacy series, extracts tax, moves stock and money, and corrects only by return", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-happy");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 5 });

  const sold = await sellTwo(fixture, batchId);

  expect(sold.invoiceNumber.startsWith("PH")).toBe(true);
  expect(sold.payments).toHaveLength(1);

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(detail.invoice).toMatchObject({
    stream: "pharmacy",
    subtotal: 224_00n,
    taxTotal: 22_71n,
    roundOff: 0n,
    grandTotal: 212_00n,
  });
  expect(detail.balance.outstanding).toBe(0n);
  expect(detail.sale.buyerName).toBe("walk in buyer");
  expect(detail.sale.forName).toBe("walk in buyer");
  expect(detail.lines).toHaveLength(1);
  expect(detail.lines[0]?.taxableValue).toBe(189_29n);

  const stock = await fixture.stockFor(batchId);
  expect(stock.shelfQty).toBe(3);

  const [snapshot] = await db
    .select()
    .from(charges)
    .where(
      and(eq(charges.orgId, fixture.organization.id), eq(charges.pharmacySaleId, sold.saleId)),
    );

  expect(snapshot).toMatchObject({
    catalogItemId: null,
    sourceType: "pharmacy_batch",
    sourceId: null,
    stockBatchId: batchId,
    description: expect.stringContaining(" · batch "),
    qty: 2,
    unitPrice: MRP,
    priceUnits: 1,
    taxRatePercent: "12.00",
    taxCode: "3004",
    revenueCategory: "pharmacy",
  });

  const journal = await journalFor(fixture.organization.id, "invoice", sold.invoiceId);
  const debits = journal.reduce((sum, line) => sum + line.debit, 0n);
  const credits = journal.reduce((sum, line) => sum + line.credit, 0n);
  expect(debits).toBe(credits);
  expect(lineByCode(journal, "4500").credit).toBe(189_29n);
  expect(lineByCode(journal, "2100").credit).toBe(22_71n);
  expect(lineByCode(journal, "1200").debit).toBe(212_00n);

  const listed = await fixture.api.pharmacy.listSales({ orgSlug: fixture.organization.slug });
  expect(listed.items[0]).toMatchObject({ saleId: sold.saleId, grandTotal: 212_00n, roundOff: 0n });

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

test("loose tablets use pack MRP exactly and completed loose returns quarantine exact money", async () => {
  const fixture = await createPharmacyFixture("pharmacy-loose-sale");
  const medicine = await fixture.createMedicine({ taxRatePercent: "0", unitsPerPack: 10 });

  const batchId = await fixture.receive(medicine.productId, {
    qty: 50,
    mrp: 85_00n,
    pricedPer: "pack",
  });

  const sold = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 4 }],
    buyer: { name: "Loose buyer" },
    payments: [{ method: "cash", amount: 34_00n }],
    expectedGrandTotal: 34_00n,
  });

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(detail.invoice.subtotal).toBe(34_00n);
  expect(detail.lines[0]?.priceUnits).toBe(10);

  const [snapshot] = await db
    .select()
    .from(charges)
    .where(
      and(eq(charges.orgId, fixture.organization.id), eq(charges.pharmacySaleId, sold.saleId)),
    );

  expect(snapshot).toMatchObject({
    stockBatchId: batchId,
    sourceId: null,
    priceUnits: 10,
    unitPrice: 85_00n,
  });
  await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 10 }],
    buyer: { name: "Full pack buyer" },
    payments: [{ method: "cash", amount: 85_00n }],
    expectedGrandTotal: 85_00n,
  });
  await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId: detail.lines[0]!.id, qty: 3 }],
  });
  await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId: detail.lines[0]!.id, qty: 1 }],
  });

  const returned = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(returned.balance.creditTotal).toBe(detail.lines[0]!.gross);
  expect((await fixture.stockFor(batchId)).quarantineQty).toBe(4);
});

test("the counter refuses expired, inactive, Schedule X, overstocked, unprescribed H1 and underpaid sales without writing any", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-refusals");
  const expired = await fixture.createMedicine();
  const inactive = await fixture.createMedicine();
  const stocked = await fixture.createMedicine();
  const scheduleX = await fixture.createMedicine({ schedule: "x" });
  const scheduleH1 = await fixture.createMedicine({ schedule: "h1" });
  const expiredBatch = await fixture.receive(expired.productId, { qty: 4, expiryDate: "2020-01" });
  const inactiveBatch = await fixture.receive(inactive.productId, { qty: 4 });
  const stockedBatch = await fixture.receive(stocked.productId, { qty: 3 });
  const xBatch = await fixture.receive(scheduleX.productId, { qty: 2 });
  const h1Batch = await fixture.receive(scheduleH1.productId, { qty: 2 });

  await fixture.api.pharmacy.updateProduct({
    orgSlug: fixture.organization.slug,
    productId: inactive.productId,
    name: "withdrawn tablet",
    sold: true,
    taxRatePercent: TAX_RATE,
    active: false,
    stockUnit: "tablet",
    unitsPerPack: 1,
    expires: true,
    pack: "10 tablets",
  });
  expect(
    await fixture.api.pharmacy.searchStock({
      orgSlug: fixture.organization.slug,
      query: "withdrawn",
    }),
  ).toEqual([]);

  const sellOne = (batchId: string, paid = MRP) =>
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: paid }],
      expectedGrandTotal: MRP,
    });

  await expectORPCCode(sellOne(expiredBatch), "BAD_REQUEST", "an expired batch");
  await expectORPCCode(sellOne(inactiveBatch), "BAD_REQUEST", "an inactive medicine");
  await expectORPCCode(sellOne(xBatch), "BAD_REQUEST", "a Schedule X medicine");
  await expectORPCCode(sellOne(h1Batch), "BAD_REQUEST", "Schedule H1 without a prescriber");
  await expectORPCCode(
    sellOne(stockedBatch, MRP - 100n),
    "BAD_REQUEST",
    "an underpaid walk-in sale",
  );
  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [
        { batchId: stockedBatch, qty: 2 },
        { batchId: stockedBatch, qty: 2 },
      ],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: 4n * MRP }],
      expectedGrandTotal: 4n * MRP,
    }),
    "CONFLICT",
    "two lines above shelf stock",
  );

  const orgId = fixture.organization.id;
  expect(await db.select().from(pharmacySales).where(eq(pharmacySales.orgId, orgId))).toEqual([]);
  expect(await db.select().from(invoices).where(eq(invoices.orgId, orgId))).toEqual([]);
  expect(await db.select().from(charges).where(eq(charges.orgId, orgId))).toEqual([]);
  expect((await fixture.stockFor(expiredBatch)).shelfQty).toBe(4);
  expect((await fixture.stockFor(stockedBatch)).shelfQty).toBe(3);
  expect((await fixture.stockFor(xBatch)).shelfQty).toBe(2);

  await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId: h1Batch, qty: 1 }],
    buyer: { name: "walk in buyer" },
    prescriberName: "dr mehta",
    prescriptionReference: "RX-19",
    payments: [{ method: "cash", amount: MRP }],
    expectedGrandTotal: MRP,
  });
  expect((await fixture.stockFor(h1Batch)).shelfQty).toBe(1);
});

test("two concurrent sales of the last unit leave exactly one winner", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-race");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 1 });

  const attempt = () =>
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: MRP }],
      expectedGrandTotal: MRP,
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

test("repeated returns reverse the line exactly, quarantine the goods, and cap the refund", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-return");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 2 });
  const sold = await sellTwo(fixture, batchId);

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
      refund: { method: "cash", amount: 212_00n },
    }),
    "BAD_REQUEST",
  );

  const secondReturn = await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId, qty: 1 }],
    refund: { method: "cash", amount: 212_00n - afterFirst.balance.creditTotal },
  });

  expect(secondReturn.refund?.amount).toBe(212_00n - afterFirst.balance.creditTotal);

  const afterSecond = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  // The two credit notes reverse the line's taxable, tax and gross to the paisa.
  expect(afterSecond.balance.creditTotal).toBe(212_00n);
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

  await expectORPCCode(
    fixture.api.pharmacy.sell({
      orgSlug: fixture.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: MRP }],
      expectedGrandTotal: MRP,
    }),
    "CONFLICT",
  );
});

test("another organization cannot read, return, or sell against this one's sale", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-tenancy");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 4 });
  const sold = await sellTwo(fixture, batchId);

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

  await expectORPCCode(
    outsider.api.pharmacy.sell({
      orgSlug: outsider.organization.slug,
      lines: [{ batchId, qty: 1 }],
      buyer: { name: "walk in buyer" },
      payments: [{ method: "cash", amount: MRP }],
      expectedGrandTotal: MRP,
    }),
    "NOT_FOUND",
  );
});

test("a patient sale can leave a balance with a note, refuses a refund beyond what was paid, and still takes the return", async () => {
  const fixture = await createPharmacyFixture("pharmacy-sale-patient");
  const medicine = await fixture.createMedicine();
  const batchId = await fixture.receive(medicine.productId, { qty: 4 });
  const patient = await fixture.registerPatient();

  const sold = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 2 }],
    buyer: { patientId: patient.id },
    note: "settling at discharge",
    payments: [{ method: "cash", amount: 100n }],
    expectedGrandTotal: 224_00n,
  });

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: sold.saleId,
  });

  expect(detail.invoice.patientId).toBe(patient.id);
  expect(detail.invoice.patientMrn).toBe(patient.mrn);
  expect(detail.balance.outstanding).toBe(223_00n);
  expect((await fixture.stockFor(batchId)).shelfQty).toBe(2);

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

test("below-MRP review uses rational pack prices and issued discounts, never returns or round-off", async () => {
  const fixture = await createPharmacyFixture("pharmacy-revenue-review");
  const medicine = await fixture.createMedicine({ taxRatePercent: "0", unitsPerPack: 3 });

  const batchId = await fixture.receive(medicine.productId, {
    qty: 12,
    mrp: 100_01n,
    pricedPer: "pack",
  });

  const fullPrice = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 1 }],
    buyer: { name: "Rational full price" },
    payments: [{ method: "cash", amount: 33_00n }],
    expectedGrandTotal: 33_00n,
  });

  const discounted = await fixture.api.pharmacy.sell({
    orgSlug: fixture.organization.slug,
    lines: [{ batchId, qty: 3 }],
    buyer: { name: "Approved concession" },
    discountAmount: 1n,
    note: "Approved one-paisa concession",
    payments: [{ method: "cash", amount: 100_00n }],
    expectedGrandTotal: 100_00n,
  });

  const detail = await fixture.api.pharmacy.getSale({
    orgSlug: fixture.organization.slug,
    saleId: discounted.saleId,
  });

  const range = {
    orgSlug: fixture.organization.slug,
    from: detail.invoice.businessDate,
    to: detail.invoice.businessDate,
  };

  const before = await fixture.api.report.revenueSignals({ ...range, kind: "below_mrp" });
  expect(before.summary).toMatchObject({ count: 1, amount: 1n });
  expect(before.rows).toHaveLength(1);
  expect(before.rows[0]).toMatchObject({
    invoiceId: detail.invoice.id,
    source: { type: "pharmacy", id: discounted.saleId },
    lineSubtotal: 100_01n,
    discountAmount: 1n,
    actorName: fixture.owner.user.name,
    reason: "Approved one-paisa concession",
  });
  expect(before.rows.some((row) => row.source?.id === fullPrice.saleId)).toBe(false);
  await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: discounted.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId: detail.lines[0]!.id, qty: 1 }],
  });
  await fixture.api.pharmacy.returnSale({
    orgSlug: fixture.organization.slug,
    saleId: discounted.saleId,
    reasonCode: "unwanted",
    lines: [{ invoiceLineId: detail.lines[0]!.id, qty: 2 }],
  });
  const after = await fixture.api.report.revenueSignals({ ...range, kind: "below_mrp" });
  expect(after.rows).toEqual(before.rows);
  expect(after.summary).toEqual(before.summary);
  expect(
    (await fixture.api.report.revenueSignals({ ...range, kind: "credit_note" })).summary!.count,
  ).toBe(2);
  const revenue = await fixture.api.report.revenueBreakdown(range);
  expect(revenue.totals).toMatchObject({
    issuedTaxableValue: 133_34n,
    creditedTaxableValue: 100_00n,
    netTaxableValue: 33_34n,
    tax: 0n,
    roundOff: -34n,
  });
  expect(revenue.byStream[0]?.roundOff).toBe(-34n);
  expect(revenue.byPractitioner[0]?.roundOff).toBe(0n);
  expect(revenue.byCategory[0]?.roundOff).toBe(0n);
  await expectORPCCode(
    fixture.api.report.revenueSignals({ ...range, kind: "below_mrp", limit: 101 }),
    "BAD_REQUEST",
  );
});
