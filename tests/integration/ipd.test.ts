// Spec: docs/specs/ipd-admission-to-discharge.md, Slice 2 (facility, bed board, lifecycle).
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

const HOUR = 60 * 60 * 1_000;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR);
}

let phoneSequence = 5_560_000;

async function registerPatient(api: AppRouterClient, orgSlug: string, name: string) {
  phoneSequence += 1;

  return api.patient.register({
    orgSlug,
    name,
    phone: String(phoneSequence),
    sex: "other",
    dateOfBirth: "1980-01-01",
    dobEstimated: true,
    address: "",
  });
}

type Hospital = Awaited<ReturnType<typeof createHospital>>;

async function createHospital(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const orgSlug = organization.slug;
  const api = clientFor(owner);

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
    effectiveFrom: hoursAgo(24 * 30),
  });

  const bed = (label: string) =>
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label });

  const beds = [await bed("G-1"), await bed("G-2"), await bed("G-3")] as const;

  return {
    owner,
    organization,
    orgSlug,
    api,
    roomService,
    practitioner,
    ward,
    category,
    beds,
  };
}

async function member(
  hospital: Hospital,
  prefix: string,
  role: Parameters<typeof joinOrganization>[2],
) {
  const user: TestUser = await createTestUser(prefix);
  await joinOrganization(user, hospital.organization.id, role);

  return clientFor(user);
}

async function admit(hospital: Hospital, bedId: string, name: string, api = hospital.api) {
  const patient = await registerPatient(hospital.api, hospital.orgSlug, name);

  const admission = await api.ipd.admit({
    orgSlug: hospital.orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId,
  });

  return { patient, admission };
}

async function boardBed(hospital: Hospital, bedId: string, api = hospital.api) {
  const board = await api.ipd.bedBoard({ orgSlug: hospital.orgSlug });
  const bed = board.beds.find((candidate) => candidate.id === bedId);

  if (!bed) throw new Error(`bed ${bedId} missing from the board`);

  return bed;
}

async function auditEntries(hospital: Hospital, action: string) {
  await drainAuditWrites();
  const log = await hospital.api.audit.list({ orgSlug: hospital.orgSlug });

  return log.items.filter((entry) => entry.action === action);
}

async function settled<T>(promise: Promise<T>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    // SAFETY: oRPC client errors carry `code`; asserted by the callers.
    return { ok: false as const, code: (error as { code?: string }).code };
  }
}

// ── Facility ────────────────────────────────────────────────────────────────

test("the owner sets up wards, categories, tariffs and beds, and the board shows them available", async () => {
  const hospital = await createHospital("ipd-facility");
  const facility = await hospital.api.ipd.facility({ orgSlug: hospital.orgSlug });

  expect(facility.wards.map((ward) => ward.name)).toEqual(["General"]);
  expect(facility.categories.map((category) => category.name)).toEqual(["General bed"]);
  expect(facility.categories[0]!.currentTariff?.dailyPrice).toBe(1_000_00n);
  expect(facility.beds.map((bed) => bed.label).sort()).toEqual(["G-1", "G-2", "G-3"]);

  const bed = await boardBed(hospital, hospital.beds[0].id);
  expect(bed).toMatchObject({ label: "G-1", wardName: "General", status: "available" });
  expect(bed.admission).toBeNull();
});

test("a bed label is unique within its ward but may repeat in another ward", async () => {
  const hospital = await createHospital("ipd-bed-label");
  const { api, orgSlug, ward, category } = hospital;

  await expectORPCCode(
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label: "G-1" }),
    "CONFLICT",
  );

  const icu = await api.ipd.createWard({ orgSlug, name: "ICU" });

  const bed = await api.ipd.createBed({
    orgSlug,
    wardId: icu.id,
    categoryId: category.id,
    label: "G-1",
  });

  expect(bed.wardId).toBe(icu.id);
});

test("only owner and admin manage the facility; reception, cashier and pharmacist read the board", async () => {
  const hospital = await createHospital("ipd-facility-grants");
  const { orgSlug, ward, category, roomService, beds } = hospital;

  for (const role of ["reception", "cashier", "pharmacist", "accountant"] as const) {
    const api = await member(hospital, `ipd-facility-${role}`, role);

    await expectORPCCode(api.ipd.createWard({ orgSlug, name: `${role} ward` }), "FORBIDDEN", role);
    await expectORPCCode(
      api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label: role }),
      "FORBIDDEN",
      role,
    );
    await expectORPCCode(
      api.ipd.setBedTariff({
        orgSlug,
        categoryId: category.id,
        catalogItemId: roomService.id,
        dailyPrice: 1n,
        effectiveFrom: new Date(),
      }),
      "FORBIDDEN",
      role,
    );
    await expectORPCCode(
      api.ipd.setBedActive({ orgSlug, bedId: beds[0].id, active: false }),
      "FORBIDDEN",
      role,
    );
    const board = await api.ipd.bedBoard({ orgSlug });
    expect(board.beds).toHaveLength(3);
  }

  const admin = await member(hospital, "ipd-facility-admin", "admin");
  await admin.ipd.createWard({ orgSlug, name: "Admin ward" });

  const denials = await auditEntries(hospital, "rbac.permission");
  expect(denials.length).toBeGreaterThan(0);
});

test("facility references from another organization are NOT_FOUND", async () => {
  const hospital = await createHospital("ipd-facility-scope");
  const other = await createHospital("ipd-facility-other");
  const { api, orgSlug, category, ward } = hospital;

  await expectORPCCode(
    api.ipd.setBedTariff({
      orgSlug,
      categoryId: category.id,
      catalogItemId: other.roomService.id,
      dailyPrice: 500_00n,
      effectiveFrom: new Date(),
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.ipd.createBed({ orgSlug, wardId: other.ward.id, categoryId: category.id, label: "X-1" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: other.category.id, label: "X-1" }),
    "NOT_FOUND",
  );
});

test("tariff changes are audited and apply only to new occupancy segments", async () => {
  const hospital = await createHospital("ipd-tariff");
  const { api, orgSlug, beds, category, roomService } = hospital;

  const { admission } = await admit(hospital, beds[0].id, "Tariff Patient");

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: category.id,
    catalogItemId: roomService.id,
    dailyPrice: 1_500_00n,
    effectiveFrom: new Date(),
  });

  const before = await api.ipd.get({ orgSlug, admissionId: admission.id });
  expect(before.stays).toHaveLength(1);
  expect(before.stays[0]!.dailyPrice).toBe(1_000_00n);

  await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: before.admission.revision,
    bedId: beds[1].id,
  });

  const after = await api.ipd.get({ orgSlug, admissionId: admission.id });
  expect(after.stays.map((stay) => stay.dailyPrice)).toEqual([1_000_00n, 1_500_00n]);

  const entries = await auditEntries(hospital, "ipd.tariff.set");
  expect(entries.length).toBe(2);
});

test("a bed without a current tariff cannot take an admission", async () => {
  const hospital = await createHospital("ipd-no-tariff");
  const { api, orgSlug, ward } = hospital;
  const unpriced = await api.ipd.createBedCategory({ orgSlug, name: "Unpriced" });

  const bed = await api.ipd.createBed({
    orgSlug,
    wardId: ward.id,
    categoryId: unpriced.id,
    label: "U-1",
  });

  const patient = await registerPatient(api, orgSlug, "No Tariff Patient");
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: hospital.practitioner.id,
      bedId: bed.id,
    }),
    "CONFLICT",
  );

  // A rate that starts later does not price a bed taken now.
  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: unpriced.id,
    catalogItemId: hospital.roomService.id,
    dailyPrice: 900_00n,
    effectiveFrom: new Date(Date.now() + 24 * HOUR),
  });

  expect((await boardBed(hospital, bed.id)).rateSet).toBe(false);
  expect((await boardBed(hospital, hospital.beds[0].id)).rateSet).toBe(true);
});

test("facility setup and releasing a bed are audited after they commit", async () => {
  const hospital = await createHospital("ipd-facility-audit");
  const { api, orgSlug, ward, category, beds } = hospital;

  const [wardEntry] = await auditEntries(hospital, "ipd.ward.create");
  expect(wardEntry).toMatchObject({ target: `ward:${ward.id}`, meta: { name: "General" } });

  const [categoryEntry] = await auditEntries(hospital, "ipd.bedCategory.create");
  expect(categoryEntry).toMatchObject({
    target: `bed_category:${category.id}`,
    meta: { name: "General bed" },
  });

  const bedEntries = await auditEntries(hospital, "ipd.bed.create");
  expect(bedEntries.map((entry) => entry.target).sort()).toEqual(
    beds.map((bed) => `bed:${bed.id}`).sort(),
  );
  expect(bedEntries.find((entry) => entry.target === `bed:${beds[0].id}`)?.meta).toMatchObject({
    label: "G-1",
    wardId: ward.id,
    categoryId: category.id,
  });

  const blocked = await api.ipd.blockBed({ orgSlug, bedId: beds[0].id, reason: "Deep clean" });
  await api.ipd.releaseBed({ orgSlug, bedId: beds[0].id, expectedBlockedAt: blocked.blockedAt! });

  const releases = await auditEntries(hospital, "ipd.bed.release");
  expect(releases).toHaveLength(1);
  expect(releases[0]).toMatchObject({
    target: `bed:${beds[0].id}`,
    meta: { blockedAt: blocked.blockedAt!.toISOString(), blockedReason: "Deep clean" },
  });
});

test("an inactive or blocked bed refuses admission, and an occupied bed cannot be deactivated", async () => {
  const hospital = await createHospital("ipd-bed-config");
  const { api, orgSlug, beds } = hospital;

  await api.ipd.setBedActive({ orgSlug, bedId: beds[0].id, active: false });
  await api.ipd.blockBed({ orgSlug, bedId: beds[1].id, reason: "Mattress being replaced" });

  const patient = await registerPatient(api, orgSlug, "Config Patient");
  const base = { orgSlug, patientId: patient.id, practitionerId: hospital.practitioner.id };

  await expectORPCCode(api.ipd.admit({ ...base, bedId: beds[0].id }), "CONFLICT", "inactive");
  await expectORPCCode(api.ipd.admit({ ...base, bedId: beds[1].id }), "CONFLICT", "blocked");
  expect((await boardBed(hospital, beds[1].id)).status).toBe("blocked");

  await api.ipd.admit({ ...base, bedId: beds[2].id });
  await expectORPCCode(
    api.ipd.setBedActive({ orgSlug, bedId: beds[2].id, active: false }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.ipd.blockBed({ orgSlug, bedId: beds[2].id, reason: "occupied" }),
    "CONFLICT",
  );

  const board = await api.ipd.bedBoard({ orgSlug });
  expect(board.beds.some((bed) => bed.id === beds[0].id)).toBe(false);

  expect((await auditEntries(hospital, "ipd.bed.block")).length).toBe(1);
});

// ── Admission ───────────────────────────────────────────────────────────────

test("reception admits a Patient and the board shows the occupant", async () => {
  const hospital = await createHospital("ipd-admit");
  const reception = await member(hospital, "ipd-admit-reception", "reception");

  const { patient, admission } = await admit(
    hospital,
    hospital.beds[0].id,
    "Admit Patient",
    reception,
  );

  expect(admission).toMatchObject({
    status: "admitted",
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    currentBedId: hospital.beds[0].id,
  });
  expect(typeof admission.revision).toBe("number");

  const bed = await boardBed(hospital, hospital.beds[0].id, reception);
  expect(bed.status).toBe("occupied");
  expect(bed.admission).toMatchObject({
    id: admission.id,
    patientName: "admit patient",
    status: "admitted",
  });

  const current = await reception.ipd.list({ orgSlug: hospital.orgSlug });
  expect(current.items.map((item) => item.id)).toContain(admission.id);
});

test("one occupant per bed and one active Admission per Patient", async () => {
  const hospital = await createHospital("ipd-uniqueness");
  const { api, orgSlug, beds, practitioner } = hospital;

  const { patient } = await admit(hospital, beds[0].id, "First Occupant");
  const other = await registerPatient(api, orgSlug, "Second Occupant");

  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: other.id,
      practitionerId: practitioner.id,
      bedId: beds[0].id,
    }),
    "CONFLICT",
    "occupied bed",
  );
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[1].id,
    }),
    "CONFLICT",
    "patient already admitted",
  );
});

test("two terminals admitting into one bed: exactly one wins, the other gets CONFLICT", async () => {
  const hospital = await createHospital("ipd-race-bed");
  const { api, orgSlug, beds, practitioner } = hospital;
  const first = await registerPatient(api, orgSlug, "Race One");
  const second = await registerPatient(api, orgSlug, "Race Two");

  const results = await Promise.all(
    [first, second].map((patient) =>
      settled(
        api.ipd.admit({
          orgSlug,
          patientId: patient.id,
          practitionerId: practitioner.id,
          bedId: beds[0].id,
        }),
      ),
    ),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok).map((result) => !result.ok && result.code)).toEqual(
    ["CONFLICT"],
  );
});

test("two terminals admitting one Patient into different beds: exactly one wins", async () => {
  const hospital = await createHospital("ipd-race-patient");
  const { api, orgSlug, beds, practitioner } = hospital;
  const patient = await registerPatient(api, orgSlug, "Race Patient");

  const results = await Promise.all(
    [beds[0], beds[1]].map((bed) =>
      settled(
        api.ipd.admit({
          orgSlug,
          patientId: patient.id,
          practitionerId: practitioner.id,
          bedId: bed.id,
        }),
      ),
    ),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });
});

test("admission references from another organization are NOT_FOUND", async () => {
  const hospital = await createHospital("ipd-admit-scope");
  const other = await createHospital("ipd-admit-scope-other");
  const { api, orgSlug, beds, practitioner } = hospital;
  const patient = await registerPatient(api, orgSlug, "Scope Patient");
  const foreignPatient = await registerPatient(other.api, other.orgSlug, "Foreign Patient");

  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: foreignPatient.id,
      practitionerId: practitioner.id,
      bedId: beds[0].id,
    }),
    "NOT_FOUND",
    "patient",
  );
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: other.practitioner.id,
      bedId: beds[0].id,
    }),
    "NOT_FOUND",
    "practitioner",
  );
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: other.beds[0].id,
    }),
    "NOT_FOUND",
    "bed",
  );
});

test("an Admission is invisible from another organization", async () => {
  const hospital = await createHospital("ipd-invisible");
  const other = await createHospital("ipd-invisible-other");
  const { admission } = await admit(hospital, hospital.beds[0].id, "Invisible Patient");

  await expectORPCCode(
    other.api.ipd.get({ orgSlug: other.orgSlug, admissionId: admission.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    other.api.ipd.transferBed({
      orgSlug: other.orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      bedId: other.beds[0].id,
    }),
    "CONFLICT",
  );

  const board = await other.api.ipd.bedBoard({ orgSlug: other.orgSlug });
  expect(board.beds.every((bed) => bed.admission?.id !== admission.id)).toBe(true);
  expect(board.beds.some((bed) => bed.id === hospital.beds[0].id)).toBe(false);

  const list = await other.api.ipd.list({ orgSlug: other.orgSlug });
  expect(list.items.map((item) => item.id)).not.toContain(admission.id);
});

test("cashier, accountant and pharmacist read Admissions but cannot admit, move or discharge", async () => {
  const hospital = await createHospital("ipd-read-only");
  const { orgSlug, beds, practitioner } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Read Only Patient");
  const patient = await registerPatient(hospital.api, orgSlug, "Denied Patient");

  for (const role of ["cashier", "accountant", "pharmacist"] as const) {
    const api = await member(hospital, `ipd-read-${role}`, role);

    expect((await api.ipd.get({ orgSlug, admissionId: admission.id })).admission.id).toBe(
      admission.id,
    );
    await expectORPCCode(
      api.ipd.admit({
        orgSlug,
        patientId: patient.id,
        practitionerId: practitioner.id,
        bedId: beds[1].id,
      }),
      "FORBIDDEN",
      role,
    );
    await expectORPCCode(
      api.ipd.transferBed({
        orgSlug,
        admissionId: admission.id,
        expectedRevision: admission.revision,
        bedId: beds[1].id,
      }),
      "FORBIDDEN",
      role,
    );
    await expectORPCCode(
      api.ipd.markDischargeReady({
        orgSlug,
        admissionId: admission.id,
        expectedRevision: admission.revision,
      }),
      "FORBIDDEN",
      role,
    );
  }
});

test("an admission time in the future is rejected", async () => {
  const hospital = await createHospital("ipd-future");
  const patient = await registerPatient(hospital.api, hospital.orgSlug, "Future Patient");

  await expectORPCCode(
    hospital.api.ipd.admit({
      orgSlug: hospital.orgSlug,
      patientId: patient.id,
      practitionerId: hospital.practitioner.id,
      bedId: hospital.beds[0].id,
      admittedAt: new Date(Date.now() + HOUR),
    }),
    "BAD_REQUEST",
  );
});

test("backdating needs the correction grant and a reason, and is audited", async () => {
  const hospital = await createHospital("ipd-backdate");
  const { orgSlug, beds, practitioner } = hospital;
  const reception = await member(hospital, "ipd-backdate-reception", "reception");
  const patient = await registerPatient(hospital.api, orgSlug, "Backdated Patient");

  const base = {
    orgSlug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    bedId: beds[0].id,
  };

  const admittedAt = hoursAgo(3);

  await expectORPCCode(
    reception.ipd.admit({ ...base, admittedAt, reason: "Night entry" }),
    "FORBIDDEN",
  );
  await expectORPCCode(hospital.api.ipd.admit({ ...base, admittedAt }), "BAD_REQUEST");

  const admission = await hospital.api.ipd.admit({
    ...base,
    admittedAt,
    reason: "Entered after the night shift",
  });

  expect(new Date(admission.admittedAt).getTime()).toBe(admittedAt.getTime());

  const entries = await auditEntries(hospital, "ipd.admit.backdate");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.target).toBe(`admission:${admission.id}`);
});

test("a recent admission time within the desk's tolerance is not backdating", async () => {
  const hospital = await createHospital("ipd-recent");
  const reception = await member(hospital, "ipd-recent-reception", "reception");
  const patient = await registerPatient(hospital.api, hospital.orgSlug, "Recent Patient");

  const admission = await reception.ipd.admit({
    orgSlug: hospital.orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: hospital.beds[0].id,
    admittedAt: new Date(Date.now() - 5 * 60 * 1_000),
  });

  expect(admission.status).toBe("admitted");
});

test("backdated occupancy cannot overlap a bed's historical occupant", async () => {
  const hospital = await createHospital("ipd-history-overlap");
  const { api, orgSlug, beds, practitioner } = hospital;

  const { admission } = await admit(hospital, beds[0].id, "Earlier Occupant");
  await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[1].id,
  });

  const late = await registerPatient(api, orgSlug, "Late Entry");
  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: late.id,
      practitionerId: practitioner.id,
      bedId: beds[0].id,
      admittedAt: hoursAgo(2),
      reason: "Paper register entry",
    }),
    // The typed time is wrong, not the screen: the dialog stays open to correct it.
    "BAD_REQUEST",
  );
});

// ── Transfer ────────────────────────────────────────────────────────────────

test("a transfer closes the old stay and opens the new one at the same instant", async () => {
  const hospital = await createHospital("ipd-transfer");
  const { api, orgSlug, beds } = hospital;
  const reception = await member(hospital, "ipd-transfer-reception", "reception");
  const { admission } = await admit(hospital, beds[0].id, "Transfer Patient", reception);

  const moved = await reception.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[1].id,
  });

  expect(moved.currentBedId).toBe(beds[1].id);
  expect(moved.status).toBe("admitted");
  expect(moved.revision).toBeGreaterThan(admission.revision);

  const detail = await api.ipd.get({ orgSlug, admissionId: admission.id });
  expect(detail.stays.map((stay) => stay.bedId)).toEqual([beds[0].id, beds[1].id]);
  expect(detail.stays[0]!.endedAt).not.toBeNull();
  expect(new Date(detail.stays[0]!.endedAt!).getTime()).toBe(
    new Date(detail.stays[1]!.startedAt).getTime(),
  );
  expect(detail.stays[1]!.endedAt).toBeNull();

  expect((await boardBed(hospital, beds[0].id)).status).toBe("available");
  expect((await boardBed(hospital, beds[1].id)).admission?.id).toBe(admission.id);
});

test("a stale terminal's transfer is refused with CONFLICT", async () => {
  const hospital = await createHospital("ipd-transfer-stale");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Stale Patient");

  await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[1].id,
  });
  await expectORPCCode(
    api.ipd.transferBed({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      bedId: beds[2].id,
    }),
    "CONFLICT",
  );
});

test("transfers into an occupied, blocked, inactive or the same bed are refused", async () => {
  const hospital = await createHospital("ipd-transfer-dest");
  const { api, orgSlug, beds, ward, category } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Mover");
  await admit(hospital, beds[1].id, "Occupant");
  await api.ipd.blockBed({ orgSlug, bedId: beds[2].id, reason: "Cleaning" });

  const spare = await api.ipd.createBed({
    orgSlug,
    wardId: ward.id,
    categoryId: category.id,
    label: "G-4",
  });

  await api.ipd.setBedActive({ orgSlug, bedId: spare.id, active: false });

  const move = (bedId: string) =>
    api.ipd.transferBed({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      bedId,
    });

  await expectORPCCode(move(beds[1].id), "CONFLICT", "occupied");
  await expectORPCCode(move(beds[2].id), "CONFLICT", "blocked");
  await expectORPCCode(move(spare.id), "CONFLICT", "inactive");
  await expectORPCCode(move(beds[0].id), "CONFLICT", "same bed");
});

test("two transfers racing for one free bed: exactly one wins", async () => {
  const hospital = await createHospital("ipd-transfer-race");
  const { api, orgSlug, beds } = hospital;
  const one = await admit(hospital, beds[0].id, "Racer One");
  const two = await admit(hospital, beds[1].id, "Racer Two");

  const results = await Promise.all(
    [one.admission, two.admission].map((admission) =>
      settled(
        api.ipd.transferBed({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          bedId: beds[2].id,
        }),
      ),
    ),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });
});

test("a transfer cannot take effect before the current stay began", async () => {
  const hospital = await createHospital("ipd-transfer-before");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Early Mover");

  await expectORPCCode(
    api.ipd.transferBed({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      bedId: beds[1].id,
      effectiveAt: hoursAgo(5),
      reason: "Moved before admission?",
    }),
    "BAD_REQUEST",
  );
});

// ── Discharge lifecycle ─────────────────────────────────────────────────────

test("ready keeps the bed occupied; discharge closes the stay and blocks the bed until released", async () => {
  const hospital = await createHospital("ipd-discharge");
  const { orgSlug, beds } = hospital;
  const reception = await member(hospital, "ipd-discharge-reception", "reception");
  const { patient, admission } = await admit(hospital, beds[0].id, "Discharge Patient", reception);

  const ready = await reception.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  expect(ready.status).toBe("discharge_ready");
  expect(ready.readyAt).not.toBeNull();
  const readyBed = await boardBed(hospital, beds[0].id);
  expect(readyBed.status).toBe("occupied");
  expect(readyBed.admission?.status).toBe("discharge_ready");

  const discharged = await reception.ipd.discharge({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.revision,
  });

  expect(discharged.status).toBe("discharged");
  expect(discharged.dischargedAt).not.toBeNull();
  expect(discharged.currentBedId).toBeNull();

  const detail = await reception.ipd.get({ orgSlug, admissionId: admission.id });
  expect(detail.stays.every((stay) => stay.endedAt !== null)).toBe(true);
  expect((await boardBed(hospital, beds[0].id)).status).toBe("blocked");

  const current = await reception.ipd.list({ orgSlug });
  expect(current.items.map((item) => item.id)).not.toContain(admission.id);

  const blocked = await boardBed(hospital, beds[0].id);
  await reception.ipd.releaseBed({
    orgSlug,
    bedId: beds[0].id,
    expectedBlockedAt: blocked.blockedAt!,
  });
  expect((await boardBed(hospital, beds[0].id)).status).toBe("available");

  // The Patient may be admitted again once the earlier stay has ended.
  const again = await reception.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: beds[1].id,
  });

  expect(again.status).toBe("admitted");
});

test("discharge requires the ready handoff first", async () => {
  const hospital = await createHospital("ipd-discharge-order");
  const { admission } = await admit(hospital, hospital.beds[0].id, "Hasty Patient");

  await expectORPCCode(
    hospital.api.ipd.discharge({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
    }),
    "CONFLICT",
  );
});

test("returning a ready Admission to admitted needs a reason and is audited", async () => {
  const hospital = await createHospital("ipd-undo-ready");
  const { api, orgSlug } = hospital;
  const { admission } = await admit(hospital, hospital.beds[0].id, "Undo Patient");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  const back = await api.ipd.undoDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.revision,
    reason: "Fever overnight; consultant postponed discharge",
  });

  expect(back.status).toBe("admitted");
  expect(back.readyAt).toBeNull();

  await expectORPCCode(
    api.ipd.undoDischargeReady({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: back.revision,
      reason: "Not ready any more",
    }),
    "CONFLICT",
  );

  const entries = await auditEntries(hospital, "ipd.discharge_ready.undo");
  expect(entries).toHaveLength(1);
});

test("a transfer is allowed while ready, because the Patient still occupies a bed", async () => {
  const hospital = await createHospital("ipd-ready-transfer");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Ready Mover");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  const moved = await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.revision,
    bedId: beds[1].id,
  });

  expect(moved).toMatchObject({ status: "discharge_ready", currentBedId: beds[1].id });
});

test("a stale terminal cannot discharge", async () => {
  const hospital = await createHospital("ipd-discharge-stale");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Stale Discharge");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.revision,
    bedId: beds[1].id,
  });

  await expectORPCCode(
    api.ipd.discharge({ orgSlug, admissionId: admission.id, expectedRevision: ready.revision }),
    "CONFLICT",
  );
});

test("discharge cannot be dated before the current stay began, nor backdated without the grant", async () => {
  const hospital = await createHospital("ipd-discharge-time");
  const { orgSlug, beds } = hospital;
  const reception = await member(hospital, "ipd-discharge-time-reception", "reception");
  const { admission } = await admit(hospital, beds[0].id, "Timed Discharge", reception);

  const ready = await reception.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  await expectORPCCode(
    reception.ipd.discharge({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: ready.revision,
      effectiveAt: hoursAgo(1),
      reason: "Left earlier",
    }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    hospital.api.ipd.discharge({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: ready.revision,
      effectiveAt: hoursAgo(4),
      reason: "Left earlier",
    }),
    "BAD_REQUEST",
  );
  await expectORPCCode(
    hospital.api.ipd.discharge({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: ready.revision,
      effectiveAt: new Date(Date.now() + HOUR),
    }),
    "BAD_REQUEST",
  );
});

test("terminal Admissions never reopen", async () => {
  const hospital = await createHospital("ipd-terminal");
  const { api, orgSlug, beds } = hospital;
  const { admission } = await admit(hospital, beds[0].id, "Terminal Patient");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  const discharged = await api.ipd.discharge({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: ready.revision,
  });

  const expectedRevision = discharged.revision;

  await expectORPCCode(
    api.ipd.discharge({ orgSlug, admissionId: admission.id, expectedRevision }),
    "CONFLICT",
    "discharge",
  );
  await expectORPCCode(
    api.ipd.markDischargeReady({ orgSlug, admissionId: admission.id, expectedRevision }),
    "CONFLICT",
    "ready",
  );
  await expectORPCCode(
    api.ipd.undoDischargeReady({
      orgSlug,
      admissionId: admission.id,
      expectedRevision,
      reason: "Reopen",
    }),
    "CONFLICT",
    "undo",
  );
  await expectORPCCode(
    api.ipd.cancel({ orgSlug, admissionId: admission.id, expectedRevision, reason: "Oops" }),
    "CONFLICT",
    "cancel",
  );
  await expectORPCCode(
    api.ipd.transferBed({
      orgSlug,
      admissionId: admission.id,
      expectedRevision,
      bedId: beds[1].id,
    }),
    "CONFLICT",
    "transfer",
  );
});

test("cancelling an erroneous Admission frees the bed at once and is audited with its reason", async () => {
  const hospital = await createHospital("ipd-cancel");
  const { api, orgSlug, beds } = hospital;
  const { patient, admission } = await admit(hospital, beds[0].id, "Wrong Patient");

  const cancelled = await api.ipd.cancel({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    reason: "Admitted the wrong Patient",
  });

  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.currentBedId).toBeNull();
  expect((await boardBed(hospital, beds[0].id)).status).toBe("available");

  const entries = await auditEntries(hospital, "ipd.cancel");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.meta).toMatchObject({ reason: "Admitted the wrong Patient" });

  const again = await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: beds[0].id,
  });

  expect(again.status).toBe("admitted");
});

test("reception cannot cancel; cancellation is a correction", async () => {
  const hospital = await createHospital("ipd-cancel-grant");
  const reception = await member(hospital, "ipd-cancel-reception", "reception");
  const { admission } = await admit(hospital, hospital.beds[0].id, "Kept Patient", reception);

  await expectORPCCode(
    reception.ipd.cancel({
      orgSlug: hospital.orgSlug,
      admissionId: admission.id,
      expectedRevision: admission.revision,
      reason: "Mistake",
    }),
    "FORBIDDEN",
  );
});

test("releasing an occupied bed is refused", async () => {
  const hospital = await createHospital("ipd-release-occupied");
  await admit(hospital, hospital.beds[0].id, "Still Here");

  await expectORPCCode(
    hospital.api.ipd.releaseBed({
      orgSlug: hospital.orgSlug,
      bedId: hospital.beds[0].id,
      expectedBlockedAt: new Date(),
    }),
    "CONFLICT",
  );
});

test("the Admission list pages with the shared page size and filters by state", async () => {
  const hospital = await createHospital("ipd-list");
  const { api, orgSlug, beds } = hospital;
  const one = await admit(hospital, beds[0].id, "List One");
  const two = await admit(hospital, beds[1].id, "List Two");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: two.admission.id,
    expectedRevision: two.admission.revision,
  });

  await api.ipd.discharge({
    orgSlug,
    admissionId: two.admission.id,
    expectedRevision: ready.revision,
  });

  const current = await api.ipd.list({ orgSlug, state: "current" });
  expect(current.items.map((item) => item.id)).toEqual([one.admission.id]);
  expect(current.items[0]).toMatchObject({
    patientName: "list one",
    bedLabel: "G-1",
    wardName: "General",
  });

  const past = await api.ipd.list({ orgSlug, state: "past" });
  expect(past.items.map((item) => item.id)).toEqual([two.admission.id]);

  const firstPage = await api.ipd.list({ orgSlug, state: "all", limit: 1 });
  expect(firstPage.items).toHaveLength(1);
  expect(firstPage.nextCursor).not.toBeNull();

  const secondPage = await api.ipd.list({
    orgSlug,
    state: "all",
    limit: 1,
    cursor: firstPage.nextCursor!,
  });

  expect(secondPage.items).toHaveLength(1);
  expect(secondPage.items[0]!.id).not.toBe(firstPage.items[0]!.id);
});

// ── Council review findings ─────────────────────────────────────────────────

test("a backdated admission cannot overlap the same Patient's earlier stay", async () => {
  const hospital = await createHospital("ipd-patient-overlap");
  const { api, orgSlug, beds, practitioner } = hospital;
  const { patient, admission } = await admit(hospital, beds[0].id, "Overlap Patient");

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
  });

  await api.ipd.discharge({ orgSlug, admissionId: admission.id, expectedRevision: ready.revision });

  await expectORPCCode(
    api.ipd.admit({
      orgSlug,
      patientId: patient.id,
      practitionerId: practitioner.id,
      bedId: beds[1].id,
      admittedAt: hoursAgo(2),
      reason: "Paper register entry",
    }),
    "BAD_REQUEST",
  );
});

test("departure cannot be dated before the ready handoff", async () => {
  const hospital = await createHospital("ipd-before-ready");
  const { api, orgSlug, beds } = hospital;
  const patient = await registerPatient(api, orgSlug, "Before Ready");

  const admission = await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: beds[0].id,
    admittedAt: hoursAgo(6),
    reason: "Night entry",
  });

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    effectiveAt: hoursAgo(2),
    reason: "Handoff recorded late",
  });

  await expectORPCCode(
    api.ipd.discharge({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: ready.revision,
      effectiveAt: hoursAgo(4),
      reason: "Left earlier",
    }),
    "BAD_REQUEST",
  );
});

test("the ready handoff cannot be dated before the current bed", async () => {
  const hospital = await createHospital("ipd-ready-before-bed");
  const { api, orgSlug, beds } = hospital;
  const patient = await registerPatient(api, orgSlug, "Ready Before Bed");

  const admission = await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: beds[0].id,
    admittedAt: hoursAgo(6),
    reason: "Night entry",
  });

  const moved = await api.ipd.transferBed({
    orgSlug,
    admissionId: admission.id,
    expectedRevision: admission.revision,
    bedId: beds[1].id,
    effectiveAt: hoursAgo(2),
    reason: "Moved overnight",
  });

  await expectORPCCode(
    api.ipd.markDischargeReady({
      orgSlug,
      admissionId: admission.id,
      expectedRevision: moved.revision,
      effectiveAt: hoursAgo(4),
      reason: "Handoff recorded late",
    }),
    "BAD_REQUEST",
  );
});

test("a stale release cannot clear a newer block on the same bed", async () => {
  const hospital = await createHospital("ipd-stale-release");
  const { api, orgSlug, beds } = hospital;
  await api.ipd.blockBed({ orgSlug, bedId: beds[0].id, reason: "Repairs" });
  const stale = await boardBed(hospital, beds[0].id);
  await api.ipd.releaseBed({ orgSlug, bedId: beds[0].id, expectedBlockedAt: stale.blockedAt! });
  await api.ipd.blockBed({ orgSlug, bedId: beds[0].id, reason: "Deep clean" });

  await expectORPCCode(
    api.ipd.releaseBed({ orgSlug, bedId: beds[0].id, expectedBlockedAt: stale.blockedAt! }),
    "CONFLICT",
  );
  expect((await boardBed(hospital, beds[0].id)).blockedReason).toBe("Deep clean");
});

test("admissions list newest admission time first, even when one was backdated", async () => {
  const hospital = await createHospital("ipd-list-order");
  const { api, orgSlug, beds, practitioner } = hospital;
  const recent = await admit(hospital, beds[0].id, "Recent Arrival");
  const patient = await registerPatient(api, orgSlug, "Earlier Arrival");

  const earlier = await api.ipd.admit({
    orgSlug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    bedId: beds[1].id,
    admittedAt: hoursAgo(5),
    reason: "Paper register entry",
  });

  const list = await api.ipd.list({ orgSlug, state: "current" });
  expect(list.items.map((item) => item.id)).toEqual([recent.admission.id, earlier.id]);
});

test("one bed type cannot have two rates starting at the same instant", async () => {
  const hospital = await createHospital("ipd-tariff-instant");
  const { api, orgSlug, category, roomService } = hospital;

  const rate = {
    orgSlug,
    categoryId: category.id,
    catalogItemId: roomService.id,
    effectiveFrom: new Date(Date.now() + HOUR),
  };

  await api.ipd.setBedTariff({ ...rate, dailyPrice: 1_200_00n });
  await expectORPCCode(api.ipd.setBedTariff({ ...rate, dailyPrice: 1_300_00n }), "CONFLICT");
});
