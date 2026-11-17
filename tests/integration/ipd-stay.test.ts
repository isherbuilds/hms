// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 3 (the stay record, undoing a
// discharge, database-enforced occupancy). The repeatable bill is in ipd-billing.test.ts.
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { counter } from "@hms/db/schema/counter";
import { invoices } from "@hms/db/schema/invoices";
import { admissionBedStays, admissions } from "@hms/db/schema/ipd";
import { and, asc, eq, sql } from "drizzle-orm";

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

const HOUR = 60 * 60 * 1_000;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR);
}

// The fixture org runs on Asia/Kolkata with an April financial year.
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

const DISCHARGE_TYPES = ["normal", "against_advice", "absconded", "referred", "death"] as const;

type DischargeType = (typeof DISCHARGE_TYPES)[number];

let phoneSequence = 5_590_000;

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

  const roomService = await api.catalog.create({
    orgSlug,
    name: `${seed} General ward bed day`,
    category: "other",
    unitPrice: 1_000_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  const service = await api.catalog.create({
    orgSlug,
    name: `${seed} Dressing`,
    category: "procedure",
    unitPrice: 500_00n,
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

  const secondPractitioner = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed} Second`,
    departmentId: department.id,
  });

  const ward = await api.ipd.createWard({ orgSlug, name: "General" });
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General bed" });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: category.id,
    lines: [{ catalogItemId: roomService.id, dailyPrice: 1_000_00n }],
    effectiveFrom: hoursAgo(24 * 60),
  });

  const beds: Array<Awaited<ReturnType<typeof api.ipd.createBed>>> = [];

  for (const label of ["G-1", "G-2", "G-3", "G-4", "G-5", "G-6"]) {
    beds.push(
      await api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label }),
    );
  }

  async function registerPatient(name = `${seed} Patient ${uniqueSuffix()}`) {
    phoneSequence += 1;

    return api.patient.register({
      orgSlug,
      name,
      phone: String(phoneSequence),
      sex: "other",
      dateOfBirth: "1980-01-01",
      dobEstimated: true,
      address: `${seed} Patient Address`,
    });
  }

  async function admit(
    bedIndex: number,
    extra: Partial<Parameters<AppRouterClient["ipd"]["admit"]>[0]> = {},
    client: AppRouterClient = api,
  ) {
    const patient = await registerPatient();

    const admission = await client.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[bedIndex]!.id,
      ...extra,
    });

    return { patient, admission };
  }

  async function detail(admissionId: string, client: AppRouterClient = api) {
    return client.ipd.get({ orgSlug, admissionId });
  }

  /** Ready, then discharged; `at` backdates both with the owner's correction grant. */
  async function depart(admissionId: string, dischargeType: DischargeType = "normal", at?: Date) {
    const before = await detail(admissionId);
    const backdate = at ? { effectiveAt: at, reason: "Entered from the ward register" } : {};

    const ready = await api.ipd.markDischargeReady({
      orgSlug,
      admissionId,
      expectedRevision: before.admission.revision,
      ...backdate,
    });

    return api.ipd.discharge({
      orgSlug,
      admissionId,
      expectedRevision: ready.revision,
      dischargeType,
      ...backdate,
    });
  }

  async function releaseBed(bedId: string) {
    const board = await api.ipd.bedBoard({ orgSlug });
    const bed = board.beds.find((candidate) => candidate.id === bedId);

    if (!bed?.blockedAt) throw new Error(`bed ${bedId} is not blocked`);

    return api.ipd.releaseBed({ orgSlug, bedId, expectedBlockedAt: bed.blockedAt });
  }

  async function boardBed(bedId: string) {
    const board = await api.ipd.bedBoard({ orgSlug });
    const bed = board.beds.find((candidate) => candidate.id === bedId);

    if (!bed) throw new Error(`bed ${bedId} missing from the board`);

    return bed;
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
    owner,
    orgSlug,
    orgId,
    api,
    service,
    practitioner,
    secondPractitioner,
    category,
    beds,
    registerPatient,
    admit,
    detail,
    depart,
    releaseBed,
    boardBed,
    member,
    auditEntries,
  };
}

async function stayRows(orgId: string, admissionId: string) {
  return db
    .select()
    .from(admissionBedStays)
    .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, admissionId)))
    .orderBy(asc(admissionBedStays.startedAt), asc(admissionBedStays.id));
}

/** The Postgres error under the driver's wrapper, or undefined when the write succeeded. */
async function pgRejection(write: Promise<unknown>) {
  try {
    await write;
  } catch (error) {
    const seen = new Set<unknown>();
    let current: unknown = error;

    while (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);

      if (
        "code" in current &&
        typeof current.code === "string" &&
        /^[0-9A-Z]{5}$/.test(current.code)
      ) {
        return {
          code: current.code,
          constraint: "constraint" in current ? String(current.constraint) : undefined,
        };
      }

      current = "cause" in current ? current.cause : undefined;
    }

    throw error;
  }

  return undefined;
}

// ── IPD number ──────────────────────────────────────────────────────────────

test("each Admission takes the next IPD number of its financial year, and a refused admit uses none", async () => {
  const hospital = await createHospital("stay-number");
  const { api, orgSlug, orgId, beds, practitioner } = hospital;
  const fy = fiscalYearNow();

  const first = await hospital.admit(0);
  const second = await hospital.admit(1);

  expect(first.admission.admissionNumber).toBe(`${fy}/1`);
  expect(second.admission.admissionNumber).toBe(`${fy}/2`);

  // The bed is taken, so this admit is refused and must leave the series alone.
  const refused = await hospital.registerPatient();
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: refused.id,
      practitionerId: practitioner.id,
      bedId: beds[0]!.id,
    }),
    "CONFLICT",
  );

  const third = await hospital.admit(2);
  expect(third.admission.admissionNumber).toBe(`${fy}/3`);

  const [series] = await db
    .select({ value: counter.value })
    .from(counter)
    .where(and(eq(counter.orgId, orgId), eq(counter.key, `admission:${fy}`)));

  expect(series?.value).toBe(3);

  const detail = await hospital.detail(second.admission.id);
  expect(detail.admission.admissionNumber).toBe(`${fy}/2`);

  const list = await api.ipd.list({ orgSlug });
  const numbers = new Map(list.items.map((item) => [item.id, item.admissionNumber]));

  expect(numbers.get(first.admission.id)).toBe(`${fy}/1`);
  expect(numbers.get(third.admission.id)).toBe(`${fy}/3`);
});

test("the IPD number series is the Organization's own", async () => {
  const one = await createHospital("stay-number-one");
  const two = await createHospital("stay-number-two");
  const fy = fiscalYearNow();

  await one.admit(0);
  await one.admit(1);
  const other = await two.admit(0);

  expect(other.admission.admissionNumber).toBe(`${fy}/1`);
});

// ── Stay facts ──────────────────────────────────────────────────────────────

test("admission captures the attendant, the medico-legal flag and the diagnosis", async () => {
  const hospital = await createHospital("stay-facts");
  const reception = await hospital.member("reception");

  const { admission } = await hospital.admit(
    0,
    {
      attendantName: "Meena Kumari",
      attendantPhone: "9876500001",
      medicoLegal: true,
      medicoLegalRef: "PS Sector 17, DD 42/2026",
      diagnosis: "Road traffic accident, fracture left femur",
    },
    reception,
  );

  const facts = {
    attendantName: "Meena Kumari",
    attendantPhone: "9876500001",
    medicoLegal: true,
    medicoLegalRef: "PS Sector 17, DD 42/2026",
    diagnosis: "Road traffic accident, fracture left femur",
    dischargeType: null,
  };

  expect(admission).toMatchObject(facts);
  expect((await hospital.detail(admission.id)).admission).toMatchObject(facts);

  const plain = await hospital.admit(1);

  expect(plain.admission).toMatchObject({
    attendantName: null,
    attendantPhone: null,
    medicoLegal: false,
    medicoLegalRef: null,
    diagnosis: null,
    dischargeType: null,
  });
});

test("a medico-legal reference needs the medico-legal flag", async () => {
  const hospital = await createHospital("stay-mlc-ref");
  const { api, orgSlug, orgId, beds, practitioner } = hospital;
  const patient = await hospital.registerPatient();

  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[0]!.id,
      medicoLegalRef: "DD 7/2026",
    }),
    "BAD_REQUEST",
  );

  expect(await db.select().from(admissions).where(eq(admissions.orgId, orgId))).toEqual([]);
});

test("reception edits the stay's facts: an omitted field stays, null clears, and the revision advances", async () => {
  const hospital = await createHospital("stay-edit");
  const { orgSlug } = hospital;
  const reception = await hospital.member("reception");

  const { admission } = await hospital.admit(0, {
    attendantName: "Ravi",
    attendantPhone: "9876500002",
    diagnosis: "Fever under evaluation",
  });

  const edited = await reception.ipd.updateDetails({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    attendantName: "Ravi Sharma",
    attendantPhone: null,
    medicoLegal: true,
    medicoLegalRef: "MLC register 12",
  });

  expect(edited.revision).toBe(admission.revision + 1);
  expect(edited).toMatchObject({
    attendantName: "Ravi Sharma",
    attendantPhone: null,
    medicoLegal: true,
    medicoLegalRef: "MLC register 12",
    diagnosis: "Fever under evaluation",
  });

  const again = await reception.ipd.updateDetails({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: edited.revision,
    diagnosis: "Dengue fever",
    medicoLegal: false,
  });

  // Turning the flag off clears its reference.
  expect(again).toMatchObject({
    attendantName: "Ravi Sharma",
    medicoLegal: false,
    medicoLegalRef: null,
    diagnosis: "Dengue fever",
  });

  expect((await hospital.detail(admission.id)).admission).toMatchObject({
    revision: admission.revision + 2,
    diagnosis: "Dengue fever",
    medicoLegal: false,
  });
});

test("editing the stay needs the current revision, an active stay and the update grant", async () => {
  const hospital = await createHospital("stay-edit-refusals");
  const { api, orgSlug } = hospital;
  const { admission } = await hospital.admit(0);
  const cashier = await hospital.member("cashier");

  await expectORPCCode(
    cashier.ipd.updateDetails({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      diagnosis: "Not the cashier's to write",
    }),
    "FORBIDDEN",
  );

  await api.ipd.updateDetails({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    diagnosis: "First edit",
  });

  await expectORPCCode(
    api.ipd.updateDetails({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      diagnosis: "From a stale screen",
    }),
    "CONFLICT",
    "a stale revision",
  );

  const departed = await hospital.depart(admission.id);

  await expectORPCCode(
    api.ipd.updateDetails({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: departed.revision,
      diagnosis: "After the Patient left",
    }),
    "CONFLICT",
    "a discharged stay",
  );

  expect((await hospital.detail(admission.id)).admission.diagnosis).toBe("First edit");
});

test("changing the consultant needs a reason and is audited", async () => {
  const hospital = await createHospital("stay-consultant");
  const other = await createHospital("stay-consultant-other");
  const { api, orgSlug, practitioner, secondPractitioner } = hospital;
  const { admission } = await hospital.admit(0);

  await expectORPCCode(
    api.ipd.updateDetails({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      practitionerId: secondPractitioner.id,
    }),
    "BAD_REQUEST",
    "a change without a reason",
  );

  await expectORPCCode(
    api.ipd.updateDetails({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      practitionerId: other.practitioner.id,
      reason: "Another hospital's doctor",
    }),
    "NOT_FOUND",
    "another organization's practitioner",
  );

  // Naming the same consultant is not a change, so it needs no reason.
  const same = await api.ipd.updateDetails({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    practitionerId: practitioner.id,
    diagnosis: "Appendicitis",
  });

  const changed = await api.ipd.updateDetails({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: same.revision,
    practitionerId: secondPractitioner.id,
    reason: "Referred to the surgeon",
  });

  expect(changed.practitionerId).toBe(secondPractitioner.id);

  const detail = await hospital.detail(admission.id);
  expect(detail.practitionerName).toBe(secondPractitioner.name);

  const entries = await hospital.auditEntries("ipd.consultant.change");

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    target: `admission:${admission.id}`,
    meta: {
      from: practitioner.id,
      to: secondPractitioner.id,
      reason: "Referred to the surgeon",
    },
  });
});

// ── How the Patient left ────────────────────────────────────────────────────

test("departure records how the Patient left, for every discharge type", async () => {
  const hospital = await createHospital("stay-discharge-type");

  for (const [index, dischargeType] of DISCHARGE_TYPES.entries()) {
    const { admission } = await hospital.admit(index);
    const discharged = await hospital.depart(admission.id, dischargeType);

    expect(discharged.status).toBe("discharged");
    expect(discharged.dischargeType).toBe(dischargeType);
    expect((await hospital.detail(admission.id)).admission.dischargeType).toBe(dischargeType);
  }
});

test("departure without a discharge type, or with an unknown one, is refused", async () => {
  const hospital = await createHospital("stay-discharge-type-required");
  const { api, orgSlug } = hospital;
  const { admission } = await hospital.admit(0);

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  await expectORPCCode(
    // @ts-expect-error dischargeType is required
    api.ipd.discharge({ orgSlug, admissionId: admission.id, expectedRevision: ready.revision }),
    "BAD_REQUEST",
    "no discharge type",
  );

  await expectORPCCode(
    api.ipd.discharge({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: ready.revision,
      // @ts-expect-error not a discharge type
      dischargeType: "transferred",
    }),
    "BAD_REQUEST",
    "an unknown discharge type",
  );

  expect((await hospital.detail(admission.id)).admission.status).toBe("discharge_ready");
});

test("the database ties the discharge type to the discharged state", async () => {
  const hospital = await createHospital("stay-discharge-type-check");
  const { orgId } = hospital;
  const { admission } = await hospital.admit(0);

  const onActive = await pgRejection(
    db
      .update(admissions)
      .set({ dischargeType: "normal" })
      .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admission.id))),
  );

  expect(onActive?.code).toBe("23514");

  await hospital.depart(admission.id, "referred");

  const cleared = await pgRejection(
    db
      .update(admissions)
      .set({ dischargeType: null })
      .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admission.id))),
  );

  expect(cleared?.code).toBe("23514");
});

// ── Undoing a discharge ─────────────────────────────────────────────────────

test("an administrator reopens a discharge recorded in error: same stay, same bed, cleaning block lifted", async () => {
  const hospital = await createHospital("stay-reopen");
  const { orgSlug, orgId, beds } = hospital;
  const admin = await hospital.member("admin");
  const { admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id, "against_advice");

  expect((await hospital.boardBed(beds[0]!.id)).status).toBe("blocked");
  const before = await stayRows(orgId, admission.id);

  const reopened = await admin.ipd.reopen({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: discharged.revision,
    reason: "Discharge was recorded on the wrong Patient",
  });

  expect(reopened).toMatchObject({
    status: "admitted",
    dischargedAt: null,
    dischargeType: null,
    readyAt: null,
    currentBedId: beds[0]!.id,
    revision: discharged.revision + 1,
    admissionNumber: admission.admissionNumber,
  });

  // The last segment is open again; no new segment was written.
  const after = await stayRows(orgId, admission.id);
  expect(after.map((stay) => stay.id)).toEqual(before.map((stay) => stay.id));
  expect(after.at(-1)!.endedAt).toBeNull();
  expect(after.at(-1)!.startedAt).toEqual(before.at(-1)!.startedAt);

  const bed = await hospital.boardBed(beds[0]!.id);
  expect(bed.status).toBe("occupied");
  expect(bed.blockedAt).toBeNull();
  expect(bed.admission?.id).toBe(admission.id);

  const [entry] = await hospital.auditEntries("ipd.reopen");
  expect(entry).toMatchObject({
    target: `admission:${admission.id}`,
    meta: { reason: "Discharge was recorded on the wrong Patient" },
  });

  // The reopened stay runs its ordinary lifecycle again.
  const again = await hospital.depart(admission.id, "normal");
  expect(again.status).toBe("discharged");
  expect(again.dischargeType).toBe("normal");
});

test("reopening is a correction: reception is refused, and a reason is required", async () => {
  const hospital = await createHospital("stay-reopen-grant");
  const { api, orgSlug } = hospital;
  const reception = await hospital.member("reception");
  const { admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id);

  await expectORPCCode(
    reception.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision,
      reason: "Reception tries",
    }),
    "FORBIDDEN",
  );

  await expectORPCCode(
    // @ts-expect-error reason is required
    api.ipd.reopen({ orgSlug, admissionId: admission.id, expectedRevision: discharged.revision }),
    "BAD_REQUEST",
  );

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision + 1,
      reason: "From a stale screen",
    }),
    "CONFLICT",
    "a stale revision",
  );

  expect((await hospital.detail(admission.id)).admission.status).toBe("discharged");
});

test("a discharge is reopened within 24 hours and not after", async () => {
  const hospital = await createHospital("stay-reopen-window");
  const { api, orgSlug } = hospital;

  const backdated = { reason: "Entered from the ward register" };

  const late = await hospital.admit(0, { admittedAt: hoursAgo(40), ...backdated });
  const lateDischarge = await hospital.depart(late.admission.id, "normal", hoursAgo(25));

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: late.admission.id,
      expectedRevision: lateDischarge.revision,
      reason: "More than a day later",
    }),
    "CONFLICT",
    "25 hours after departure",
  );

  expect((await hospital.detail(late.admission.id)).admission.status).toBe("discharged");

  const recent = await hospital.admit(1, { admittedAt: hoursAgo(40), ...backdated });
  const recentDischarge = await hospital.depart(recent.admission.id, "normal", hoursAgo(23));

  const reopened = await api.ipd.reopen({
    orgSlug,
    admissionId: recent.admission.id,
    expectedRevision: recentDischarge.revision,
    reason: "Within the day",
  });

  expect(reopened.status).toBe("admitted");
});

test("reopening is refused once the bed has another occupant", async () => {
  const hospital = await createHospital("stay-reopen-occupied");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id);

  await hospital.releaseBed(beds[0]!.id);
  const next = await hospital.admit(0);

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision,
      reason: "The bed is taken",
    }),
    "CONFLICT",
  );

  expect((await hospital.detail(admission.id)).admission).toMatchObject({
    status: "discharged",
    dischargeType: "normal",
    revision: discharged.revision,
  });
  expect((await hospital.boardBed(beds[0]!.id)).admission?.id).toBe(next.admission.id);
});

test("reopening is refused once another Patient used the bed, even after they left", async () => {
  const hospital = await createHospital("stay-reopen-used");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id);

  await hospital.releaseBed(beds[0]!.id);
  const next = await hospital.admit(0);
  await hospital.depart(next.admission.id);
  await hospital.releaseBed(beds[0]!.id);

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision,
      reason: "The bed was used since",
    }),
    "CONFLICT",
  );

  expect((await hospital.detail(admission.id)).admission.status).toBe("discharged");
});

test("reopening is refused while the bed is held for another Patient", async () => {
  const hospital = await createHospital("stay-reopen-held");
  const { api, orgSlug, beds, category } = hospital;
  const { admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id);

  await hospital.releaseBed(beds[0]!.id);

  const arriving = await hospital.registerPatient();

  const window = {
    plannedArrivalAt: new Date(Date.now() + 2 * HOUR),
    plannedDepartureAt: new Date(Date.now() + 50 * HOUR),
  };

  const holdUntil = new Date(Date.now() + 6 * HOUR);

  const requested = await api.ipd.requestBed({
    orgSlug,
    patientId: arriving.id,
    categoryId: category.id,
    ...window,
  });

  const held = await api.ipd.confirmBedReservation({
    orgSlug,
    reservationId: requested.id,
    expectedRevision: requested.revision,
    bedId: beds[0]!.id,
    holdUntil,
  });

  expect(held.status).toBe("confirmed");

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision,
      reason: "The bed is promised to someone else",
    }),
    "CONFLICT",
  );

  expect((await hospital.detail(admission.id)).admission.status).toBe("discharged");
});

test("reopening is refused when the bed was blocked for another reason or taken out of use", async () => {
  const hospital = await createHospital("stay-reopen-blocked");
  const { api, orgSlug, beds } = hospital;

  const first = await hospital.admit(0);
  const firstDischarge = await hospital.depart(first.admission.id);
  await hospital.releaseBed(beds[0]!.id);
  await api.ipd.blockBed({ orgSlug, bedId: beds[0]!.id, reason: "Broken side rail" });

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: first.admission.id,
      expectedRevision: firstDischarge.revision,
      reason: "The bed is under repair",
    }),
    "CONFLICT",
    "a bed blocked for repair",
  );

  expect((await hospital.boardBed(beds[0]!.id)).blockedReason).toBe("Broken side rail");

  const second = await hospital.admit(1);
  const secondDischarge = await hospital.depart(second.admission.id);
  await hospital.releaseBed(beds[1]!.id);
  await api.ipd.setBedActive({ orgSlug, bedId: beds[1]!.id, active: false });

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: second.admission.id,
      expectedRevision: secondDischarge.revision,
      reason: "The bed is out of use",
    }),
    "CONFLICT",
    "a bed taken out of use",
  );
});

test("reopening is refused when the Patient has since been admitted again", async () => {
  const hospital = await createHospital("stay-reopen-readmitted");
  const { api, orgSlug, beds, practitioner } = hospital;
  const { patient, admission } = await hospital.admit(0);
  const discharged = await hospital.depart(admission.id);

  await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    bedId: beds[1]!.id,
  });

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: discharged.revision,
      reason: "Already back in another bed",
    }),
    "CONFLICT",
  );

  expect((await hospital.detail(admission.id)).admission.status).toBe("discharged");
});

test("only a discharged Admission reopens: an active or cancelled one is refused", async () => {
  const hospital = await createHospital("stay-reopen-states");
  const { api, orgSlug } = hospital;

  const active = await hospital.admit(0);

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: active.admission.id,
      expectedRevision: active.admission.revision,
      reason: "Still admitted",
    }),
    "CONFLICT",
    "an admitted stay",
  );

  const mistaken = await hospital.admit(1);

  const cancelled = await api.ipd.cancel({
    orgSlug,
    admissionId: mistaken.admission.id,
    expectedRevision: mistaken.admission.revision,
    reason: "Admitted the wrong Patient",
  });

  await expectORPCCode(
    api.ipd.reopen({
      orgSlug,
      admissionId: mistaken.admission.id,
      expectedRevision: cancelled.revision,
      reason: "Cancelled stays stay cancelled",
    }),
    "CONFLICT",
    "a cancelled stay",
  );

  expect((await hospital.detail(mistaken.admission.id)).admission.status).toBe("cancelled");
});

test("reopening leaves issued Invoices alone, and what accrues afterwards goes on a further bill", async () => {
  const hospital = await createHospital("stay-reopen-billed");
  const { api, orgSlug, orgId, service } = hospital;
  const { admission } = await hospital.admit(0);

  const post = async () => {
    const { admission: current } = await hospital.detail(admission.id);

    return api.ipd.postServices({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: current.chargeRevision,
      lines: [{ catalogItemId: service.id, qty: 1 }],
    });
  };

  const bill = async () => {
    const preview = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });

    return api.ipd.issueInvoice({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: preview.chargeRevision,
      expectedGrandTotal: preview.pending.grandTotal,
      payments: [],
      outstandingReason: "Family settles at the desk",
    });
  };

  await post();
  const discharged = await hospital.depart(admission.id);
  const first = await bill();

  const [before] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, first.invoiceId)));

  await api.ipd.reopen({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: discharged.revision,
    reason: "Patient had not actually left",
  });

  const [after] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.id, first.invoiceId)));

  expect(after).toEqual(before);

  await post();
  await hospital.depart(admission.id);
  const second = await bill();

  expect(second.invoiceId).not.toBe(first.invoiceId);

  const preview = await api.ipd.previewInvoice({ orgSlug, admissionId: admission.id });

  expect(preview.issued.map((invoice) => invoice.invoiceId)).toEqual([
    first.invoiceId,
    second.invoiceId,
  ]);
  expect(preview.pending.lines).toEqual([]);

  // Each service sits on the bill that followed it.
  const services = await db
    .select({ invoiceId: charges.invoiceId, status: charges.status })
    .from(charges)
    .where(
      and(
        eq(charges.orgId, orgId),
        eq(charges.admissionId, admission.id),
        eq(charges.admissionKind, "service"),
      ),
    )
    .orderBy(asc(charges.createdAt), asc(charges.id));

  expect(services).toEqual([
    { invoiceId: first.invoiceId, status: "invoiced" },
    { invoiceId: second.invoiceId, status: "invoiced" },
  ]);
});

// ── Occupancy is a database rule ────────────────────────────────────────────

test("the database refuses overlapping stay intervals on one bed, closed or open", async () => {
  const hospital = await createHospital("stay-overlap-bed");
  const { orgId, beds } = hospital;
  const backdated = { reason: "Entered from the ward register" };

  // Bed G-1: the first Patient from 30h to 20h ago, the second from 10h to 5h ago.
  const first = await hospital.admit(0, { admittedAt: hoursAgo(30), ...backdated });
  await hospital.depart(first.admission.id, "normal", hoursAgo(20));
  await hospital.releaseBed(beds[0]!.id);

  const second = await hospital.admit(0, { admittedAt: hoursAgo(10), ...backdated });
  await hospital.depart(second.admission.id, "normal", hoursAgo(5));
  await hospital.releaseBed(beds[0]!.id);

  const [firstStay] = await stayRows(orgId, first.admission.id);
  const [secondStay] = await stayRows(orgId, second.admission.id);

  // A closed stay stretched back over another closed stay.
  const closed = await pgRejection(
    db
      .update(admissionBedStays)
      .set({ startedAt: hoursAgo(25) })
      .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.id, secondStay!.id))),
  );

  expect(closed).toEqual({ code: "23P01", constraint: "admission_bed_stays_bed_no_overlap" });

  // An open stay over a later closed one.
  const open = await pgRejection(
    db
      .update(admissionBedStays)
      .set({ endedAt: null })
      .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.id, firstStay!.id))),
  );

  expect(open).toEqual({ code: "23P01", constraint: "admission_bed_stays_bed_no_overlap" });

  // Back-to-back stays share an instant without overlapping.
  const touching = await pgRejection(
    db
      .update(admissionBedStays)
      .set({ startedAt: firstStay!.endedAt! })
      .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.id, secondStay!.id))),
  );

  expect(touching).toBeUndefined();
});

test("the database refuses overlapping stay intervals of one Admission", async () => {
  const hospital = await createHospital("stay-overlap-admission");
  const { api, orgSlug, orgId, beds } = hospital;
  const backdated = { reason: "Entered from the ward register" };

  const { admission } = await hospital.admit(0, { admittedAt: hoursAgo(12), ...backdated });

  await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[1]!.id,
    effectiveAt: hoursAgo(6),
    ...backdated,
  });

  const [, current] = await stayRows(orgId, admission.id);

  // The Patient cannot be in the second bed before leaving the first.
  const overlap = await pgRejection(
    db
      .update(admissionBedStays)
      .set({ startedAt: hoursAgo(9) })
      .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.id, current!.id))),
  );

  expect(overlap).toEqual({
    code: "23P01",
    constraint: "admission_bed_stays_admission_no_overlap",
  });

  // Two open stays for one Admission in different beds.
  const twoOpen = await pgRejection(
    db.execute(sql`
      update admission_bed_stays set ended_at = null
      where org_id = ${orgId} and admission_id = ${admission.id}
    `),
  );

  expect(twoOpen).toEqual({
    code: "23P01",
    constraint: "admission_bed_stays_admission_no_overlap",
  });
});

test("a backdated transfer into a bed another Patient occupied at that time is refused and changes nothing", async () => {
  const hospital = await createHospital("stay-overlap-transfer");
  const { api, orgSlug, orgId, beds } = hospital;
  const backdated = { reason: "Entered from the ward register" };

  const earlier = await hospital.admit(0, { admittedAt: hoursAgo(30), ...backdated });
  await hospital.depart(earlier.admission.id, "normal", hoursAgo(20));
  await hospital.releaseBed(beds[0]!.id);

  const { admission } = await hospital.admit(1, { admittedAt: hoursAgo(28), ...backdated });
  const before = await stayRows(orgId, admission.id);

  await expectORPCCode(
    api.ipd.transferBed({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      bedId: beds[0]!.id,
      effectiveAt: hoursAgo(24),
      ...backdated,
    }),
    "BAD_REQUEST",
  );

  expect(await stayRows(orgId, admission.id)).toEqual(before);
  expect((await hospital.detail(admission.id)).admission.revision).toBe(admission.revision);

  // After the earlier Patient left, the same move is fine.
  const moved = await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[0]!.id,
    effectiveAt: hoursAgo(19),
    ...backdated,
  });

  expect(moved.currentBedId).toBe(beds[0]!.id);
});

test("a cancelled Admission's stay never stands in the way of a backdated admission to that bed", async () => {
  const hospital = await createHospital("stay-overlap-cancelled");
  const { api, orgSlug, beds } = hospital;
  const backdated = { reason: "Entered from the ward register" };

  const mistaken = await hospital.admit(0, { admittedAt: hoursAgo(5), ...backdated });

  await api.ipd.cancel({
    orgSlug,
    admissionId: mistaken.admission.id,
    expectedRevision: mistaken.admission.revision,
    reason: "Admitted the wrong Patient",
  });

  // The right Patient really arrived three hours ago, while the mistaken stay was open.
  const { admission } = await hospital.admit(0, { admittedAt: hoursAgo(3), ...backdated });

  expect(admission.status).toBe("admitted");
  expect((await hospital.boardBed(beds[0]!.id)).admission?.id).toBe(admission.id);
});
