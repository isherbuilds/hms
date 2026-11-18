// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 4 (bed charges and the running
// bill). Bed days are derived from occupancy and written as Charges only inside the bill.
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { counter } from "@hms/db/schema/counter";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { admissionBedStays, admissions } from "@hms/db/schema/ipd";
import { and, asc, eq, sql } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const HOUR = 60 * 60 * 1_000;

const DAY = 24 * HOUR;

const IST_OFFSET = 330 * 60 * 1_000;

const GSTIN = "27ABCDE1234F1Z5";

const BACKDATED = { reason: "Entered from the ward register" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Asia/Kolkata calendar date `daysAgo` days before today, as YYYY-MM-DD. */
function istDate(daysAgo: number): string {
  return new Date(Date.now() + IST_OFFSET - daysAgo * DAY).toISOString().slice(0, 10);
}

/** A wall-clock time in India on that date. `daysAgo` is at least 1, so it is in the past. */
function ist(daysAgo: number, time: string): Date {
  return new Date(`${istDate(daysAgo)}T${time}:00+05:30`);
}

/** How a bed-day line prints a date: 5 Nov 2026. */
function label(date: string): string {
  const [year, month, day] = date.split("-").map(Number);

  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

/**
 * Bed days of a one-bed stay in India, straight from the rule: the first day ends at
 * checkout on the next calendar date, each later day 24 hours on.
 */
function daysThrough(admittedAt: Date, through: Date, checkoutMinutes = 720): number {
  const localDay = Math.floor((admittedAt.getTime() + IST_OFFSET) / DAY);
  const firstCheckout = (localDay + 1) * DAY + checkoutMinutes * 60_000 - IST_OFFSET;

  if (through.getTime() <= firstCheckout) return 1;

  return 1 + Math.ceil((through.getTime() - firstCheckout) / DAY);
}

let phoneSequence = 5_600_000;

async function createHospital(
  seed: string,
  options: { gstin?: string; checkoutMinutes?: number } = {},
) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const orgSlug = organization.slug;
  const orgId = organization.id;
  const api = clientFor(owner);

  const settings = (ipdCheckoutMinutes: number) => ({
    orgSlug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "",
    gstin: options.gstin ?? "",
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
    ipdCheckoutMinutes,
  });

  await api.settings.update(settings(options.checkoutMinutes ?? 720));

  async function createService(name: string, taxRatePercent = "0", unitPrice = 500_00n) {
    return api.catalog.create({
      orgSlug,
      name: `${seed} ${name}`,
      category: "other",
      unitPrice,
      taxRatePercent,
      taxCode: taxRatePercent === "0" ? "" : "996311",
      customRate: false,
    });
  }

  const generalRoom = await createService("General ward room rent");
  const icuRoom = await createService("ICU room rent");
  const nursing = await createService("Nursing charges");
  const oddRoom = await createService("Odd room rent");
  const dressing = await createService("Dressing");

  const department = await api.staff.createDepartment({ orgSlug, name: `${seed} Medicine` });

  const practitioner = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed}`,
    departmentId: department.id,
  });

  const ward = await api.ipd.createWard({ orgSlug, name: "Main" });
  const general = await api.ipd.createBedCategory({ orgSlug, name: "General" });
  const icu = await api.ipd.createBedCategory({ orgSlug, name: "ICU" });
  const odd = await api.ipd.createBedCategory({ orgSlug, name: "Odd" });
  const effectiveFrom = new Date(Date.now() - 60 * DAY);

  const generalTariff = await api.ipd.setBedTariff({
    orgSlug,
    categoryId: general.id,
    effectiveFrom,
    lines: [
      { catalogItemId: generalRoom.id, dailyPrice: 1_000_00n },
      { catalogItemId: nursing.id, dailyPrice: 200_00n },
    ],
  });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: icu.id,
    effectiveFrom,
    lines: [
      { catalogItemId: icuRoom.id, dailyPrice: 4_000_00n },
      { catalogItemId: nursing.id, dailyPrice: 500_00n },
    ],
  });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: odd.id,
    effectiveFrom,
    lines: [{ catalogItemId: oddRoom.id, dailyPrice: 999_99n }],
  });

  const bed = (label: string, categoryId: string) =>
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId, label });

  const beds = {
    g1: await bed("G-1", general.id),
    g2: await bed("G-2", general.id),
    g3: await bed("G-3", general.id),
    g4: await bed("G-4", general.id),
    i1: await bed("I-1", icu.id),
    i2: await bed("I-2", icu.id),
    o1: await bed("O-1", odd.id),
  };

  async function admitAt(bedId: string, at?: Date) {
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

    const backdate = at ? { admittedAt: at, ...BACKDATED } : {};

    const admission = await api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId,
      ...backdate,
    });

    return { patient, admission };
  }

  async function detail(admissionId: string) {
    return api.ipd.get({ orgSlug, admissionId });
  }

  async function transferAt(admissionId: string, bedId: string, at?: Date) {
    const { admission } = await detail(admissionId);
    const backdate = at ? { effectiveAt: at, ...BACKDATED } : {};

    return api.ipd.transferBed({
      orgSlug,
      admissionId,
      expectedRevision: admission.revision,
      bedId,
      ...backdate,
    });
  }

  async function readyAt(admissionId: string, at?: Date) {
    const { admission } = await detail(admissionId);
    const backdate = at ? { effectiveAt: at, ...BACKDATED } : {};

    return api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: admission.revision,
      ...backdate,
    });
  }

  /** Ready and discharged at `at` (now when omitted). */
  async function departAt(admissionId: string, at?: Date) {
    const ready = await readyAt(admissionId, at);
    const backdate = at ? { effectiveAt: at, ...BACKDATED } : {};

    return api.ipd.discharge({
      orgSlug,
      admissionId,
      expectedRevision: ready.revision,
      dischargeType: "normal",
      ...backdate,
    });
  }

  async function postService(admissionId: string, catalogItemId = dressing.id, qty = 1) {
    const { admission } = await detail(admissionId);

    return api.ipd.postServices({
      orgSlug,
      admissionId,
      expectedChargeRevision: admission.chargeRevision,
      lines: [{ catalogItemId, qty }],
    });
  }

  type LastDay = "full" | "half" | "none";

  async function preview(admissionId: string, lastDay?: LastDay) {
    return api.ipd.previewInvoice({ orgSlug, admissionId, lastDay });
  }

  /** Issues the bill the preview shows, left unpaid. */
  async function bill(admissionId: string, lastDay?: LastDay, lastDayReason?: string) {
    const quote = await preview(admissionId, lastDay);

    return api.ipd.issueInvoice({
      orgSlug,
      admissionId,
      expectedChargeRevision: quote.chargeRevision,
      expectedGrandTotal: quote.pending.grandTotal,
      lastDay,
      lastDayReason,
      payments: [],
      outstandingReason: quote.pending.grandTotal > 0n ? "Family settles at the desk" : undefined,
    });
  }

  async function chargeRows(admissionId: string) {
    return db
      .select()
      .from(charges)
      .where(and(eq(charges.orgId, orgId), eq(charges.admissionId, admissionId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));
  }

  async function bedDayCharges(admissionId: string) {
    return (await chargeRows(admissionId)).filter((charge) => charge.admissionKind === "bed_day");
  }

  async function invoiceLineRows(invoiceId: string) {
    return db
      .select({
        description: invoiceLines.description,
        qty: invoiceLines.qty,
        unitPrice: invoiceLines.unitPrice,
        gross: invoiceLines.gross,
      })
      .from(invoiceLines)
      .innerJoin(charges, and(eq(charges.orgId, orgId), eq(charges.id, invoiceLines.chargeId)))
      .where(and(eq(invoiceLines.orgId, orgId), eq(invoiceLines.invoiceId, invoiceId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));
  }

  async function invoiceRows() {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.orgId, orgId))
      .orderBy(asc(invoices.createdAt), asc(invoices.id));
  }

  /**
   * Moves a one-segment stay `hours` into the past, which is what the clock moving
   * `hours` forward looks like to an open stay.
   */
  async function shiftBack(admissionId: string, hours: number) {
    const interval = sql`${hours} * interval '1 hour'`;

    await db
      .update(admissionBedStays)
      .set({ startedAt: sql`${admissionBedStays.startedAt} - ${interval}` })
      .where(
        and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, admissionId)),
      );

    await db
      .update(admissions)
      .set({
        admittedAt: sql`${admissions.admittedAt} - ${interval}`,
        readyAt: sql`${admissions.readyAt} - ${interval}`,
      })
      .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admissionId)));
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
    settings,
    createService,
    services: { generalRoom, icuRoom, nursing, oddRoom, dressing },
    categories: { general, icu, odd },
    generalTariff,
    ward,
    practitioner,
    beds,
    admitAt,
    detail,
    transferAt,
    readyAt,
    departAt,
    postService,
    preview,
    bill,
    chargeRows,
    bedDayCharges,
    invoiceLineRows,
    invoiceRows,
    shiftBack,
    auditEntries,
  };
}

// ── Tariff ──────────────────────────────────────────────────────────────────

test("a bed type's tariff lists the room and any other daily line, in the order given", async () => {
  const hospital = await createHospital("bed-tariff");
  const { api, orgSlug, services, categories, generalTariff } = hospital;

  expect(generalTariff.categoryId).toBe(categories.general.id);
  expect(generalTariff.lines.map((line) => [line.catalogItemId, line.dailyPrice])).toEqual([
    [services.generalRoom.id, 1_000_00n],
    [services.nursing.id, 200_00n],
  ]);

  const facility = await api.ipd.facility({ orgSlug });
  const general = facility.categories.find((category) => category.id === categories.general.id);

  expect(general?.currentTariff?.id).toBe(generalTariff.id);
  expect(general?.currentTariff?.lines).toEqual([
    {
      catalogItemId: services.generalRoom.id,
      serviceName: services.generalRoom.name,
      dailyPrice: 1_000_00n,
      taxRatePercent: "0.00",
    },
    {
      catalogItemId: services.nursing.id,
      serviceName: services.nursing.name,
      dailyPrice: 200_00n,
      taxRatePercent: "0.00",
    },
  ]);

  const entries = await hospital.auditEntries("ipd.tariff.set");
  const entry = entries.find((candidate) => candidate.meta?.tariffId === generalTariff.id);

  expect(entry?.target).toBe(`bed_category:${categories.general.id}`);
  expect(JSON.stringify(entry?.meta)).toContain(services.nursing.id);
});

test("a tariff needs a line, lists a Service once, and takes only this hospital's active Services", async () => {
  const hospital = await createHospital("bed-tariff-refusals");
  const other = await createHospital("bed-tariff-other");
  const { api, orgSlug, services, categories } = hospital;
  const base = { orgSlug, categoryId: categories.general.id, effectiveFrom: new Date() };

  await expectORPCCode(api.ipd.setBedTariff({ ...base, lines: [] }), "BAD_REQUEST", "no line");

  await expectORPCCode(
    api.ipd.setBedTariff({
      ...base,
      lines: [
        { catalogItemId: services.generalRoom.id, dailyPrice: 1_000_00n },
        { catalogItemId: services.generalRoom.id, dailyPrice: 100_00n },
      ],
    }),
    "BAD_REQUEST",
    "one Service twice",
  );

  await expectORPCCode(
    api.ipd.setBedTariff({
      ...base,
      lines: [
        { catalogItemId: services.generalRoom.id, dailyPrice: 1_000_00n },
        { catalogItemId: other.services.nursing.id, dailyPrice: 200_00n },
      ],
    }),
    "NOT_FOUND",
    "another hospital's Service",
  );

  const retired = await hospital.createService("Retired daily charge");
  await api.catalog.setActive({ orgSlug, itemId: retired.id, active: false });

  await expectORPCCode(
    api.ipd.setBedTariff({
      ...base,
      lines: [{ catalogItemId: retired.id, dailyPrice: 50_00n }],
    }),
    "NOT_FOUND",
    "an inactive Service",
  );

  // Nothing above replaced the tariff in force.
  const facility = await api.ipd.facility({ orgSlug });
  const general = facility.categories.find((category) => category.id === categories.general.id);

  expect(general?.currentTariff?.id).toBe(hospital.generalTariff.id);
});

test("a hospital without a GSTIN cannot put a GST-charging Service on a tariff", async () => {
  const hospital = await createHospital("bed-tariff-gst");
  const { api, orgSlug, categories } = hospital;
  const taxed = await hospital.createService("Deluxe room rent", "5");

  await expectORPCCode(
    api.ipd.setBedTariff({
      orgSlug,
      categoryId: categories.general.id,
      effectiveFrom: new Date(),
      lines: [{ catalogItemId: taxed.id, dailyPrice: 6_000_00n }],
    }),
    "BAD_REQUEST",
  );
});

// ── Three hand-worked stays ─────────────────────────────────────────────────

test("a same-day stay is one bed day: every daily line of its bed type, written as Charges only by the bill", async () => {
  const hospital = await createHospital("bed-same-day");
  const { orgId, services, categories, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(2, "14:00"));
  await hospital.departAt(admission.id, ist(2, "18:00"));

  const quote = await hospital.preview(admission.id);

  expect(quote.through).toEqual(ist(2, "18:00"));
  expect(quote.bedDays).toEqual({
    billed: 0,
    unbilled: [
      { day: 1, date: istDate(2), categoryId: categories.general.id, categoryName: "General" },
    ],
  });

  expect(quote.pending.lines).toHaveLength(2);
  expect(quote.pending.lines[0]).toMatchObject({
    chargeId: null,
    admissionKind: "bed_day",
    description: `${services.generalRoom.name} · General · ${label(istDate(2))}`,
    qty: 1,
    unitPrice: 1_000_00n,
    priceBasis: "exclusive",
    taxRatePercent: "0.00",
    gross: 1_000_00n,
    batch: null,
  });
  expect(quote.pending.lines[1]).toMatchObject({
    admissionKind: "bed_day",
    description: `${services.nursing.name} · General · ${label(istDate(2))}`,
    qty: 1,
    unitPrice: 200_00n,
    gross: 200_00n,
  });
  expect(quote.pending.grandTotal).toBe(1_200_00n);

  // Reading the bill posts nothing.
  expect(await hospital.chargeRows(admission.id)).toEqual([]);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(0);

  const issued = await hospital.bill(admission.id);

  if (!issued.invoiceId) throw new Error("expected an Invoice");

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, issued.invoiceId)));

  expect(invoice).toMatchObject({ stream: "ipd", grandTotal: 1_200_00n, roundOff: 0n });

  const written = await hospital.bedDayCharges(admission.id);

  expect(written).toHaveLength(2);
  expect(written[0]).toMatchObject({
    admissionKind: "bed_day",
    sourceType: "admission",
    sourceId: admission.id,
    catalogItemId: services.generalRoom.id,
    description: `${services.generalRoom.name} · General · ${label(istDate(2))}`,
    qty: 1,
    unitPrice: 1_000_00n,
    priceBasis: "exclusive",
    taxRatePercent: "0.00",
    revenueCategory: "other",
    status: "invoiced",
    invoiceId: issued.invoiceId,
    stockBatchId: null,
    admissionIssueLineId: null,
  });
  expect(written[1]).toMatchObject({ catalogItemId: services.nursing.id, unitPrice: 200_00n });

  expect(await hospital.invoiceLineRows(issued.invoiceId)).toEqual([
    {
      description: `${services.generalRoom.name} · General · ${label(istDate(2))}`,
      qty: 1,
      unitPrice: 1_000_00n,
      gross: 1_000_00n,
    },
    {
      description: `${services.nursing.name} · General · ${label(istDate(2))}`,
      qty: 1,
      unitPrice: 200_00n,
      gross: 200_00n,
    },
  ]);

  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(1);
});

test("a day spent five hours in the ward and sixteen in ICU is billed as one ICU day", async () => {
  const hospital = await createHospital("bed-move");
  const { services, categories, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(3, "15:00"));
  await hospital.transferAt(admission.id, beds.i1.id, ist(3, "20:00"));
  await hospital.departAt(admission.id, ist(2, "12:00"));

  const quote = await hospital.preview(admission.id);

  expect(quote.bedDays.unbilled).toEqual([
    { day: 1, date: istDate(3), categoryId: categories.icu.id, categoryName: "ICU" },
  ]);
  expect(quote.pending.lines.map((line) => [line.description, line.qty, line.unitPrice])).toEqual([
    [`${services.icuRoom.name} · ICU · ${label(istDate(3))}`, 1, 4_000_00n],
    [`${services.nursing.name} · ICU · ${label(istDate(3))}`, 1, 500_00n],
  ]);
  expect(quote.pending.grandTotal).toBe(4_500_00n);

  const issued = await hospital.bill(admission.id);
  const [invoice] = await hospital.invoiceRows();

  expect(invoice?.id).toBe(issued.invoiceId!);
  expect(invoice?.grandTotal).toBe(4_500_00n);
});

test("a stay one minute past checkout is two bed days on one line per daily charge", async () => {
  const hospital = await createHospital("bed-overstay");
  const { services, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(3, "11:00"));
  await hospital.departAt(admission.id, ist(2, "12:01"));

  const quote = await hospital.preview(admission.id);
  const range = `${label(istDate(3))} to ${label(istDate(2))}`;

  expect(quote.bedDays.unbilled.map((day) => [day.day, day.date])).toEqual([
    [1, istDate(3)],
    [2, istDate(2)],
  ]);
  expect(
    quote.pending.lines.map((line) => [line.description, line.qty, line.unitPrice, line.gross]),
  ).toEqual([
    [`${services.generalRoom.name} · General · ${range}`, 2, 1_000_00n, 2_000_00n],
    [`${services.nursing.name} · General · ${range}`, 2, 200_00n, 400_00n],
  ]);
  expect(quote.pending.grandTotal).toBe(2_400_00n);

  // Leaving exactly at checkout would have been one day.
  const exact = await hospital.admitAt(beds.g2.id, ist(3, "11:00"));
  await hospital.departAt(exact.admission.id, ist(2, "12:00"));

  expect((await hospital.preview(exact.admission.id)).pending.grandTotal).toBe(1_200_00n);
});

test("consecutive days at one tariff share a line; a change of bed type starts new lines", async () => {
  const hospital = await createHospital("bed-runs");
  const { services, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(5, "15:00"));
  // An hour into the third day, so that day and the next are ICU days.
  await hospital.transferAt(admission.id, beds.i1.id, ist(3, "13:00"));
  await hospital.departAt(admission.id, ist(1, "11:00"));

  const quote = await hospital.preview(admission.id);
  const wardDays = `${label(istDate(5))} to ${label(istDate(4))}`;
  const icuDays = `${label(istDate(3))} to ${label(istDate(2))}`;

  expect(quote.bedDays.unbilled.map((day) => day.categoryName)).toEqual([
    "General",
    "General",
    "ICU",
    "ICU",
  ]);
  expect(quote.pending.lines.map((line) => [line.description, line.qty, line.unitPrice])).toEqual([
    [`${services.generalRoom.name} · General · ${wardDays}`, 2, 1_000_00n],
    [`${services.nursing.name} · General · ${wardDays}`, 2, 200_00n],
    [`${services.icuRoom.name} · ICU · ${icuDays}`, 2, 4_000_00n],
    [`${services.nursing.name} · ICU · ${icuDays}`, 2, 500_00n],
  ]);
  expect(quote.pending.grandTotal).toBe(11_400_00n);

  const issued = await hospital.bill(admission.id);

  expect(
    (await hospital.invoiceLineRows(issued.invoiceId!)).map((line) => [line.qty, line.gross]),
  ).toEqual([
    [2, 2_000_00n],
    [2, 400_00n],
    [2, 8_000_00n],
    [2, 1_000_00n],
  ]);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(4);
});

test("a stay segment keeps the tariff it started under; a new rate prices only later segments", async () => {
  const hospital = await createHospital("bed-tariff-snapshot");
  const { api, orgSlug, services, categories, beds, generalTariff } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(2, "14:00"));

  const raised = await api.ipd.setBedTariff({
    orgSlug,
    categoryId: categories.general.id,
    effectiveFrom: new Date(),
    lines: [{ catalogItemId: services.generalRoom.id, dailyPrice: 1_500_00n }],
  });

  const before = await hospital.detail(admission.id);

  expect(before.stays).toHaveLength(1);
  expect(before.stays[0]).toMatchObject({
    tariffId: generalTariff.id,
    categoryId: categories.general.id,
    categoryName: "General",
  });

  // The open segment still bills at the old ₹1,200 a day.
  const days = daysThrough(ist(2, "14:00"), new Date());
  expect(before.runningBill).toBe(BigInt(days) * 1_200_00n);

  await hospital.transferAt(admission.id, beds.g2.id);

  const after = await hospital.detail(admission.id);
  expect(after.stays.map((stay) => stay.tariffId)).toEqual([generalTariff.id, raised.id]);
});

// ── The last day ────────────────────────────────────────────────────────────

test("a half last day bills each daily line at half price, rounded half up, and is audited", async () => {
  const hospital = await createHospital("bed-half");
  const { services, beds } = hospital;

  const ward = await hospital.admitAt(beds.g1.id, ist(3, "15:00"));
  await hospital.departAt(ward.admission.id, ist(2, "12:01"));

  const quote = await hospital.preview(ward.admission.id, "half");

  expect(quote.pending.lines.map((line) => [line.description, line.qty, line.unitPrice])).toEqual([
    [`${services.generalRoom.name} · General · ${label(istDate(3))}`, 1, 1_000_00n],
    [`${services.nursing.name} · General · ${label(istDate(3))}`, 1, 200_00n],
    [`${services.generalRoom.name} · General · ${label(istDate(2))} · half day`, 1, 500_00n],
    [`${services.nursing.name} · General · ${label(istDate(2))} · half day`, 1, 100_00n],
  ]);
  expect(quote.pending.grandTotal).toBe(1_800_00n);
  // The full bill is untouched by asking for the half one.
  expect((await hospital.preview(ward.admission.id)).pending.grandTotal).toBe(2_400_00n);

  const issued = await hospital.bill(ward.admission.id, "half", "Left before breakfast");
  const [invoice] = await hospital.invoiceRows();

  expect(invoice?.id).toBe(issued.invoiceId!);
  expect(invoice?.grandTotal).toBe(1_800_00n);
  expect((await hospital.detail(ward.admission.id)).admission.bedDaysBilled).toBe(2);

  // ₹999.99 halves to ₹499.995, which rounds up to ₹500.00.
  const odd = await hospital.admitAt(beds.o1.id, ist(3, "15:00"));
  await hospital.departAt(odd.admission.id, ist(2, "12:01"));

  const oddQuote = await hospital.preview(odd.admission.id, "half");

  expect(oddQuote.pending.lines.map((line) => line.unitPrice)).toEqual([999_99n, 500_00n]);
  expect(oddQuote.pending.grandTotal).toBe(1_499_99n);

  const entries = await hospital.auditEntries("ipd.lastDay.adjust");

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    target: `admission:${ward.admission.id}`,
    meta: { lastDay: "half", reason: "Left before breakfast", date: istDate(2) },
  });
});

test("an uncharged last day leaves the bill but still counts as billed", async () => {
  const hospital = await createHospital("bed-none");
  const { services, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(3, "15:00"));
  await hospital.postService(admission.id);
  await hospital.departAt(admission.id, ist(2, "12:01"));

  const quote = await hospital.preview(admission.id, "none");

  // Pending Charges first, then the bed days that are charged.
  expect(
    quote.pending.lines.map((line) => [line.admissionKind, line.description, line.qty]),
  ).toEqual([
    ["service", services.dressing.name, 1],
    ["bed_day", `${services.generalRoom.name} · General · ${label(istDate(3))}`, 1],
    ["bed_day", `${services.nursing.name} · General · ${label(istDate(3))}`, 1],
  ]);
  expect(quote.pending.grandTotal).toBe(1_700_00n);

  const issued = await hospital.bill(admission.id, "none", "Discharge delayed by the hospital");

  expect(await hospital.invoiceLineRows(issued.invoiceId!)).toHaveLength(3);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(2);

  const after = await hospital.preview(admission.id);

  expect(after.bedDays).toEqual({ billed: 2, unbilled: [] });
  expect(after.pending.lines).toEqual([]);
});

test("a bill with nothing chargeable issues no Invoice and only advances the billed days", async () => {
  const hospital = await createHospital("bed-nothing");
  const { api, orgSlug, orgId, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(2, "14:00"));
  await hospital.departAt(admission.id, ist(2, "18:00"));

  const quote = await hospital.preview(admission.id, "none");

  expect(quote.bedDays.unbilled).toHaveLength(1);
  expect(quote.pending.lines).toEqual([]);
  expect(quote.pending.grandTotal).toBe(0n);

  const uncharged = {
    orgSlug,
    admissionId: admission.id,
    expectedChargeRevision: quote.chargeRevision,
    expectedGrandTotal: 0n,
    lastDay: "none" as const,
    lastDayReason: "Admitted and sent home within the hour",
  };

  await expectORPCCode(
    api.ipd.issueInvoice({ ...uncharged, payments: [{ method: "cash", amount: 100_00n }] }),
    "BAD_REQUEST",
    "money against nothing",
  );
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(0);

  const result = await api.ipd.issueInvoice({ ...uncharged, payments: [] });

  expect(result.invoiceId).toBeNull();
  expect(result.receiptIds).toEqual([]);
  expect(await hospital.invoiceRows()).toEqual([]);
  expect(await hospital.chargeRows(admission.id)).toEqual([]);
  expect(
    await db
      .select()
      .from(counter)
      .where(and(eq(counter.orgId, orgId), sql`${counter.key} like 'invoice:ipd:%'`)),
  ).toEqual([]);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(1);

  const [entry] = await hospital.auditEntries("ipd.lastDay.adjust");

  expect(entry).toMatchObject({
    target: `admission:${admission.id}`,
    meta: { lastDay: "none", reason: "Admitted and sent home within the hour" },
  });

  // The day is dealt with, so nothing is left to bill.
  const after = await hospital.preview(admission.id);

  expect(after.bedDays).toEqual({ billed: 1, unbilled: [] });
  expect(after.issued).toEqual([]);

  await expectORPCCode(
    api.ipd.issueInvoice({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: after.chargeRevision,
      expectedGrandTotal: 0n,
      payments: [],
    }),
    "CONFLICT",
    "nothing left to bill",
  );
});

test("a half or uncharged last day needs a reason, and an unbilled day to apply to", async () => {
  const hospital = await createHospital("bed-last-day-rules");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(2, "14:00"));
  await hospital.departAt(admission.id, ist(2, "18:00"));

  const quote = await hospital.preview(admission.id, "half");

  await expectORPCCode(
    api.ipd.issueInvoice({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: quote.chargeRevision,
      expectedGrandTotal: quote.pending.grandTotal,
      lastDay: "half",
      payments: [],
      outstandingReason: "Family settles at the desk",
    }),
    "BAD_REQUEST",
    "a half day without a reason",
  );
  expect(await hospital.invoiceRows()).toEqual([]);

  await hospital.bill(admission.id);
  await hospital.postService(admission.id);

  await expectORPCCode(hospital.preview(admission.id, "half"), "BAD_REQUEST", "no day to halve");
  await expectORPCCode(
    hospital.bill(admission.id, "none", "No day left to waive"),
    "BAD_REQUEST",
    "no day to waive",
  );

  // The late service still bills on its own.
  const second = await hospital.bill(admission.id);
  expect(await hospital.invoiceLineRows(second.invoiceId!)).toHaveLength(1);
});

// ── The bill repeats without repeating a day ────────────────────────────────

test("a second bill never repeats a day, and takes only the days that came after", async () => {
  const hospital = await createHospital("bed-repeat");
  const { beds } = hospital;
  const admittedAt = ist(3, "15:00");
  const { admission } = await hospital.admitAt(beds.g1.id, admittedAt);
  await hospital.readyAt(admission.id);

  const days = daysThrough(admittedAt, new Date());
  const first = await hospital.bill(admission.id);

  expect(
    (await hospital.invoiceLineRows(first.invoiceId!)).map((line) => [line.qty, line.gross]),
  ).toEqual([
    [days, BigInt(days) * 1_000_00n],
    [days, BigInt(days) * 200_00n],
  ]);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(days);

  const afterFirst = await hospital.preview(admission.id);

  expect(afterFirst.bedDays).toEqual({ billed: days, unbilled: [] });
  expect(afterFirst.pending.lines).toEqual([]);

  // A late service bills alone: no bed day rides along a second time.
  await hospital.postService(admission.id);
  const second = await hospital.bill(admission.id);

  expect(await hospital.invoiceLineRows(second.invoiceId!)).toHaveLength(1);
  expect(await hospital.bedDayCharges(admission.id)).toHaveLength(2);

  // A day later, the next bill holds exactly that one day.
  await hospital.shiftBack(admission.id, 24);

  const third = await hospital.preview(admission.id);

  expect(third.bedDays.billed).toBe(days);
  expect(third.bedDays.unbilled.map((day) => day.day)).toEqual([days + 1]);
  expect(third.pending.lines.map((line) => line.qty)).toEqual([1, 1]);
  expect(third.pending.grandTotal).toBe(1_200_00n);

  await hospital.bill(admission.id);

  expect(await hospital.bedDayCharges(admission.id)).toHaveLength(4);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(days + 1);
  expect((await hospital.invoiceRows()).map((invoice) => invoice.grandTotal)).toEqual([
    BigInt(days) * 1_200_00n,
    500_00n,
    1_200_00n,
  ]);
});

test("a total previewed before checkout is refused after it, and nothing is written", async () => {
  const hospital = await createHospital("bed-stale-total");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(2, "15:00"));
  await hospital.readyAt(admission.id);

  const stale = await hospital.preview(admission.id);

  // The clock crosses a checkout between the preview and the bill.
  await hospital.shiftBack(admission.id, 24);

  await expectORPCCode(
    api.ipd.issueInvoice({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: stale.chargeRevision,
      expectedGrandTotal: stale.pending.grandTotal,
      payments: [{ method: "cash", amount: stale.pending.grandTotal }],
    }),
    "CONFLICT",
  );

  expect(await hospital.invoiceRows()).toEqual([]);
  expect(await hospital.chargeRows(admission.id)).toEqual([]);
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(0);

  const fresh = await hospital.preview(admission.id);

  expect(fresh.pending.grandTotal).toBe(stale.pending.grandTotal + 1_200_00n);

  const issued = await hospital.bill(admission.id);
  expect(issued.invoiceId).toBeTruthy();
});

// ── Running bill ────────────────────────────────────────────────────────────

test("the Admission, the list and the board show the running bill without any posting", async () => {
  const hospital = await createHospital("bed-running");
  const { api, orgSlug, beds } = hospital;
  const admittedAt = ist(2, "15:00");
  const { admission } = await hospital.admitAt(beds.g1.id, admittedAt);
  await hospital.postService(admission.id);

  const expected = BigInt(daysThrough(admittedAt, new Date())) * 1_200_00n + 500_00n;

  const detail = await hospital.detail(admission.id);
  expect(detail.runningBill).toBe(expected);

  const list = await api.ipd.list({ orgSlug });
  expect(list.items.find((item) => item.id === admission.id)?.runningBill).toBe(expected);

  const board = await api.ipd.bedBoard({ orgSlug });
  const bed = board.beds.find((candidate) => candidate.id === beds.g1.id);
  expect(bed?.admission?.runningBill).toBe(expected);

  expect((await hospital.preview(admission.id)).pending.grandTotal).toBe(expected);

  // Only the service was ever posted: the bed days exist nowhere.
  const posted = await hospital.chargeRows(admission.id);
  expect(posted.map((charge) => charge.admissionKind)).toEqual(["service"]);
  expect(detail.admission.bedDaysBilled).toBe(0);
});

test("the running bill follows a move with nothing to invalidate, and is zero once billed or cancelled", async () => {
  const hospital = await createHospital("bed-running-move");
  const { api, orgSlug, beds } = hospital;
  const admittedAt = ist(3, "15:00");
  const { admission } = await hospital.admitAt(beds.g4.id, admittedAt);
  const days = daysThrough(admittedAt, new Date());

  expect((await hospital.detail(admission.id)).runningBill).toBe(BigInt(days) * 1_200_00n);

  // Moved to ICU an hour into the second day: that day and every later one is ICU.
  await hospital.transferAt(admission.id, beds.i2.id, ist(2, "13:00"));

  expect((await hospital.detail(admission.id)).runningBill).toBe(
    1_200_00n + BigInt(days - 1) * 4_500_00n,
  );

  await hospital.departAt(admission.id);
  await hospital.bill(admission.id);

  expect((await hospital.detail(admission.id)).runningBill).toBe(0n);

  const past = await api.ipd.list({ orgSlug, state: "past" });
  expect(past.items.find((item) => item.id === admission.id)?.runningBill).toBe(0n);

  const mistaken = await hospital.admitAt(beds.g1.id, ist(2, "15:00"));

  await api.ipd.cancel({
    orgSlug,
    admissionId: mistaken.admission.id,
    expectedRevision: mistaken.admission.revision,
    reason: "Admitted the wrong Patient",
  });

  expect((await hospital.detail(mistaken.admission.id)).runningBill).toBe(0n);
});

// ── A billed day is corrected by Credit Note, not by rewriting the stay ─────

test("a backdated move that would change a billed day is refused; a move now is not", async () => {
  const hospital = await createHospital("bed-billed-day");
  const { api, orgSlug, orgId, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g3.id, ist(3, "15:00"));
  await hospital.readyAt(admission.id);
  await hospital.bill(admission.id);

  const ready = await hospital.detail(admission.id);

  await api.ipd.undoDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.admission.revision,
    reason: "Patient stays another night",
  });

  const before = await db
    .select()
    .from(admissionBedStays)
    .where(
      and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, admission.id)),
    );

  await expectORPCCode(
    hospital.transferAt(admission.id, beds.i1.id, ist(2, "13:00")),
    "CONFLICT",
    "a move into days already billed",
  );

  expect(
    await db
      .select()
      .from(admissionBedStays)
      .where(
        and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, admission.id)),
      ),
  ).toEqual(before);

  const moved = await hospital.transferAt(admission.id, beds.i1.id);
  expect(moved.currentBedId).toBe(beds.i1.id);
});

test("a departure time inside days already billed is still recorded; the bill is corrected by Credit Note", async () => {
  const hospital = await createHospital("bed-billed-departure");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, ist(3, "15:00"));
  // An hour into the second day, so that day and every later one is billed as ICU.
  await hospital.transferAt(admission.id, beds.i1.id, ist(2, "13:00"));
  await hospital.readyAt(admission.id);
  await hospital.bill(admission.id);

  const ready = await hospital.detail(admission.id);
  const billed = ready.admission.bedDaysBilled;

  await api.ipd.undoDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.admission.revision,
    reason: "Ready was marked on the wrong stay",
  });

  // The Patient really left forty minutes after the move, so the second day was a ward day.
  const departed = await hospital.departAt(admission.id, ist(2, "13:40"));

  expect(departed.status).toBe("discharged");
  expect(departed.dischargedAt).toEqual(ist(2, "13:40"));

  // Billed days never move back: what was over-billed is credited, not un-billed.
  expect((await hospital.detail(admission.id)).admission.bedDaysBilled).toBe(billed);
  expect((await hospital.preview(admission.id)).bedDays).toEqual({ billed, unbilled: [] });
});

test("undoing a departure is never refused because its day was billed", async () => {
  // Checkout sits three hours ahead of now, so the whole stay below is its first bed day.
  const now = Date.now();
  const checkoutMinutes = Math.floor(((now + 3 * HOUR + IST_OFFSET) % DAY) / 60_000);
  const hospital = await createHospital("bed-billed-reopen", { checkoutMinutes });
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admitAt(beds.g1.id, new Date(now - 20 * HOUR));
  await hospital.transferAt(admission.id, beds.i1.id, new Date(now - 12.5 * HOUR));
  const discharged = await hospital.departAt(admission.id, new Date(now - 12 * HOUR));

  // Seven and a half hours in the ward against half an hour in ICU: a ward day.
  const quote = await hospital.preview(admission.id);

  expect(quote.bedDays.unbilled.map((day) => day.categoryName)).toEqual(["General"]);
  await hospital.bill(admission.id);

  const reopened = await api.ipd.reopen({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: discharged.revision,
    reason: "The Patient had not left",
  });

  expect(reopened.status).toBe("admitted");
  expect(reopened.currentBedId).toBe(beds.i1.id);

  // By the hours now it is an ICU day, but it was billed as a ward day and stays billed.
  const detail = await hospital.detail(admission.id);

  expect(detail.admission.bedDaysBilled).toBe(1);
  expect(detail.runningBill).toBe(0n);
});

// ── Tax follows the Service ─────────────────────────────────────────────────

test("a registered hospital's taxed room line carries its Service's GST on the bill", async () => {
  const hospital = await createHospital("bed-gst", { gstin: GSTIN });
  const { api, orgSlug, ward } = hospital;
  const deluxeRoom = await hospital.createService("Deluxe room rent", "5");
  const deluxe = await api.ipd.createBedCategory({ orgSlug, name: "Deluxe" });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: deluxe.id,
    effectiveFrom: new Date(Date.now() - 30 * DAY),
    lines: [{ catalogItemId: deluxeRoom.id, dailyPrice: 6_000_00n }],
  });

  const bed = await api.ipd.createBed({
    orgSlug,
    wardId: ward.id,
    categoryId: deluxe.id,
    label: "D-1",
  });

  const { admission } = await hospital.admitAt(bed.id, ist(2, "14:00"));
  await hospital.departAt(admission.id, ist(2, "18:00"));

  const quote = await hospital.preview(admission.id);

  expect(quote.registered).toBe(true);
  expect(quote.pending.lines).toHaveLength(1);
  expect(quote.pending.lines[0]).toMatchObject({
    admissionKind: "bed_day",
    unitPrice: 6_000_00n,
    priceBasis: "exclusive",
    taxRatePercent: "5.00",
    taxCode: "996311",
    taxableValue: 6_000_00n,
    taxAmount: 300_00n,
    gross: 6_300_00n,
  });
  expect(quote.pending.grandTotal).toBe(6_300_00n);
  expect((await hospital.detail(admission.id)).runningBill).toBe(6_300_00n);

  await hospital.bill(admission.id);
  const [invoice] = await hospital.invoiceRows();

  expect(invoice).toMatchObject({ subtotal: 6_000_00n, taxTotal: 300_00n, grandTotal: 6_300_00n });
});

// ── Checkout time ───────────────────────────────────────────────────────────

test("the checkout time is the hospital's setting, snapshotted when the Patient is admitted", async () => {
  const hospital = await createHospital("bed-checkout", { checkoutMinutes: 600 });
  const { api, beds } = hospital;

  // Checkout at 10:00: leaving at 10:01 the next morning is a second day.
  const early = await hospital.admitAt(beds.g1.id, ist(2, "11:00"));

  expect(early.admission.checkoutMinutes).toBe(600);

  await hospital.departAt(early.admission.id, ist(1, "10:01"));
  expect((await hospital.preview(early.admission.id)).bedDays.unbilled).toHaveLength(2);

  // A later change does not re-time that stay; it applies to the next admission.
  await api.settings.update(hospital.settings(720));

  expect((await hospital.preview(early.admission.id)).bedDays.unbilled).toHaveLength(2);
  expect((await hospital.detail(early.admission.id)).admission.checkoutMinutes).toBe(600);

  const later = await hospital.admitAt(beds.g2.id, ist(2, "11:00"));

  expect(later.admission.checkoutMinutes).toBe(720);

  await hospital.departAt(later.admission.id, ist(1, "10:01"));
  expect((await hospital.preview(later.admission.id)).bedDays.unbilled).toHaveLength(1);
});

test("the checkout setting defaults to noon and must be a minute of the day", async () => {
  const owner = await createTestUser("bed-checkout-default-owner");
  const organization = await createOrganization(owner, "bed-checkout-default");
  const fresh = clientFor(owner);

  expect((await fresh.settings.get({ orgSlug: organization.slug })).ipdCheckoutMinutes).toBe(720);

  const hospital = await createHospital("bed-checkout-range");
  const { api, orgSlug } = hospital;

  await expectORPCCode(api.settings.update(hospital.settings(1_440)), "BAD_REQUEST", "24:00");
  await expectORPCCode(api.settings.update(hospital.settings(-1)), "BAD_REQUEST", "negative");

  await api.settings.update(hospital.settings(0));
  expect((await api.settings.get({ orgSlug })).ipdCheckoutMinutes).toBe(0);
});
