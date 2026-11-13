// Spec: docs/specs/facility-booking-and-theatre.md, "Theatre, rooms and equipment" item 1.
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { surgicalCases } from "@hms/db/schema/theatre";
import { and, eq } from "drizzle-orm";

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

type Hospital = Awaited<ReturnType<typeof createHospital>>;

async function createHospital(seed: string) {
  const owner = await createTestUser(`${seed}-owner`);
  const organization = await createOrganization(owner, seed);
  const orgSlug = organization.slug;
  const api = clientFor(owner);

  return { owner, organization, orgSlug, api };
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

async function auditEntries(hospital: Hospital, action: string) {
  await drainAuditWrites();
  const log = await hospital.api.audit.list({ orgSlug: hospital.orgSlug, limit: 100 });

  return log.items.filter((entry) => entry.action === action);
}

async function resources(hospital: Hospital, api: AppRouterClient = hospital.api) {
  return api.theatre.resources({ orgSlug: hospital.orgSlug });
}

// ── Slice 1: permissions and resources ──────────────────────────────────────

test("an owner creates rooms and equipment units, and resources lists them", async () => {
  const hospital = await createHospital("ot-resources");
  const { api, orgSlug } = hospital;

  const room = await api.theatre.createRoom({
    orgSlug,
    name: "Theatre 1",
    kind: "operating_theatre",
  });

  const minor = await api.theatre.createRoom({ orgSlug, name: "Minor OT", kind: "procedure_room" });
  const carm = await api.theatre.createEquipment({ orgSlug, name: "C-arm #1", kind: "C-arm" });

  expect(room).toMatchObject({ name: "Theatre 1", kind: "operating_theatre", active: true });
  expect(carm).toMatchObject({ name: "C-arm #1", kind: "C-arm", active: true });

  const listed = await resources(hospital);

  expect(listed.rooms.map((entry) => [entry.id, entry.name, entry.kind, entry.active])).toEqual([
    [minor.id, "Minor OT", "procedure_room", true],
    [room.id, "Theatre 1", "operating_theatre", true],
  ]);
  expect(listed.equipment.map((entry) => [entry.id, entry.name, entry.kind, entry.active])).toEqual(
    [[carm.id, "C-arm #1", "C-arm", true]],
  );
  expect(listed.blocks).toEqual([]);

  expect((await auditEntries(hospital, "theatre.room.create")).map((e) => e.target)).toEqual([
    `theatre_room:${minor.id}`,
    `theatre_room:${room.id}`,
  ]);
  expect((await auditEntries(hospital, "theatre.equipment.create")).map((e) => e.target)).toEqual([
    `equipment_unit:${carm.id}`,
  ]);
});

test("duplicate room or unit names are CONFLICT, ignoring case, but another hospital may reuse them", async () => {
  const hospital = await createHospital("ot-duplicates");
  const other = await createHospital("ot-duplicates-other");
  const { api, orgSlug } = hospital;

  await api.theatre.createRoom({ orgSlug, name: "Theatre 1", kind: "operating_theatre" });
  await api.theatre.createEquipment({ orgSlug, name: "C-arm #1", kind: "C-arm" });

  await expectORPCCode(
    api.theatre.createRoom({ orgSlug, name: "theatre 1", kind: "procedure_room" }),
    "CONFLICT",
    "room",
  );
  await expectORPCCode(
    api.theatre.createEquipment({ orgSlug, name: "C-ARM #1", kind: "C-arm" }),
    "CONFLICT",
    "unit",
  );

  const listed = await resources(hospital);
  expect(listed.rooms).toHaveLength(1);
  expect(listed.equipment).toHaveLength(1);

  await other.api.theatre.createRoom({
    orgSlug: other.orgSlug,
    name: "Theatre 1",
    kind: "operating_theatre",
  });
  await other.api.theatre.createEquipment({
    orgSlug: other.orgSlug,
    name: "C-arm #1",
    kind: "C-arm",
  });
});

test("deactivating and reactivating a room and a unit shows in resources; deactivation is audited", async () => {
  const hospital = await createHospital("ot-active");
  const other = await createHospital("ot-active-other");
  const { api, orgSlug } = hospital;

  const room = await api.theatre.createRoom({
    orgSlug,
    name: "Theatre 2",
    kind: "operating_theatre",
  });

  const unit = await api.theatre.createEquipment({ orgSlug, name: "Laser 1", kind: "Laser" });

  await api.theatre.setRoomActive({ orgSlug, roomId: room.id, active: false });
  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: unit.id, active: false });

  let listed = await resources(hospital);
  expect(listed.rooms.map((entry) => entry.active)).toEqual([false]);
  expect(listed.equipment.map((entry) => entry.active)).toEqual([false]);

  expect((await auditEntries(hospital, "theatre.room.deactivate")).map((e) => e.target)).toEqual([
    `theatre_room:${room.id}`,
  ]);
  expect(
    (await auditEntries(hospital, "theatre.equipment.deactivate")).map((e) => e.target),
  ).toEqual([`equipment_unit:${unit.id}`]);

  await api.theatre.setRoomActive({ orgSlug, roomId: room.id, active: true });
  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: unit.id, active: true });

  listed = await resources(hospital);
  expect(listed.rooms.map((entry) => entry.active)).toEqual([true]);
  expect(listed.equipment.map((entry) => entry.active)).toEqual([true]);

  const foreignRoom = await other.api.theatre.createRoom({
    orgSlug: other.orgSlug,
    name: "Foreign",
    kind: "operating_theatre",
  });

  for (const [label, roomId] of [
    ["unknown room", "missing"],
    ["foreign room", foreignRoom.id],
  ] as const) {
    await expectORPCCode(
      api.theatre.setRoomActive({ orgSlug, roomId, active: false }),
      "NOT_FOUND",
      label,
    );
  }

  await expectORPCCode(
    api.theatre.setEquipmentActive({ orgSlug, equipmentId: "missing", active: false }),
    "NOT_FOUND",
    "unknown unit",
  );
  expect((await resources(other)).rooms.map((entry) => entry.active)).toEqual([true]);
});

test("reception reads resources but cannot manage them: FORBIDDEN, nothing written, denial audited", async () => {
  const hospital = await createHospital("ot-reception");
  const { api, orgSlug } = hospital;
  const reception = await member(hospital, "ot-reception-desk", "reception");

  const room = await api.theatre.createRoom({
    orgSlug,
    name: "Theatre 3",
    kind: "operating_theatre",
  });

  const unit = await api.theatre.createEquipment({ orgSlug, name: "Drill 1", kind: "Drill" });
  const before = await resources(hospital);
  const deniedBefore = (await auditEntries(hospital, "rbac.permission")).length;

  expect(await resources(hospital, reception)).toEqual(before);

  await expectORPCCode(
    reception.theatre.createRoom({ orgSlug, name: "Desk Room", kind: "procedure_room" }),
    "FORBIDDEN",
    "createRoom",
  );
  await expectORPCCode(
    reception.theatre.createEquipment({ orgSlug, name: "Desk Unit", kind: "Drill" }),
    "FORBIDDEN",
    "createEquipment",
  );
  await expectORPCCode(
    reception.theatre.setRoomActive({ orgSlug, roomId: room.id, active: false }),
    "FORBIDDEN",
    "setRoomActive",
  );
  await expectORPCCode(
    reception.theatre.setEquipmentActive({ orgSlug, equipmentId: unit.id, active: false }),
    "FORBIDDEN",
    "setEquipmentActive",
  );

  expect(await resources(hospital)).toEqual(before);
  expect((await auditEntries(hospital, "rbac.permission")).length).toBe(deniedBefore + 4);
});

test("a cashier cannot read the theatre schedule resources", async () => {
  const hospital = await createHospital("ot-cashier");
  const cashier = await member(hospital, "ot-cashier-desk", "cashier");

  await expectORPCCode(resources(hospital, cashier), "FORBIDDEN");
});

// ── Slice 2: drafts ─────────────────────────────────────────────────────────

const MINUTE = 60 * 1_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

function fromNow(ms: number): Date {
  return new Date(Date.now() + ms);
}

// A planned interval starting `startsIn` from now and lasting `hours`.
function slot(startsIn: number, hours = 2) {
  const plannedStartAt = fromNow(startsIn);

  return { plannedStartAt, plannedEndAt: new Date(plannedStartAt.getTime() + hours * HOUR) };
}

let phoneSequence = 5_880_000;

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

type Theatre = Awaited<ReturnType<typeof createTheatre>>;

async function createTheatre(seed: string) {
  const hospital = await createHospital(seed);
  const { api, orgSlug } = hospital;
  const department = await api.staff.createDepartment({ orgSlug, name: `${seed} Surgery` });

  const surgeon = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed} One`,
    departmentId: department.id,
  });

  const secondSurgeon = await api.staff.createPractitioner({
    orgSlug,
    name: `Dr ${seed} Two`,
    departmentId: department.id,
  });

  const procedure = await api.catalog.create({
    orgSlug,
    name: "Appendectomy",
    category: "procedure",
    unitPrice: 25_000_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  const rooms = [
    await api.theatre.createRoom({ orgSlug, name: "Theatre 1", kind: "operating_theatre" }),
    await api.theatre.createRoom({ orgSlug, name: "Theatre 2", kind: "operating_theatre" }),
  ] as const;

  const units = [
    await api.theatre.createEquipment({ orgSlug, name: "C-arm 1", kind: "C-arm" }),
    await api.theatre.createEquipment({ orgSlug, name: "C-arm 2", kind: "C-arm" }),
  ] as const;

  return { ...hospital, surgeon, secondSurgeon, procedure, rooms, units };
}

type DraftInput = Parameters<AppRouterClient["theatre"]["draftCase"]>[0];

type DraftFields = Omit<DraftInput, "orgSlug" | "patientId">;

function caseFields(theatre: Theatre, overrides: Partial<DraftFields> = {}): DraftFields {
  return {
    practitionerId: theatre.surgeon.id,
    procedureItemId: theatre.procedure.id,
    roomId: theatre.rooms[0].id,
    ...slot(DAY),
    ...overrides,
  };
}

async function draft(theatre: Theatre, name: string, overrides: Partial<DraftFields> = {}) {
  const patient = await registerPatient(theatre.api, theatre.orgSlug, name);

  const surgicalCase = await theatre.api.theatre.draftCase({
    orgSlug: theatre.orgSlug,
    patientId: patient.id,
    ...caseFields(theatre, overrides),
  });

  return { patient, surgicalCase };
}

function getCase(theatre: Theatre, caseId: string, api = theatre.api) {
  return api.theatre.getCase({ orgSlug: theatre.orgSlug, caseId });
}

async function scheduled(theatre: Theatre, extra: { includeCancelled?: boolean } = {}) {
  return theatre.api.theatre.schedule({
    orgSlug: theatre.orgSlug,
    from: fromNow(-DAY),
    to: fromNow(7 * DAY),
    ...extra,
  });
}

async function scheduledIds(theatre: Theatre) {
  return (await scheduled(theatre)).cases.map((entry) => entry.id);
}

test("a draft records patient, consultant, procedure, room, units and both intervals", async () => {
  const theatre = await createTheatre("ot-draft");
  const window = slot(DAY, 3);

  const { patient, surgicalCase } = await draft(theatre, "Draft Patient", {
    ...window,
    prepMinutes: 30,
    cleanupMinutes: 45,
    equipmentIds: [theatre.units[0].id],
    notes: "Needs the long table",
  });

  const expected = {
    id: surgicalCase.id,
    status: "draft",
    revision: 0,
    patientId: patient.id,
    patientName: patient.name,
    mrn: patient.mrn,
    practitionerId: theatre.surgeon.id,
    consultantName: theatre.surgeon.name,
    procedureItemId: theatre.procedure.id,
    procedureName: "Appendectomy",
    roomId: theatre.rooms[0].id,
    roomName: "Theatre 1",
    equipment: [{ id: theatre.units[0].id, name: "C-arm 1" }],
    plannedStartAt: window.plannedStartAt,
    plannedEndAt: window.plannedEndAt,
    prepMinutes: 30,
    cleanupMinutes: 45,
    bufferedStartAt: new Date(window.plannedStartAt.getTime() - 30 * MINUTE),
    bufferedEndAt: new Date(window.plannedEndAt.getTime() + 45 * MINUTE),
    admissionId: null,
    bedReservationId: null,
    notes: "Needs the long table",
  };

  expect(surgicalCase).toMatchObject(expected);
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject(expected);

  const schedule = await scheduled(theatre);
  expect(schedule.cases).toHaveLength(1);
  expect(schedule.cases[0]).toMatchObject(expected);
  expect(schedule.blocks).toEqual([]);
});

test("a draft promises nothing: two drafts may overlap on one room, consultant and unit", async () => {
  const theatre = await createTheatre("ot-draft-overlap");
  const window = slot(DAY);
  const shared = { ...window, equipmentIds: [theatre.units[0].id] };

  const first = await draft(theatre, "Overlap One", shared);
  const second = await draft(theatre, "Overlap Two", shared);

  expect([first.surgicalCase.status, second.surgicalCase.status]).toEqual(["draft", "draft"]);
  expect((await scheduledIds(theatre)).sort()).toEqual(
    [first.surgicalCase.id, second.surgicalCase.id].sort(),
  );
});

test("a draft refuses a malformed interval, a past start, a non-procedure or inactive service and inactive resources", async () => {
  const theatre = await createTheatre("ot-draft-invalid");
  const { api, orgSlug } = theatre;
  const patient = await registerPatient(api, orgSlug, "Invalid Draft");
  const base = { orgSlug, patientId: patient.id, ...caseFields(theatre) };
  const start = fromNow(DAY);

  const consultation = await api.catalog.create({
    orgSlug,
    name: "Surgical consult",
    category: "consultation",
    unitPrice: 500_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  const retired = await api.catalog.create({
    orgSlug,
    name: "Retired procedure",
    category: "procedure",
    unitPrice: 500_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  await api.catalog.setActive({ orgSlug, itemId: retired.id, active: false });

  const closedRoom = await api.theatre.createRoom({
    orgSlug,
    name: "Closed",
    kind: "procedure_room",
  });

  await api.theatre.setRoomActive({ orgSlug, roomId: closedRoom.id, active: false });

  const retiredUnit = await api.theatre.createEquipment({
    orgSlug,
    name: "Old drill",
    kind: "Drill",
  });

  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: retiredUnit.id, active: false });

  for (const [label, input] of [
    ["end before start", { ...base, plannedStartAt: start, plannedEndAt: fromNow(DAY - HOUR) }],
    ["empty interval", { ...base, plannedStartAt: start, plannedEndAt: start }],
    [
      "longer than 24 hours",
      { ...base, plannedStartAt: start, plannedEndAt: new Date(start.getTime() + DAY + MINUTE) },
    ],
    ["start an hour ago", { ...base, ...slot(-HOUR) }],
    ["consultation service", { ...base, procedureItemId: consultation.id }],
    ["inactive procedure", { ...base, procedureItemId: retired.id }],
    ["inactive room", { ...base, roomId: closedRoom.id }],
    ["inactive unit", { ...base, equipmentIds: [retiredUnit.id] }],
    ["prep over 240 minutes", { ...base, prepMinutes: 241 }],
    ["negative cleanup", { ...base, cleanupMinutes: -1 }],
    ["empty room id", { ...base, roomId: "" }],
    ["empty unit id", { ...base, equipmentIds: [""] }],
    ["empty reservation id", { ...base, bedReservationId: "" }],
  ] satisfies Array<[string, DraftInput]>) {
    await expectORPCCode(api.theatre.draftCase(input), "BAD_REQUEST", label);
  }

  expect(await scheduledIds(theatre)).toEqual([]);

  // Exactly 24 hours, and a desk entry a few minutes late, are ordinary.
  const fullDay = await api.theatre.draftCase({
    ...base,
    plannedStartAt: start,
    plannedEndAt: new Date(start.getTime() + DAY),
  });

  const late = await api.theatre.draftCase({ ...base, ...slot(-5 * MINUTE) });

  expect((await scheduledIds(theatre)).sort()).toEqual([fullDay.id, late.id].sort());
});

test("unknown or foreign references are NOT_FOUND, and another Patient's bed reservation is refused", async () => {
  const theatre = await createTheatre("ot-draft-scope");
  const other = await createTheatre("ot-draft-scope-other");
  const { api, orgSlug } = theatre;
  const patient = await registerPatient(api, orgSlug, "Scoped Draft");
  const someoneElse = await registerPatient(api, orgSlug, "Someone Else");
  const foreignPatient = await registerPatient(other.api, other.orgSlug, "Foreign Draft");
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General bed" });

  const reservationFor = (patientId: string) =>
    api.ipd.requestBed({
      orgSlug,
      patientId,
      categoryId: category.id,
      plannedArrivalAt: fromNow(DAY - 4 * HOUR),
      plannedDepartureAt: fromNow(3 * DAY),
    });

  const own = await reservationFor(patient.id);
  const theirs = await reservationFor(someoneElse.id);
  const base = { orgSlug, patientId: patient.id, ...caseFields(theatre) };

  for (const [label, input] of [
    ["unknown patient", { ...base, patientId: "missing" }],
    ["foreign patient", { ...base, patientId: foreignPatient.id }],
    ["unknown consultant", { ...base, practitionerId: "missing" }],
    ["foreign consultant", { ...base, practitionerId: other.surgeon.id }],
    ["unknown procedure", { ...base, procedureItemId: "missing" }],
    ["foreign procedure", { ...base, procedureItemId: other.procedure.id }],
    ["unknown room", { ...base, roomId: "missing" }],
    ["foreign room", { ...base, roomId: other.rooms[0].id }],
    ["unknown unit", { ...base, equipmentIds: ["missing"] }],
    ["foreign unit", { ...base, equipmentIds: [theatre.units[0].id, other.units[0].id] }],
    ["unknown reservation", { ...base, bedReservationId: "missing" }],
  ] satisfies Array<[string, DraftInput]>) {
    await expectORPCCode(api.theatre.draftCase(input), "NOT_FOUND", label);
  }

  await expectORPCCode(
    api.theatre.draftCase({ ...base, bedReservationId: theirs.id }),
    "BAD_REQUEST",
    "another Patient's reservation",
  );

  expect(await scheduledIds(theatre)).toEqual([]);

  const linked = await api.theatre.draftCase({ ...base, bedReservationId: own.id });
  expect(await getCase(theatre, linked.id)).toMatchObject({ bedReservationId: own.id });
  await expectORPCCode(getCase(theatre, "missing"), "NOT_FOUND", "unknown case");
});

test("a draft is edited under a revision check; a stale edit is CONFLICT and changes nothing", async () => {
  const theatre = await createTheatre("ot-draft-edit");
  const { api, orgSlug } = theatre;
  const { surgicalCase } = await draft(theatre, "Edited Draft");
  const moved = slot(2 * DAY, 1);

  const edited = await api.theatre.updateCase({
    orgSlug,
    caseId: surgicalCase.id,
    expectedRevision: 0,
    ...caseFields(theatre, {
      ...moved,
      practitionerId: theatre.secondSurgeon.id,
      roomId: theatre.rooms[1].id,
      equipmentIds: [theatre.units[1].id],
      cleanupMinutes: 20,
      notes: "Moved to Theatre 2",
    }),
  });

  const expected = {
    status: "draft",
    revision: 1,
    consultantName: theatre.secondSurgeon.name,
    roomName: "Theatre 2",
    equipment: [{ id: theatre.units[1].id, name: "C-arm 2" }],
    plannedStartAt: moved.plannedStartAt,
    plannedEndAt: moved.plannedEndAt,
    bufferedEndAt: new Date(moved.plannedEndAt.getTime() + 20 * MINUTE),
    notes: "Moved to Theatre 2",
  };

  expect(edited).toMatchObject(expected);
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject(expected);

  await expectORPCCode(
    api.theatre.updateCase({
      orgSlug,
      caseId: surgicalCase.id,
      expectedRevision: 0,
      ...caseFields(theatre),
    }),
    "CONFLICT",
    "stale revision",
  );
  await expectORPCCode(
    api.theatre.updateCase({
      orgSlug,
      caseId: surgicalCase.id,
      expectedRevision: 1,
      ...caseFields(theatre, {
        plannedStartAt: moved.plannedEndAt,
        plannedEndAt: moved.plannedStartAt,
      }),
    }),
    "BAD_REQUEST",
    "end before start",
  );

  expect(await getCase(theatre, surgicalCase.id)).toMatchObject(expected);
});

test("the schedule lists cases overlapping its window and refuses a window over 31 days", async () => {
  const theatre = await createTheatre("ot-schedule-window");
  const { api, orgSlug } = theatre;
  const soon = await draft(theatre, "Soon", slot(DAY));
  const later = await draft(theatre, "Later", slot(10 * DAY));

  // One captured instant, so the 31-day bound is exact rather than a clock read apart.
  const now = Date.now();
  const at = (ms: number) => new Date(now + ms);

  const window = (from: number, to: number) =>
    api.theatre.schedule({ orgSlug, from: at(from), to: at(to) });

  expect((await window(0, 2 * DAY)).cases.map((entry) => entry.id)).toEqual([soon.surgicalCase.id]);
  expect((await window(0, 31 * DAY)).cases.map((entry) => entry.id)).toEqual([
    soon.surgicalCase.id,
    later.surgicalCase.id,
  ]);

  await expectORPCCode(window(0, 31 * DAY + MINUTE), "BAD_REQUEST", "32 days");
  await expectORPCCode(window(DAY, 0), "BAD_REQUEST", "inverted window");
});

// ── Slice 3: atomic confirmation ────────────────────────────────────────────

function confirm(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number },
  api = theatre.api,
) {
  return api.theatre.confirmCase({
    orgSlug: theatre.orgSlug,
    caseId: surgicalCase.id,
    expectedRevision: surgicalCase.revision,
  });
}

async function booked(theatre: Theatre, name: string, overrides: Partial<DraftFields> = {}) {
  const { patient, surgicalCase } = await draft(theatre, name, overrides);

  return { patient, surgicalCase: await confirm(theatre, surgicalCase) };
}

type Refusal = { code?: string; message?: string; data?: { reason?: string } };

async function settled<T>(promise: Promise<T>) {
  try {
    return { ok: true as const, value: await promise };
  } catch (error) {
    // SAFETY: oRPC client errors carry `code`, `message` and `data`; asserted by the callers.
    const { code, message, data } = error as Refusal;

    return { ok: false as const, code, message, reason: data?.reason };
  }
}

async function refusal(promise: Promise<unknown>) {
  const result = await settled(promise);

  if (result.ok) throw new Error("Expected the call to be refused");

  return result;
}

// The refusal wrote nothing: the case is still the same unconfirmed draft.
async function expectRefused(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number },
  label: string,
  expectedRevision = surgicalCase.revision,
) {
  await expectORPCCode(
    theatre.api.theatre.confirmCase({
      orgSlug: theatre.orgSlug,
      caseId: surgicalCase.id,
      expectedRevision,
    }),
    "CONFLICT",
    label,
  );
  expect(await getCase(theatre, surgicalCase.id), label).toMatchObject({
    status: "draft",
    revision: surgicalCase.revision,
  });
}

test("confirming a draft holds its room, units and consultant: confirmed, revision bumped, audited", async () => {
  const theatre = await createTheatre("ot-confirm");

  const { surgicalCase } = await draft(theatre, "Confirmed Case", {
    prepMinutes: 15,
    cleanupMinutes: 30,
    equipmentIds: [theatre.units[0].id],
  });

  const confirmed = await confirm(theatre, surgicalCase);

  expect(confirmed).toMatchObject({ id: surgicalCase.id, status: "confirmed", revision: 1 });
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({
    status: "confirmed",
    revision: 1,
    roomName: "Theatre 1",
    equipment: [{ id: theatre.units[0].id, name: "C-arm 1" }],
  });
  expect((await auditEntries(theatre, "theatre.case.confirm")).map((e) => e.target)).toEqual([
    `surgical_case:${surgicalCase.id}`,
  ]);

  await expectORPCCode(confirm(theatre, confirmed), "CONFLICT", "already confirmed");
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({ revision: 1 });
});

test("a case without a room, or with an inactive room or unit, is refused and stays a draft", async () => {
  const theatre = await createTheatre("ot-confirm-resources");
  const { api, orgSlug, rooms, units } = theatre;

  const { surgicalCase: roomless } = await draft(theatre, "No Room", { roomId: undefined });
  const { surgicalCase: inRoom } = await draft(theatre, "Closed Room", { roomId: rooms[1].id });

  const { surgicalCase: withUnit } = await draft(theatre, "Retired Unit", {
    equipmentIds: [units[1].id],
  });

  await api.theatre.setRoomActive({ orgSlug, roomId: rooms[1].id, active: false });
  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: units[1].id, active: false });

  await expectRefused(theatre, roomless, "no room");
  await expectRefused(theatre, inRoom, "inactive room");
  await expectRefused(theatre, withUnit, "inactive unit");
  await expectRefused(theatre, withUnit, "stale revision", withUnit.revision + 3);
});

test("room, unit and consultant clashes are refused, and a refused case holds nothing", async () => {
  const theatre = await createTheatre("ot-confirm-clash");
  const { rooms, units, surgeon, secondSurgeon } = theatre;
  const window = slot(DAY, 2);

  await booked(theatre, "Holder", { ...window, equipmentIds: [units[0].id] });

  const { surgicalCase: roomClash } = await draft(theatre, "Room Clash", {
    ...window,
    practitionerId: secondSurgeon.id,
  });

  const { surgicalCase: unitClash } = await draft(theatre, "Unit Clash", {
    ...window,
    roomId: rooms[1].id,
    practitionerId: secondSurgeon.id,
    equipmentIds: [units[1].id, units[0].id],
  });

  const { surgicalCase: consultantClash } = await draft(theatre, "Consultant Clash", {
    ...window,
    roomId: rooms[1].id,
    practitionerId: surgeon.id,
  });

  await expectRefused(theatre, roomClash, "room clash");
  await expectRefused(theatre, unitClash, "unit clash");
  await expectRefused(theatre, consultantClash, "consultant clash");

  // Nothing the refused cases asked for is held: Theatre 2, C-arm 2 and the second
  // consultant are free for the same window.
  const { surgicalCase: free } = await booked(theatre, "Free Slot", {
    ...window,
    roomId: rooms[1].id,
    practitionerId: secondSurgeon.id,
    equipmentIds: [units[1].id],
  });

  expect(free.status).toBe("confirmed");
});

test("the consultant is held for the planned interval only, not the room turnover", async () => {
  const theatre = await createTheatre("ot-confirm-consultant");
  const first = slot(DAY, 2);

  await booked(theatre, "First List", { ...first, cleanupMinutes: 30 });

  // Starts during the first case's cleanup buffer, in the other room.
  const nextStart = new Date(first.plannedEndAt.getTime() + 10 * MINUTE);

  const { surgicalCase } = await booked(theatre, "Second List", {
    roomId: theatre.rooms[1].id,
    plannedStartAt: nextStart,
    plannedEndAt: new Date(nextStart.getTime() + HOUR),
  });

  expect(surgicalCase.status).toBe("confirmed");
});

test("room buffers are respected: a case may start exactly when the previous buffered interval ends", async () => {
  const theatre = await createTheatre("ot-confirm-buffers");
  const { secondSurgeon } = theatre;
  const held = slot(DAY, 2);
  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE);

  await booked(theatre, "Buffered Holder", { ...held, prepMinutes: 20, cleanupMinutes: 30 });

  const other = { practitionerId: secondSurgeon.id };

  const { surgicalCase: oneMinuteEarly } = await draft(theatre, "One Minute Early", {
    ...other,
    plannedStartAt: at(held.plannedEndAt, 29),
    plannedEndAt: at(held.plannedEndAt, 89),
  });

  const { surgicalCase: overlapsPrep } = await draft(theatre, "Overlaps Prep", {
    ...other,
    plannedStartAt: at(held.plannedStartAt, -80),
    plannedEndAt: at(held.plannedStartAt, -19),
  });

  const { surgicalCase: ownPrepOverlaps } = await draft(theatre, "Own Prep Overlaps", {
    ...other,
    plannedStartAt: at(held.plannedEndAt, 40),
    plannedEndAt: at(held.plannedEndAt, 100),
    prepMinutes: 11,
  });

  await expectRefused(theatre, oneMinuteEarly, "one minute into cleanup");
  await expectRefused(theatre, overlapsPrep, "one minute into preparation");
  await expectRefused(theatre, ownPrepOverlaps, "own preparation overlaps cleanup");

  const { surgicalCase: after } = await booked(theatre, "Exactly After", {
    ...other,
    plannedStartAt: at(held.plannedEndAt, 30),
    plannedEndAt: at(held.plannedEndAt, 60),
  });

  const { surgicalCase: before } = await booked(theatre, "Exactly Before", {
    ...other,
    plannedStartAt: at(held.plannedStartAt, -80),
    plannedEndAt: at(held.plannedStartAt, -20),
  });

  expect([after.status, before.status]).toEqual(["confirmed", "confirmed"]);
});

test("a case whose planned start has passed cannot be confirmed", async () => {
  const theatre = await createTheatre("ot-confirm-past");
  const { surgicalCase } = await draft(theatre, "Late Desk Entry", slot(-5 * MINUTE));

  await expectRefused(theatre, surgicalCase, "start passed");
});

test("two desks confirming cases for the same room at once: exactly one wins, the loser holds nothing", async () => {
  const theatre = await createTheatre("ot-confirm-race-room");
  const window = slot(DAY);
  const { surgicalCase: first } = await draft(theatre, "Race Room One", window);

  const { surgicalCase: second } = await draft(theatre, "Race Room Two", {
    ...window,
    practitionerId: theatre.secondSurgeon.id,
  });

  const results = await Promise.all(
    [first, second].map((entry) => settled(confirm(theatre, entry))),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });

  const statuses = (await scheduled(theatre)).cases.map((entry) => entry.status).sort();
  expect(statuses).toEqual(["confirmed", "draft"]);
});

test("two desks confirming cases for the same unit at once: exactly one wins, the loser holds nothing", async () => {
  const theatre = await createTheatre("ot-confirm-race-unit");
  const window = slot(DAY);

  const { surgicalCase: first } = await draft(theatre, "Race Unit One", {
    ...window,
    equipmentIds: [theatre.units[0].id],
  });

  const { surgicalCase: second } = await draft(theatre, "Race Unit Two", {
    ...window,
    roomId: theatre.rooms[1].id,
    practitionerId: theatre.secondSurgeon.id,
    equipmentIds: [theatre.units[0].id, theatre.units[1].id],
  });

  const results = await Promise.all(
    [first, second].map((entry) => settled(confirm(theatre, entry))),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });

  const cases = (await scheduled(theatre)).cases;
  expect(cases.map((entry) => entry.status).sort()).toEqual(["confirmed", "draft"]);

  // The loser's room, consultant and any unit the winner does not need stay free.
  const loser = cases.find((entry) => entry.status === "draft")!;

  const { surgicalCase: free } = await booked(theatre, "After The Race", {
    ...window,
    roomId: loser.roomId!,
    practitionerId: loser.practitionerId,
    equipmentIds: loser.id === second.id ? [theatre.units[1].id] : [],
  });

  expect(free.status).toBe("confirmed");
});

// ── Slice 4: maintenance blocks ─────────────────────────────────────────────

type BlockInput = Parameters<AppRouterClient["theatre"]["blockResource"]>[0];

function block(
  theatre: Theatre,
  input: Omit<BlockInput, "orgSlug" | "reason"> & { reason?: string },
  api = theatre.api,
) {
  return api.theatre.blockResource({
    orgSlug: theatre.orgSlug,
    reason: "Laminar flow service",
    ...input,
  });
}

function blockWindow(start: Date, hours = 2) {
  return { startsAt: start, endsAt: new Date(start.getTime() + hours * HOUR) };
}

test("a block names exactly one room or unit, shows in resources and the schedule, and is audited", async () => {
  const theatre = await createTheatre("ot-block");
  const other = await createTheatre("ot-block-other");
  const { rooms, units } = theatre;
  const window = blockWindow(fromNow(DAY));

  const roomBlock = await block(theatre, { roomId: rooms[0].id, ...window });

  const unitBlock = await block(theatre, {
    equipmentId: units[0].id,
    ...window,
    reason: "Annual calibration",
  });

  expect(roomBlock).toMatchObject({
    roomId: rooms[0].id,
    equipmentId: null,
    ...window,
    reason: "Laminar flow service",
    removedAt: null,
  });
  expect(unitBlock).toMatchObject({ roomId: null, equipmentId: units[0].id, ...window });

  const blockIds = [roomBlock.id, unitBlock.id].sort();
  expect((await resources(theatre)).blocks.map((entry) => entry.id).sort()).toEqual(blockIds);
  expect((await scheduled(theatre)).blocks.map((entry) => entry.id).sort()).toEqual(blockIds);
  expect(
    (await auditEntries(theatre, "theatre.block.create")).map((entry) => entry.target).sort(),
  ).toEqual(blockIds.map((id) => `resource_block:${id}`).sort());

  for (const [label, input] of [
    ["both targets", { roomId: rooms[1].id, equipmentId: units[1].id, ...window }],
    ["no target", { ...window }],
    [
      "ends before it starts",
      { roomId: rooms[1].id, startsAt: window.endsAt, endsAt: window.startsAt },
    ],
    ["empty", { roomId: rooms[1].id, startsAt: window.startsAt, endsAt: window.startsAt }],
  ] as const) {
    await expectORPCCode(block(theatre, input), "BAD_REQUEST", label);
  }

  for (const [label, input] of [
    ["unknown room", { roomId: "missing", ...window }],
    ["foreign room", { roomId: other.rooms[0].id, ...window }],
    ["unknown unit", { equipmentId: "missing", ...window }],
    ["foreign unit", { equipmentId: other.units[0].id, ...window }],
  ] as const) {
    await expectORPCCode(block(theatre, input), "NOT_FOUND", label);
  }

  expect((await resources(theatre)).blocks).toHaveLength(2);
  expect((await resources(other)).blocks).toEqual([]);
});

test("a block over a confirmed case's held interval is CONFLICT and writes nothing", async () => {
  const theatre = await createTheatre("ot-block-clash");
  const { rooms, units } = theatre;
  const held = slot(DAY, 2);

  await booked(theatre, "Protected Case", {
    ...held,
    cleanupMinutes: 30,
    equipmentIds: [units[0].id],
  });

  const inCleanup = blockWindow(new Date(held.plannedEndAt.getTime() + 10 * MINUTE));

  expect(await refusal(block(theatre, { roomId: rooms[0].id, ...inCleanup }))).toMatchObject({
    code: "CONFLICT",
    reason: "case_held",
  });
  await expectORPCCode(
    block(theatre, { equipmentId: units[0].id, ...inCleanup }),
    "CONFLICT",
    "unit",
  );

  expect((await resources(theatre)).blocks).toEqual([]);
  expect(await auditEntries(theatre, "theatre.block.create")).toEqual([]);

  // Starting exactly when the held interval ends is allowed.
  const after = await block(theatre, {
    roomId: rooms[0].id,
    ...blockWindow(new Date(held.plannedEndAt.getTime() + 30 * MINUTE)),
  });

  expect((await resources(theatre)).blocks.map((entry) => entry.id)).toEqual([after.id]);
});

test("a case cannot be confirmed into a block on its room or one of its units", async () => {
  const theatre = await createTheatre("ot-block-confirm");
  const { rooms, units, secondSurgeon } = theatre;
  const window = slot(DAY, 2);

  await block(theatre, { roomId: rooms[0].id, ...blockWindow(window.plannedStartAt, 1) });
  await block(theatre, {
    equipmentId: units[1].id,
    ...blockWindow(new Date(window.plannedEndAt.getTime() + 10 * MINUTE)),
  });

  const { surgicalCase: inRoom } = await draft(theatre, "Blocked Room", window);

  const { surgicalCase: withUnit } = await draft(theatre, "Blocked Unit", {
    ...window,
    roomId: rooms[1].id,
    practitionerId: secondSurgeon.id,
    cleanupMinutes: 15,
    equipmentIds: [units[1].id],
  });

  await expectRefused(theatre, inRoom, "room block");
  await expectRefused(theatre, withUnit, "unit block during cleanup");
});

test("a removed block no longer blocks; removing it twice is CONFLICT; removal is audited", async () => {
  const theatre = await createTheatre("ot-block-remove");
  const window = slot(DAY, 2);

  const roomBlock = await block(theatre, {
    roomId: theatre.rooms[0].id,
    ...blockWindow(window.plannedStartAt),
  });

  const { surgicalCase } = await draft(theatre, "After Removal", window);

  await expectRefused(theatre, surgicalCase, "still blocked");

  await theatre.api.theatre.removeBlock({ orgSlug: theatre.orgSlug, blockId: roomBlock.id });

  expect((await resources(theatre)).blocks).toEqual([]);
  expect((await scheduled(theatre)).blocks).toEqual([]);
  expect((await confirm(theatre, surgicalCase)).status).toBe("confirmed");
  expect((await auditEntries(theatre, "theatre.block.remove")).map((e) => e.target)).toEqual([
    `resource_block:${roomBlock.id}`,
  ]);

  await expectORPCCode(
    theatre.api.theatre.removeBlock({ orgSlug: theatre.orgSlug, blockId: roomBlock.id }),
    "CONFLICT",
    "already removed",
  );
});

test("an owner's disrupting block lands and each overlapping confirmed case becomes disrupted, audited per case", async () => {
  const theatre = await createTheatre("ot-block-disrupt");
  const { rooms, secondSurgeon } = theatre;
  const morning = slot(DAY, 2);
  const noon = slot(DAY + 3 * HOUR, 2);

  const { surgicalCase: first } = await booked(theatre, "Disrupted One", morning);

  const { surgicalCase: second } = await booked(theatre, "Disrupted Two", {
    ...noon,
    practitionerId: secondSurgeon.id,
  });

  const { surgicalCase: elsewhere } = await booked(theatre, "Other Room", {
    ...morning,
    roomId: rooms[1].id,
    practitionerId: secondSurgeon.id,
  });

  const leak = await block(theatre, {
    roomId: rooms[0].id,
    startsAt: morning.plannedStartAt,
    endsAt: noon.plannedEndAt,
    reason: "Ceiling leak",
    disrupt: { reason: "Ceiling leak over the table" },
  });

  expect((await resources(theatre)).blocks.map((entry) => entry.id)).toEqual([leak.id]);

  for (const surgicalCase of [first, second]) {
    expect(await getCase(theatre, surgicalCase.id)).toMatchObject({
      status: "disrupted",
      disruptedReason: "Ceiling leak over the table",
      revision: surgicalCase.revision + 1,
    });
  }

  expect(await getCase(theatre, elsewhere.id)).toMatchObject({
    status: "confirmed",
    revision: elsewhere.revision,
  });

  const disruptions = await auditEntries(theatre, "theatre.case.disrupt");
  expect(disruptions.map((entry) => entry.target).sort()).toEqual(
    [first.id, second.id].map((id) => `surgical_case:${id}`).sort(),
  );

  for (const entry of disruptions) {
    expect(entry.meta).toMatchObject({ blockId: leak.id, reason: "Ceiling leak over the table" });
  }
});

test("reception cannot block, disrupt or remove blocks: FORBIDDEN, nothing written, denials audited", async () => {
  const theatre = await createTheatre("ot-block-reception");
  const reception = await member(theatre, "ot-block-reception-desk", "reception");
  const window = slot(DAY, 2);
  const { surgicalCase } = await booked(theatre, "Reception Protected", window);

  const existing = await block(theatre, {
    roomId: theatre.rooms[1].id,
    ...blockWindow(window.plannedStartAt),
  });

  const deniedBefore = (await auditEntries(theatre, "rbac.permission")).length;

  await expectORPCCode(
    block(
      theatre,
      {
        roomId: theatre.rooms[0].id,
        ...blockWindow(window.plannedStartAt),
        disrupt: { reason: "Desk override" },
      },
      reception,
    ),
    "FORBIDDEN",
    "disrupting block",
  );
  await expectORPCCode(
    block(theatre, { roomId: theatre.rooms[0].id, ...blockWindow(fromNow(5 * DAY)) }, reception),
    "FORBIDDEN",
    "plain block",
  );
  await expectORPCCode(
    reception.theatre.removeBlock({ orgSlug: theatre.orgSlug, blockId: existing.id }),
    "FORBIDDEN",
    "remove",
  );

  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({
    status: "confirmed",
    revision: surgicalCase.revision,
  });
  expect((await resources(theatre)).blocks.map((entry) => entry.id)).toEqual([existing.id]);
  expect((await auditEntries(theatre, "rbac.permission")).length).toBe(deniedBefore + 3);
});

test("a room or unit a confirmed case still needs cannot be deactivated", async () => {
  const theatre = await createTheatre("ot-deactivate-held");
  const { api, orgSlug, rooms, units } = theatre;

  await booked(theatre, "Keeps Room", { equipmentIds: [units[0].id] });

  await expect(
    api.theatre.setRoomActive({ orgSlug, roomId: rooms[0].id, active: false }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "A confirmed case still needs Theatre 1. Move or cancel it first.",
  });
  await expect(
    api.theatre.setEquipmentActive({ orgSlug, equipmentId: units[0].id, active: false }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "A confirmed case still needs C-arm 1. Move or cancel it first.",
  });

  const listed = await resources(theatre);
  expect(listed.rooms.map((entry) => [entry.name, entry.active])).toEqual([
    ["Theatre 1", true],
    ["Theatre 2", true],
  ]);
  expect(listed.equipment.map((entry) => [entry.name, entry.active])).toEqual([
    ["C-arm 1", true],
    ["C-arm 2", true],
  ]);
  expect(await auditEntries(theatre, "theatre.room.deactivate")).toEqual([]);
});

// ── Slice 5: reschedule, cancel, attach ─────────────────────────────────────

function update(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number },
  overrides: Partial<DraftFields> = {},
) {
  return theatre.api.theatre.updateCase({
    orgSlug: theatre.orgSlug,
    caseId: surgicalCase.id,
    expectedRevision: surgicalCase.revision,
    ...caseFields(theatre, overrides),
  });
}

function cancel(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number },
  reason = "Patient unfit",
) {
  return theatre.api.theatre.cancelCase({
    orgSlug: theatre.orgSlug,
    caseId: surgicalCase.id,
    expectedRevision: surgicalCase.revision,
    reason,
  });
}

test("a confirmed case moves when the new slot is free, frees the old one, and is audited as a reschedule", async () => {
  const theatre = await createTheatre("ot-reschedule");
  const first = slot(DAY, 2);
  const moved = slot(2 * DAY, 2);
  const { surgicalCase } = await booked(theatre, "Moving Case", first);

  const rescheduled = await update(theatre, surgicalCase, {
    ...moved,
    roomId: theatre.rooms[1].id,
    equipmentIds: [theatre.units[0].id],
  });

  expect(rescheduled).toMatchObject({
    status: "confirmed",
    revision: surgicalCase.revision + 1,
    roomName: "Theatre 2",
    equipment: [{ id: theatre.units[0].id, name: "C-arm 1" }],
    plannedStartAt: moved.plannedStartAt,
    plannedEndAt: moved.plannedEndAt,
  });
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({
    status: "confirmed",
    roomName: "Theatre 2",
  });
  expect((await auditEntries(theatre, "theatre.case.reschedule")).map((e) => e.target)).toEqual([
    `surgical_case:${surgicalCase.id}`,
  ]);

  // The old slot is free again, and a small shift may overlap the case's own old time.
  const { surgicalCase: taker } = await booked(theatre, "Old Slot Taker", first);
  expect(taker.status).toBe("confirmed");

  const nudged = await update(theatre, rescheduled, {
    roomId: theatre.rooms[1].id,
    equipmentIds: [theatre.units[0].id],
    plannedStartAt: new Date(moved.plannedStartAt.getTime() + 30 * MINUTE),
    plannedEndAt: new Date(moved.plannedEndAt.getTime() + 30 * MINUTE),
  });

  expect(nudged).toMatchObject({ status: "confirmed", revision: rescheduled.revision + 1 });
});

test("a reschedule into a clash or a block is CONFLICT and leaves the case confirmed as it was", async () => {
  const theatre = await createTheatre("ot-reschedule-clash");
  const { rooms, units, secondSurgeon } = theatre;
  const busy = slot(DAY, 2);
  const own = slot(2 * DAY, 2);

  await booked(theatre, "Busy Holder", {
    ...busy,
    practitionerId: secondSurgeon.id,
    equipmentIds: [units[0].id],
  });
  await block(theatre, { roomId: rooms[1].id, ...blockWindow(fromNow(3 * DAY)) });

  const { surgicalCase } = await booked(theatre, "Stays Put", {
    ...own,
    roomId: rooms[1].id,
    equipmentIds: [units[1].id],
  });

  const snapshot = await getCase(theatre, surgicalCase.id);

  for (const [label, overrides] of [
    ["room clash", { ...busy, roomId: rooms[0].id }],
    ["unit clash", { ...busy, roomId: rooms[1].id, equipmentIds: [units[0].id] }],
    ["consultant clash", { ...busy, roomId: rooms[1].id, practitionerId: secondSurgeon.id }],
    ["room block", { ...slot(3 * DAY, 1), roomId: rooms[1].id }],
    ["no room", { ...own, roomId: undefined }],
  ] satisfies Array<[string, Partial<DraftFields>]>) {
    await expectORPCCode(update(theatre, surgicalCase, overrides), "CONFLICT", label);
    expect(await getCase(theatre, surgicalCase.id), label).toEqual(snapshot);
  }

  expect(
    (await refusal(update(theatre, surgicalCase, { ...own, roomId: undefined }))).message,
  ).toBe("A confirmed case needs a room. Cancel it or choose another room.");

  expect(await auditEntries(theatre, "theatre.case.reschedule")).toEqual([]);
});

test("a disrupted case is moved, stays disrupted, and is confirmed again in its new slot", async () => {
  const theatre = await createTheatre("ot-reschedule-disrupted");
  const window = slot(DAY, 2);
  const { surgicalCase } = await booked(theatre, "Disrupted Then Moved", window);

  await block(theatre, {
    roomId: theatre.rooms[0].id,
    ...blockWindow(window.plannedStartAt),
    disrupt: { reason: "Autoclave failure" },
  });

  const disrupted = await getCase(theatre, surgicalCase.id);
  expect(disrupted).toMatchObject({ status: "disrupted", disruptedReason: "Autoclave failure" });

  await expectRefusedConfirm(theatre, disrupted, "still blocked");

  const moved = await update(theatre, disrupted, { ...window, roomId: theatre.rooms[1].id });
  expect(moved).toMatchObject({ status: "disrupted", roomName: "Theatre 2" });

  const reconfirmed = await confirm(theatre, moved);
  expect(reconfirmed).toMatchObject({
    status: "confirmed",
    disruptedReason: null,
    roomName: "Theatre 2",
    revision: moved.revision + 1,
  });
});

async function expectRefusedConfirm(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number; status: string },
  label: string,
) {
  await expectORPCCode(confirm(theatre, surgicalCase), "CONFLICT", label);
  expect(await getCase(theatre, surgicalCase.id), label).toMatchObject({
    status: surgicalCase.status,
    revision: surgicalCase.revision,
  });
}

test("cancelling a draft, a confirmed or a disrupted case records the reason and frees every hold", async () => {
  const theatre = await createTheatre("ot-cancel");
  const window = slot(DAY, 2);
  const later = slot(2 * DAY, 2);

  const { surgicalCase: drafted } = await draft(theatre, "Cancelled Draft");

  const { surgicalCase: held } = await booked(theatre, "Cancelled Hold", {
    ...window,
    equipmentIds: [theatre.units[0].id],
  });

  const { surgicalCase: toDisrupt } = await booked(theatre, "Cancelled Disrupted", {
    ...later,
    roomId: theatre.rooms[1].id,
  });

  await block(theatre, {
    roomId: theatre.rooms[1].id,
    ...blockWindow(later.plannedStartAt),
    disrupt: { reason: "Flooring repair" },
  });

  const disrupted = await getCase(theatre, toDisrupt.id);

  for (const surgicalCase of [drafted, held, disrupted]) {
    const cancelled = await cancel(theatre, surgicalCase, "Patient unfit for anaesthesia");

    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelReason: "Patient unfit for anaesthesia",
      revision: surgicalCase.revision + 1,
    });
  }

  expect(await scheduledIds(theatre)).toEqual([]);
  expect(
    (await scheduled(theatre, { includeCancelled: true })).cases.map((entry) => entry.id).sort(),
  ).toEqual([drafted.id, held.id, toDisrupt.id].sort());
  expect(
    (await auditEntries(theatre, "theatre.case.cancel")).map((entry) => entry.target).sort(),
  ).toEqual([drafted.id, held.id, toDisrupt.id].map((id) => `surgical_case:${id}`).sort());

  // The cancelled hold's room, unit and consultant are free for the same slot.
  const { surgicalCase: taker } = await booked(theatre, "Slot Taker", {
    ...window,
    equipmentIds: [theatre.units[0].id],
  });

  expect(taker.status).toBe("confirmed");

  const cancelled = await getCase(theatre, held.id);
  await expectORPCCode(cancel(theatre, cancelled), "CONFLICT", "cancel twice");
  await expectORPCCode(confirm(theatre, cancelled), "CONFLICT", "confirm cancelled");
  await expectORPCCode(update(theatre, cancelled), "CONFLICT", "edit cancelled");
  await expectORPCCode(
    cancel(theatre, { ...taker, revision: taker.revision + 2 }),
    "CONFLICT",
    "stale revision",
  );
  expect(await getCase(theatre, taker.id)).toMatchObject({ status: "confirmed" });
});

async function createWard(theatre: Theatre) {
  const { api, orgSlug } = theatre;

  const roomService = await api.catalog.create({
    orgSlug,
    name: "General ward bed day",
    category: "other",
    unitPrice: 1_000_00n,
    taxRatePercent: "0",
    taxCode: "",
    customRate: false,
  });

  const ward = await api.ipd.createWard({ orgSlug, name: "General" });
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General bed" });

  await api.ipd.setBedTariff({
    orgSlug,
    categoryId: category.id,
    catalogItemId: roomService.id,
    dailyPrice: 1_000_00n,
    effectiveFrom: fromNow(-30 * DAY),
  });

  const bed = (label: string) =>
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId: category.id, label });

  return [await bed("G-1"), await bed("G-2"), await bed("G-3"), await bed("G-4")] as const;
}

function admit(theatre: Theatre, patientId: string, bedId: string) {
  return theatre.api.ipd.admit({
    orgSlug: theatre.orgSlug,
    patientId,
    practitionerId: theatre.surgeon.id,
    bedId,
  });
}

function attach(
  theatre: Theatre,
  surgicalCase: { id: string; revision: number },
  admissionId: string,
  api = theatre.api,
) {
  return api.theatre.attachCaseAdmission({
    orgSlug: theatre.orgSlug,
    caseId: surgicalCase.id,
    expectedRevision: surgicalCase.revision,
    admissionId,
  });
}

test("a case attaches only its own Patient's active Admission", async () => {
  const theatre = await createTheatre("ot-attach");
  const other = await createTheatre("ot-attach-other");
  const { api, orgSlug } = theatre;
  const beds = await createWard(theatre);
  const otherBeds = await createWard(other);

  const { patient, surgicalCase } = await booked(theatre, "Attached Patient");
  const { patient: neighbour } = await draft(theatre, "Neighbour");
  const { patient: leaver } = await draft(theatre, "Discharged Patient");
  const { patient: cancelledPatient } = await draft(theatre, "Cancelled Admission");
  const { patient: foreignPatient } = await draft(other, "Foreign Admitted");

  const neighbourAdmission = await admit(theatre, neighbour.id, beds[1].id);
  const leaverAdmission = await admit(theatre, leaver.id, beds[2].id);

  const ready = await api.ipd.markDischargeReady({
    orgSlug,
    admissionId: leaverAdmission.id,
    expectedRevision: leaverAdmission.revision,
  });

  const discharged = await api.ipd.discharge({
    orgSlug,
    admissionId: leaverAdmission.id,
    expectedRevision: ready.revision,
  });

  const cancelledAdmission = await admit(theatre, cancelledPatient.id, beds[3].id);
  await api.ipd.cancel({
    orgSlug,
    admissionId: cancelledAdmission.id,
    expectedRevision: cancelledAdmission.revision,
    reason: "Admitted in error",
  });
  const foreignAdmission = await admit(other, foreignPatient.id, otherBeds[0].id);

  // The stay picker asks for one Patient's admissions only, within this organization.
  expect(
    (await api.ipd.list({ orgSlug, patientId: neighbour.id })).items.map((entry) => entry.id),
  ).toEqual([neighbourAdmission.id]);
  expect((await api.ipd.list({ orgSlug, patientId: foreignPatient.id })).items).toEqual([]);

  expect(discharged.status).toBe("discharged");

  // Every refusal leaves the case untouched.
  const snapshot = await getCase(theatre, surgicalCase.id);

  for (const [label, admissionId, code] of [
    ["another Patient's Admission", neighbourAdmission.id, "CONFLICT"],
    ["discharged Admission", leaverAdmission.id, "CONFLICT"],
    ["cancelled Admission", cancelledAdmission.id, "CONFLICT"],
    ["foreign Admission", foreignAdmission.id, "NOT_FOUND"],
    ["unknown Admission", "missing", "NOT_FOUND"],
  ] as const) {
    await expectORPCCode(attach(theatre, surgicalCase, admissionId), code, label);
    expect(await getCase(theatre, surgicalCase.id), label).toEqual(snapshot);
  }

  const admission = await admit(theatre, patient.id, beds[0].id);
  await expectORPCCode(
    attach(theatre, { ...surgicalCase, revision: surgicalCase.revision + 4 }, admission.id),
    "CONFLICT",
    "stale revision",
  );

  const attached = await attach(theatre, surgicalCase, admission.id);

  expect(attached).toMatchObject({
    admissionId: admission.id,
    status: "confirmed",
    revision: surgicalCase.revision + 1,
  });
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({ admissionId: admission.id });
});

// Each read is an existing billing, pharmacy or accounting API.
async function moneyTrail(theatre: Theatre, patientIds: string[], admissionId: string) {
  const { api, orgSlug } = theatre;
  const today = new Date();

  const day = (offset: number) =>
    new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10);

  return {
    accounts: await Promise.all(
      patientIds.map((patientId) => api.patient.account({ orgSlug, patientId })),
    ),
    admissionBill: await api.ipd.previewInvoice({ orgSlug, admissionId }),
    stockMovements: await api.pharmacy.listMovements({ orgSlug }),
    trialBalance: await api.report.trialBalance({ orgSlug, from: day(-2), to: day(2) }),
  };
}

test("booking, moving, cancelling and attaching never create Charges, stock movements, Invoices or journals", async () => {
  const theatre = await createTheatre("ot-no-money");
  const beds = await createWard(theatre);
  const patient = await registerPatient(theatre.api, theatre.orgSlug, "No Money Patient");
  const admission = await admit(theatre, patient.id, beds[0].id);
  const before = await moneyTrail(theatre, [patient.id], admission.id);

  const surgicalCase = await theatre.api.theatre.draftCase({
    orgSlug: theatre.orgSlug,
    patientId: patient.id,
    ...caseFields(theatre, { equipmentIds: [theatre.units[0].id] }),
  });

  const confirmed = await confirm(theatre, surgicalCase);
  const attached = await attach(theatre, confirmed, admission.id);
  const moved = await update(theatre, attached, { ...slot(2 * DAY) });
  await cancel(theatre, moved);

  expect(await moneyTrail(theatre, [patient.id], admission.id)).toEqual(before);
  expect(before.accounts[0]!.invoices).toEqual([]);
  expect(before.stockMovements.items).toEqual([]);
});

// ── Slice 6: tenancy ────────────────────────────────────────────────────────

test("another organization's member cannot read, edit, confirm, cancel or attach this organization's records through their own slug", async () => {
  const theatre = await createTheatre("ot-tenant");
  const intruder = await createTheatre("ot-tenant-intruder");
  const { api: foreign, orgSlug: foreignSlug } = intruder;
  const beds = await createWard(theatre);
  const intruderBeds = await createWard(intruder);
  const window = slot(DAY, 2);

  const { patient, surgicalCase } = await booked(theatre, "Tenant Case", {
    ...window,
    equipmentIds: [theatre.units[0].id],
  });

  const { surgicalCase: drafted } = await draft(theatre, "Tenant Draft", slot(2 * DAY));
  const admission = await admit(theatre, patient.id, beds[0].id);

  const roomBlock = await block(theatre, {
    roomId: theatre.rooms[1].id,
    ...blockWindow(fromNow(3 * DAY)),
  });

  const { patient: intruderPatient } = await draft(intruder, "Intruder Patient");
  const intruderAdmission = await admit(intruder, intruderPatient.id, intruderBeds[0].id);

  const beforeCase = await getCase(theatre, surgicalCase.id);
  const beforeDraft = await getCase(theatre, drafted.id);
  const beforeResources = await resources(theatre);
  const beforeSchedule = await scheduled(theatre);

  const revision = { caseId: surgicalCase.id, expectedRevision: surgicalCase.revision };

  const fields = {
    ...caseFields(intruder, window),
    roomId: intruder.rooms[0].id,
  };

  for (const [label, call, code] of [
    [
      "getCase",
      () => foreign.theatre.getCase({ orgSlug: foreignSlug, caseId: surgicalCase.id }),
      "NOT_FOUND",
    ],
    [
      "updateCase",
      () => foreign.theatre.updateCase({ orgSlug: foreignSlug, ...revision, ...fields }),
      "NOT_FOUND",
    ],
    [
      "confirmCase",
      () =>
        foreign.theatre.confirmCase({
          orgSlug: foreignSlug,
          caseId: drafted.id,
          expectedRevision: drafted.revision,
        }),
      "NOT_FOUND",
    ],
    [
      "cancelCase",
      () => foreign.theatre.cancelCase({ orgSlug: foreignSlug, ...revision, reason: "Intrusion" }),
      "CONFLICT",
    ],
    [
      "attach this organization's Admission",
      () =>
        foreign.theatre.attachCaseAdmission({
          orgSlug: foreignSlug,
          ...revision,
          admissionId: admission.id,
        }),
      "NOT_FOUND",
    ],
    [
      "attach their own Admission",
      () =>
        foreign.theatre.attachCaseAdmission({
          orgSlug: foreignSlug,
          ...revision,
          admissionId: intruderAdmission.id,
        }),
      "CONFLICT",
    ],
    [
      "setRoomActive",
      () =>
        foreign.theatre.setRoomActive({
          orgSlug: foreignSlug,
          roomId: theatre.rooms[0].id,
          active: false,
        }),
      "NOT_FOUND",
    ],
    [
      "setEquipmentActive",
      () =>
        foreign.theatre.setEquipmentActive({
          orgSlug: foreignSlug,
          equipmentId: theatre.units[0].id,
          active: false,
        }),
      "NOT_FOUND",
    ],
    [
      "blockResource on the room",
      () =>
        foreign.theatre.blockResource({
          orgSlug: foreignSlug,
          roomId: theatre.rooms[0].id,
          ...blockWindow(window.plannedStartAt),
          reason: "Intrusion",
          disrupt: { reason: "Intrusion" },
        }),
      "NOT_FOUND",
    ],
    [
      "blockResource on the unit",
      () =>
        foreign.theatre.blockResource({
          orgSlug: foreignSlug,
          equipmentId: theatre.units[0].id,
          ...blockWindow(window.plannedStartAt),
          reason: "Intrusion",
        }),
      "NOT_FOUND",
    ],
    [
      "removeBlock",
      () => foreign.theatre.removeBlock({ orgSlug: foreignSlug, blockId: roomBlock.id }),
      "CONFLICT",
    ],
    [
      "draftCase in this organization's room",
      () =>
        foreign.theatre.draftCase({
          orgSlug: foreignSlug,
          patientId: intruderPatient.id,
          ...fields,
          roomId: theatre.rooms[0].id,
        }),
      "NOT_FOUND",
    ],
    [
      "draftCase for this organization's Patient",
      () => foreign.theatre.draftCase({ orgSlug: foreignSlug, patientId: patient.id, ...fields }),
      "NOT_FOUND",
    ],
  ] as const) {
    await expectORPCCode(call(), code, label);
  }

  const seen = await resources(intruder);
  const ownIds = [...seen.rooms, ...seen.equipment].map((entry) => entry.id);

  expect(ownIds.sort()).toEqual(
    [...intruder.rooms, ...intruder.units].map((entry) => entry.id).sort(),
  );
  expect(seen.blocks).toEqual([]);
  expect(
    (await scheduled(intruder, { includeCancelled: true })).cases.map((entry) => entry.patientId),
  ).toEqual([intruderPatient.id]);

  expect(await getCase(theatre, surgicalCase.id)).toEqual(beforeCase);
  expect(await getCase(theatre, drafted.id)).toEqual(beforeDraft);
  expect(await resources(theatre)).toEqual(beforeResources);
  expect(await scheduled(theatre)).toEqual(beforeSchedule);
});

// ── Review fixes: races, stale screens, started and retired cases ──────────

type StoredCase = Awaited<ReturnType<AppRouterClient["theatre"]["getCase"]>>;

// Moves a stored case in time past the API's start guard, standing in for a case
// that has started or is already over.
async function backdate(theatre: Theatre, caseId: string, plannedStartAt: Date, hours = 2) {
  await db
    .update(surgicalCases)
    .set({ plannedStartAt, plannedEndAt: new Date(plannedStartAt.getTime() + hours * HOUR) })
    .where(and(eq(surgicalCases.orgId, theatre.organization.id), eq(surgicalCases.id, caseId)));

  return getCase(theatre, caseId);
}

// Sends a case's own stored values back, with the given changes.
function edit(theatre: Theatre, stored: StoredCase, overrides: Partial<DraftFields> = {}) {
  return theatre.api.theatre.updateCase({
    orgSlug: theatre.orgSlug,
    caseId: stored.id,
    expectedRevision: stored.revision,
    practitionerId: stored.practitionerId,
    procedureItemId: stored.procedureItemId,
    roomId: stored.roomId ?? undefined,
    plannedStartAt: stored.plannedStartAt,
    plannedEndAt: stored.plannedEndAt,
    prepMinutes: stored.prepMinutes,
    cleanupMinutes: stored.cleanupMinutes,
    equipmentIds: stored.equipment.map((unit) => unit.id),
    bedReservationId: stored.bedReservationId ?? undefined,
    notes: stored.notes ?? undefined,
    ...overrides,
  });
}

test("a stale revision is refused as stale_record on change, confirm and cancel", async () => {
  const theatre = await createTheatre("ot-stale-reason");
  const { surgicalCase } = await draft(theatre, "Stale Reason");
  const stale = { ...surgicalCase, revision: surgicalCase.revision + 2 };

  for (const [label, call] of [
    ["change", () => update(theatre, stale)],
    ["confirm", () => confirm(theatre, stale)],
    ["cancel", () => cancel(theatre, stale)],
  ] as const) {
    expect(await refusal(call()), label).toMatchObject({
      code: "CONFLICT",
      reason: "stale_record",
    });
  }

  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({ status: "draft", revision: 0 });
});

test("a draft edit racing its own confirmation: exactly one wins, the other is stale, never a server error", async () => {
  const theatre = await createTheatre("ot-race-edit-confirm");
  const { units } = theatre;

  for (let round = 0; round < 10; round += 1) {
    const label = `round ${round}`;

    const { surgicalCase } = await draft(theatre, `Edit Race ${round}`, {
      ...slot(DAY + round * 3 * HOUR, 2),
      equipmentIds: [units[0].id],
    });

    const stored = await getCase(theatre, surgicalCase.id);

    const results = await Promise.all([
      settled(edit(theatre, stored, { equipmentIds: [units[0].id, units[1].id], notes: label })),
      settled(confirm(theatre, surgicalCase)),
    ]);

    expect(
      results.filter((result) => result.ok),
      label,
    ).toHaveLength(1);
    expect(
      results.find((result) => !result.ok),
      label,
    ).toMatchObject({ code: "CONFLICT", reason: "stale_record" });
    expect(await getCase(theatre, surgicalCase.id), label).toMatchObject({ revision: 1 });
  }
});

test("two desks confirming one consultant's overlapping cases in different rooms: exactly one wins", async () => {
  const theatre = await createTheatre("ot-race-consultant");

  for (let round = 0; round < 10; round += 1) {
    const label = `round ${round}`;
    const window = slot(DAY + round * 3 * HOUR, 2);
    const { surgicalCase: first } = await draft(theatre, `Consultant Race ${round} A`, window);

    const { surgicalCase: second } = await draft(theatre, `Consultant Race ${round} B`, {
      ...window,
      roomId: theatre.rooms[1].id,
    });

    const results = await Promise.all(
      [first, second].map((entry) => settled(confirm(theatre, entry))),
    );

    expect(
      results.filter((result) => result.ok),
      label,
    ).toHaveLength(1);
    expect(
      results.find((result) => !result.ok),
      label,
    ).toMatchObject({ code: "CONFLICT" });

    const statuses = await Promise.all(
      [first, second].map(async (entry) => (await getCase(theatre, entry.id)).status),
    );

    expect(statuses.sort(), label).toEqual(["confirmed", "draft"]);
  }
});

test("a block and a confirmation for the same room and time at once: never both", async () => {
  const theatre = await createTheatre("ot-race-block-confirm");
  const roomId = theatre.rooms[0].id;

  for (let round = 0; round < 10; round += 1) {
    const label = `round ${round}`;
    const window = slot(DAY + round * 3 * HOUR, 2);
    const { surgicalCase } = await draft(theatre, `Block Race ${round}`, window);

    const [blocked, confirmed] = await Promise.all([
      settled(block(theatre, { roomId, ...blockWindow(window.plannedStartAt, 1) })),
      settled(confirm(theatre, surgicalCase)),
    ]);

    expect([blocked.ok, confirmed.ok].filter(Boolean), label).toHaveLength(1);

    const stored = await getCase(theatre, surgicalCase.id);

    const blocksThen = (await resources(theatre)).blocks.filter(
      (entry) => entry.startsAt.getTime() === window.plannedStartAt.getTime(),
    );

    if (blocked.ok) {
      expect(confirmed, label).toMatchObject({ code: "CONFLICT" });
      expect(stored.status, label).toBe("draft");
      expect(blocksThen, label).toHaveLength(1);
    } else {
      expect(blocked, label).toMatchObject({ code: "CONFLICT", reason: "case_held" });
      expect(stored.status, label).toBe("confirmed");
      expect(blocksThen, label).toEqual([]);
    }
  }
});

test("a block entered after the fact neither refuses over nor disrupts a case that is already over", async () => {
  const theatre = await createTheatre("ot-block-past");
  const { rooms, secondSurgeon } = theatre;
  const { surgicalCase } = await booked(theatre, "Already Done");
  const yesterday = fromNow(-DAY);
  const done = await backdate(theatre, surgicalCase.id, yesterday);

  await block(theatre, { roomId: rooms[0].id, ...blockWindow(yesterday, 1) });
  await block(theatre, {
    roomId: rooms[0].id,
    ...blockWindow(new Date(yesterday.getTime() + HOUR), 1),
    disrupt: { reason: "Recorded late" },
  });

  expect(await getCase(theatre, surgicalCase.id)).toEqual(done);
  expect(await auditEntries(theatre, "theatre.case.disrupt")).toEqual([]);

  // A case still in theatre counts: its held interval has not ended.
  const { surgicalCase: running } = await booked(theatre, "In Theatre Now", {
    roomId: rooms[1].id,
    practitionerId: secondSurgeon.id,
  });

  await backdate(theatre, running.id, fromNow(-HOUR));

  expect(
    await refusal(block(theatre, { roomId: rooms[1].id, ...blockWindow(fromNow(-2 * HOUR), 4) })),
  ).toMatchObject({ code: "CONFLICT", reason: "case_held" });
});

test("a started confirmed case takes a notes fix, but not a move of its time, room, units or consultant", async () => {
  const theatre = await createTheatre("ot-started-edit");
  const { rooms, units, secondSurgeon } = theatre;

  const { surgicalCase } = await booked(theatre, "Started Case", {
    equipmentIds: [units[0].id],
  });

  const started = await backdate(theatre, surgicalCase.id, fromNow(-HOUR));
  const noted = await edit(theatre, started, { notes: "Second unit of blood ready" });

  expect(noted).toMatchObject({
    status: "confirmed",
    revision: started.revision + 1,
    roomId: rooms[0].id,
    equipment: [{ id: units[0].id, name: "C-arm 1" }],
    plannedStartAt: started.plannedStartAt,
    notes: "Second unit of blood ready",
  });

  for (const [label, overrides] of [
    ["room", { roomId: rooms[1].id }],
    ["units", { equipmentIds: [] }],
    ["consultant", { practitionerId: secondSurgeon.id }],
    ["end", { plannedEndAt: new Date(started.plannedEndAt.getTime() + HOUR) }],
  ] satisfies Array<[string, Partial<DraftFields>]>) {
    expect((await refusal(edit(theatre, noted, overrides))).code, label).toBe("CONFLICT");
  }

  expect(await getCase(theatre, surgicalCase.id)).toEqual(noted);
});

test("a draft keeps its retired room, unit and procedure through an edit, but cannot take another retired one or be confirmed", async () => {
  const theatre = await createTheatre("ot-retired-references");
  const { api, orgSlug, rooms, units } = theatre;

  const procedure = (name: string) =>
    api.catalog.create({
      orgSlug,
      name,
      category: "procedure",
      unitPrice: 1_000_00n,
      taxRatePercent: "0",
      taxCode: "",
      customRate: false,
    });

  const hernia = await procedure("Hernia repair");
  const retiredProcedure = await procedure("Old technique");

  const closedRoom = await api.theatre.createRoom({
    orgSlug,
    name: "Closed",
    kind: "procedure_room",
  });

  const oldDrill = await api.theatre.createEquipment({ orgSlug, name: "Old drill", kind: "Drill" });

  const { surgicalCase } = await draft(theatre, "Retired References", {
    roomId: rooms[1].id,
    equipmentIds: [units[1].id],
    procedureItemId: hernia.id,
  });

  await api.theatre.setRoomActive({ orgSlug, roomId: rooms[1].id, active: false });
  await api.theatre.setRoomActive({ orgSlug, roomId: closedRoom.id, active: false });
  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: units[1].id, active: false });
  await api.theatre.setEquipmentActive({ orgSlug, equipmentId: oldDrill.id, active: false });
  await api.catalog.setActive({ orgSlug, itemId: hernia.id, active: false });
  await api.catalog.setActive({ orgSlug, itemId: retiredProcedure.id, active: false });

  const stored = await getCase(theatre, surgicalCase.id);
  const kept = await edit(theatre, stored, { notes: "Kept as booked" });

  expect(kept).toMatchObject({
    status: "draft",
    revision: 1,
    roomId: rooms[1].id,
    procedureItemId: hernia.id,
    equipment: [{ id: units[1].id, name: "C-arm 2" }],
    notes: "Kept as booked",
  });

  for (const [label, overrides] of [
    ["another retired room", { roomId: closedRoom.id }],
    ["another retired unit", { equipmentIds: [units[1].id, oldDrill.id] }],
    ["another retired procedure", { procedureItemId: retiredProcedure.id }],
  ] satisfies Array<[string, Partial<DraftFields>]>) {
    await expectORPCCode(edit(theatre, kept, overrides), "BAD_REQUEST", label);
  }

  await expectRefused(theatre, kept, "retired room on confirmation");
});

test("the database ties a case's bed reservation to the case's own Patient", async () => {
  const theatre = await createTheatre("ot-reservation-patient");
  const { api, orgSlug } = theatre;
  const { patient, surgicalCase } = await draft(theatre, "Own Reservation");
  const someoneElse = await registerPatient(api, orgSlug, "Someone Else");
  const category = await api.ipd.createBedCategory({ orgSlug, name: "General bed" });

  const reservationFor = (patientId: string) =>
    api.ipd.requestBed({
      orgSlug,
      patientId,
      categoryId: category.id,
      plannedArrivalAt: fromNow(DAY - 4 * HOUR),
      plannedDepartureAt: fromNow(3 * DAY),
    });

  const own = await reservationFor(patient.id);
  const theirs = await reservationFor(someoneElse.id);

  const link = async (bedReservationId: string) => {
    await db
      .update(surgicalCases)
      .set({ bedReservationId })
      .where(
        and(
          eq(surgicalCases.orgId, theatre.organization.id),
          eq(surgicalCases.id, surgicalCase.id),
        ),
      );
  };

  await expect(link(theirs.id)).rejects.toThrow();
  await link(own.id);
  expect(await getCase(theatre, surgicalCase.id)).toMatchObject({ bedReservationId: own.id });
});
