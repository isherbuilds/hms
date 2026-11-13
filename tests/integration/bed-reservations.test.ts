// Spec: docs/specs/facility-booking-and-theatre.md, "Bed reservations: IPD slice 2".
import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { bedReservations } from "@hms/db/schema/ipd";
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

const MINUTE = 60 * 1_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

function fromNow(ms: number): Date {
  return new Date(Date.now() + ms);
}

let phoneSequence = 5_770_000;

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
  const privateCategory = await api.ipd.createBedCategory({ orgSlug, name: "Private room" });

  for (const categoryId of [category.id, privateCategory.id]) {
    await api.ipd.setBedTariff({
      orgSlug,
      categoryId,
      catalogItemId: roomService.id,
      dailyPrice: 1_000_00n,
      effectiveFrom: fromNow(-30 * DAY),
    });
  }

  const bed = (label: string, categoryId = category.id) =>
    api.ipd.createBed({ orgSlug, wardId: ward.id, categoryId, label });

  const beds = [await bed("G-1"), await bed("G-2"), await bed("G-3")] as const;
  const privateBed = await bed("P-1", privateCategory.id);

  return {
    owner,
    organization,
    orgSlug,
    api,
    practitioner,
    ward,
    category,
    privateCategory,
    beds,
    privateBed,
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

type Window = { plannedArrivalAt: Date; plannedDepartureAt: Date; holdUntil?: Date };

// Tomorrow for two days, held until noon-ish of arrival day: far from every clock edge.
function tomorrow(): Window {
  return {
    plannedArrivalAt: fromNow(DAY),
    plannedDepartureAt: fromNow(3 * DAY),
    holdUntil: fromNow(DAY + 4 * HOUR),
  };
}

async function request(
  hospital: Hospital,
  name: string,
  window: Window = tomorrow(),
  extra: { bedId?: string } = {},
) {
  const patient = await registerPatient(hospital.api, hospital.orgSlug, name);

  const reservation = await hospital.api.ipd.requestBed({
    orgSlug: hospital.orgSlug,
    patientId: patient.id,
    categoryId: hospital.category.id,
    ...extra,
    ...window,
  });

  return { patient, reservation };
}

async function listed(hospital: Hospital, view: "arrivals" | "waitlist" | "attention" | "all") {
  const { items } = await hospital.api.ipd.listBedReservations({
    orgSlug: hospital.orgSlug,
    view,
  });

  return items;
}

async function find(hospital: Hospital, reservationId: string) {
  const item = (await listed(hospital, "all")).find((entry) => entry.id === reservationId);

  if (!item) throw new Error(`reservation ${reservationId} missing from the all view`);

  return item;
}

async function admitWalkIn(hospital: Hospital, bedId: string, name: string) {
  const patient = await registerPatient(hospital.api, hospital.orgSlug, name);

  const admission = await hospital.api.ipd.admit({
    orgSlug: hospital.orgSlug,
    patientId: patient.id,
    practitionerId: hospital.practitioner.id,
    bedId,
  });

  return { patient, admission };
}

async function confirm(
  hospital: Hospital,
  reservation: { id: string; revision: number; holdUntil: Date | null },
  bedId: string,
  holdUntil = reservation.holdUntil ?? fromNow(DAY + 4 * HOUR),
) {
  return hospital.api.ipd.confirmBedReservation({
    orgSlug: hospital.orgSlug,
    reservationId: reservation.id,
    expectedRevision: reservation.revision,
    bedId,
    holdUntil,
  });
}

async function hold(hospital: Hospital, name: string, bedId: string, window: Window = tomorrow()) {
  const { patient, reservation } = await request(hospital, name, window);

  return { patient, reservation: await confirm(hospital, reservation, bedId, window.holdUntil) };
}

async function boardBed(hospital: Hospital, bedId: string) {
  const board = await hospital.api.ipd.bedBoard({ orgSlug: hospital.orgSlug });
  const bed = board.beds.find((candidate) => candidate.id === bedId);

  if (!bed) throw new Error(`bed ${bedId} missing from the board`);

  return bed;
}

// The API refuses a hold time that has passed, so a lapsed hold is made by waiting it out.
async function lapsedHold(hospital: Hospital, name: string, bedId: string) {
  const { patient, reservation } = await request(hospital, name, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(2 * DAY),
  });

  const holdUntil = fromNow(1_500);
  const confirmed = await confirm(hospital, reservation, bedId, holdUntil);
  await Bun.sleep(holdUntil.getTime() - Date.now() + 50);

  return { patient, reservation: confirmed };
}

// ── Slice 1: request and list ───────────────────────────────────────────────

test("a category request is a requested waitlist entry with patient, category and window", async () => {
  const hospital = await createHospital("resv-request");
  const window = tomorrow();
  const { patient, reservation } = await request(hospital, "Waitlist Patient", window);

  expect(reservation).toMatchObject({ status: "requested", revision: 0 });

  for (const view of ["waitlist", "all"] as const) {
    const item = (await listed(hospital, view)).find((entry) => entry.id === reservation.id);

    expect(item, view).toMatchObject({
      patientName: patient.name,
      mrn: patient.mrn,
      categoryName: "General bed",
      bedLabel: null,
      wardName: null,
      plannedArrivalAt: window.plannedArrivalAt,
      plannedDepartureAt: window.plannedDepartureAt,
      holdUntil: window.holdUntil,
      status: "requested",
      effectiveStatus: "requested",
      revision: 0,
      atRisk: false,
    });
  }

  expect((await listed(hospital, "arrivals")).map((entry) => entry.id)).not.toContain(
    reservation.id,
  );
});

test("a request may name a bed of its category and the list shows the bed and ward", async () => {
  const hospital = await createHospital("resv-request-bed");

  const { reservation } = await request(hospital, "Bed Request", tomorrow(), {
    bedId: hospital.beds[1].id,
  });

  expect(await find(hospital, reservation.id)).toMatchObject({
    bedLabel: "G-2",
    wardName: "General",
    status: "requested",
  });
});

test("a request without a hold time is valid and has none", async () => {
  const hospital = await createHospital("resv-request-nohold");
  const { holdUntil: _, ...window } = tomorrow();

  const { reservation } = await request(hospital, "No Hold", window);

  expect(await find(hospital, reservation.id)).toMatchObject({
    holdUntil: null,
    effectiveStatus: "requested",
  });
});

test("a request refuses a malformed window, a stale arrival and a bed of another category", async () => {
  const hospital = await createHospital("resv-request-invalid");
  const { api, orgSlug, category, beds, privateBed } = hospital;
  const patient = await registerPatient(api, orgSlug, "Invalid Window");
  const base = { orgSlug, patientId: patient.id, categoryId: category.id };

  await expectORPCCode(
    api.ipd.requestBed({
      ...base,
      plannedArrivalAt: fromNow(2 * DAY),
      plannedDepartureAt: fromNow(DAY),
    }),
    "BAD_REQUEST",
    "departure before arrival",
  );
  const arrival = fromNow(DAY);
  await expectORPCCode(
    api.ipd.requestBed({ ...base, plannedArrivalAt: arrival, plannedDepartureAt: arrival }),
    "BAD_REQUEST",
    "empty window",
  );
  await expectORPCCode(
    api.ipd.requestBed({
      ...base,
      plannedArrivalAt: fromNow(-HOUR),
      plannedDepartureAt: fromNow(DAY),
    }),
    "BAD_REQUEST",
    "arrival an hour ago",
  );
  await expectORPCCode(
    api.ipd.requestBed({ ...base, bedId: privateBed.id, ...tomorrow() }),
    "BAD_REQUEST",
    "bed of another category",
  );
  await expectORPCCode(
    api.ipd.requestBed({ ...base, ...tomorrow(), holdUntil: fromNow(4 * DAY) }),
    "BAD_REQUEST",
    "hold beyond departure",
  );
  await expectORPCCode(
    api.ipd.requestBed({ ...base, ...tomorrow(), holdUntil: fromNow(HOUR) }),
    "BAD_REQUEST",
    "hold before arrival",
  );

  // A desk entry a few minutes late is ordinary.
  const late = await api.ipd.requestBed({
    ...base,
    bedId: beds[0].id,
    plannedArrivalAt: fromNow(-5 * MINUTE),
    plannedDepartureAt: fromNow(DAY),
  });

  expect(late.status).toBe("requested");

  expect((await listed(hospital, "all")).map((entry) => entry.id)).toEqual([late.id]);
});

test("unknown or foreign patient, category or bed is NOT_FOUND", async () => {
  const hospital = await createHospital("resv-request-scope");
  const other = await createHospital("resv-request-other");
  const { api, orgSlug, category } = hospital;
  const patient = await registerPatient(api, orgSlug, "Scoped Patient");
  const foreignPatient = await registerPatient(other.api, other.orgSlug, "Foreign Patient");
  const base = { orgSlug, patientId: patient.id, categoryId: category.id, ...tomorrow() };

  for (const [label, input] of [
    ["unknown patient", { ...base, patientId: "missing" }],
    ["foreign patient", { ...base, patientId: foreignPatient.id }],
    ["unknown category", { ...base, categoryId: "missing" }],
    ["foreign category", { ...base, categoryId: other.category.id }],
    ["unknown bed", { ...base, bedId: "missing" }],
    ["foreign bed", { ...base, bedId: other.beds[0].id }],
  ] as const) {
    await expectORPCCode(api.ipd.requestBed(input), "NOT_FOUND", label);
  }

  expect(await listed(hospital, "all")).toEqual([]);
});

// ── Slice 2: confirm ────────────────────────────────────────────────────────

test("confirming a request holds one bed: arrivals list it and the board shows it as a hold", async () => {
  const hospital = await createHospital("resv-confirm");
  const window = tomorrow();
  const { patient, reservation } = await request(hospital, "Confirmed Patient", window);

  const confirmed = await confirm(hospital, reservation, hospital.beds[0].id);

  expect(confirmed).toMatchObject({
    id: reservation.id,
    status: "confirmed",
    effectiveStatus: "confirmed",
    revision: 1,
    bedLabel: "G-1",
    holdUntil: window.holdUntil,
  });

  const arrivals = await listed(hospital, "arrivals");
  expect(arrivals.map((entry) => entry.id)).toEqual([reservation.id]);
  expect((await listed(hospital, "waitlist")).map((entry) => entry.id)).toEqual([]);

  const bed = await boardBed(hospital, hospital.beds[0].id);
  expect(bed.status).toBe("available");
  expect(bed.admission).toBeNull();
  expect(bed.holds).toEqual([
    {
      reservationId: reservation.id,
      patientName: patient.name,
      plannedArrivalAt: window.plannedArrivalAt,
      plannedDepartureAt: window.plannedDepartureAt,
      holdUntil: window.holdUntil!,
    },
  ]);
  expect((await boardBed(hospital, hospital.beds[1].id)).holds).toEqual([]);
});

test("a hold is refused on an occupied, blocked, inactive or other-category bed and on a stale revision", async () => {
  const hospital = await createHospital("resv-confirm-refused");
  const { api, orgSlug, beds, privateBed } = hospital;
  const { reservation } = await request(hospital, "Refused Hold");

  await admitWalkIn(hospital, beds[0].id, "Occupant");
  await api.ipd.blockBed({ orgSlug, bedId: beds[1].id, reason: "Leaking oxygen port" });
  await api.ipd.setBedActive({ orgSlug, bedId: beds[2].id, active: false });

  await expectORPCCode(confirm(hospital, reservation, beds[0].id), "CONFLICT", "occupied");
  await expectORPCCode(confirm(hospital, reservation, beds[1].id), "CONFLICT", "blocked");
  await expectORPCCode(confirm(hospital, reservation, beds[2].id), "CONFLICT", "inactive");
  await expectORPCCode(confirm(hospital, reservation, privateBed.id), "BAD_REQUEST", "category");

  const freeBed = await api.ipd.createBed({
    orgSlug,
    wardId: hospital.ward.id,
    categoryId: hospital.category.id,
    label: "G-4",
  });

  await expectORPCCode(
    confirm(hospital, { ...reservation, revision: 7 }, freeBed.id),
    "CONFLICT",
    "stale revision",
  );
  await expectORPCCode(
    confirm(hospital, reservation, freeBed.id, fromNow(4 * DAY)),
    "BAD_REQUEST",
    "hold beyond departure",
  );

  expect(await find(hospital, reservation.id)).toMatchObject({
    status: "requested",
    revision: 0,
    bedId: null,
  });
  expect((await boardBed(hospital, freeBed.id)).holds).toEqual([]);
});

test("confirmed holds on one bed cannot overlap, but adjacent windows can", async () => {
  const hospital = await createHospital("resv-confirm-overlap");
  const bedId = hospital.beds[0].id;
  const day = (n: number) => fromNow(n * DAY);

  await hold(hospital, "First Hold", bedId, {
    plannedArrivalAt: day(1),
    plannedDepartureAt: day(3),
    holdUntil: day(2),
  });

  const { reservation: overlapping } = await request(hospital, "Overlapping Hold", {
    plannedArrivalAt: day(2),
    plannedDepartureAt: day(4),
    holdUntil: day(2.5),
  });

  await expectORPCCode(confirm(hospital, overlapping, bedId), "CONFLICT", "overlap");

  const { reservation: adjacent } = await hold(hospital, "Adjacent Hold", bedId, {
    plannedArrivalAt: day(3),
    plannedDepartureAt: day(5),
    holdUntil: day(4),
  });

  expect(adjacent.status).toBe("confirmed");
  expect(await find(hospital, overlapping.id)).toMatchObject({ status: "requested" });
  expect((await boardBed(hospital, bedId)).holds.map((entry) => entry.patientName)).toEqual([
    "first hold",
    "adjacent hold",
  ]);
});

test("a lapsed hold is expired, needs attention, leaves the board and blocks nobody", async () => {
  const hospital = await createHospital("resv-expired");
  const bedId = hospital.beds[0].id;
  const { reservation } = await lapsedHold(hospital, "No Show", bedId);

  expect(await find(hospital, reservation.id)).toMatchObject({
    status: "confirmed",
    effectiveStatus: "expired",
  });
  expect((await listed(hospital, "attention")).map((entry) => entry.id)).toEqual([reservation.id]);
  expect((await listed(hospital, "arrivals")).map((entry) => entry.id)).toEqual([]);
  expect((await boardBed(hospital, bedId)).holds).toEqual([]);

  const { reservation: next } = await hold(hospital, "Next In Line", bedId, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(2 * DAY),
    holdUntil: fromNow(DAY),
  });

  expect(next.effectiveStatus).toBe("confirmed");
});

// ── Slice 3: conversion on arrival ──────────────────────────────────────────

// Arrival is due now: the window began a minute ago and runs two days.
function dueNow(): Window {
  return {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(2 * DAY),
    holdUntil: fromNow(DAY),
  };
}

function convert(
  hospital: Hospital,
  reservation: { id: string; revision: number },
  patientId: string,
  bedId: string,
  extra: { displace?: { reason: string } } = {},
  api = hospital.api,
) {
  return api.ipd.admit({
    orgSlug: hospital.orgSlug,
    patientId,
    practitionerId: hospital.practitioner.id,
    bedId,
    reservationId: reservation.id,
    expectedReservationRevision: reservation.revision,
    ...extra,
  });
}

async function admissionIds(hospital: Hospital) {
  const { items } = await hospital.api.ipd.list({ orgSlug: hospital.orgSlug, state: "all" });

  return items.map((item) => item.id);
}

async function extraBed(hospital: Hospital, label: string) {
  return hospital.api.ipd.createBed({
    orgSlug: hospital.orgSlug,
    wardId: hospital.ward.id,
    categoryId: hospital.category.id,
    label,
  });
}

test("arrival converts the hold into an Admission and an open stay in one step", async () => {
  const hospital = await createHospital("resv-convert");
  const bedId = hospital.beds[0].id;
  const { patient, reservation } = await hold(hospital, "Planned Arrival", bedId, dueNow());

  const admission = await convert(hospital, reservation, patient.id, bedId);

  expect(admission).toMatchObject({
    patientId: patient.id,
    status: "admitted",
    currentBedId: bedId,
  });

  const detail = await hospital.api.ipd.get({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(detail.patient.id).toBe(patient.id);
  expect(detail.stays.map((stay) => [stay.bedId, stay.endedAt])).toEqual([[bedId, null]]);

  expect(await find(hospital, reservation.id)).toMatchObject({
    status: "converted",
    effectiveStatus: "converted",
    admissionId: admission.id,
    revision: reservation.revision + 1,
  });
  expect((await listed(hospital, "arrivals")).map((entry) => entry.id)).toEqual([]);

  const bed = await boardBed(hospital, bedId);
  expect(bed.status).toBe("occupied");
  expect(bed.admission?.id).toBe(admission.id);
  expect(bed.holds).toEqual([]);

  // Consuming a hold is audited like every other change to it.
  expect(await auditEntries(hospital, "ipd.reservation.convert")).toEqual([
    expect.objectContaining({
      actorId: hospital.owner.user.id,
      target: `bed_reservation:${reservation.id}`,
      meta: expect.objectContaining({ admissionId: admission.id, bedId }),
    }),
  ]);
});

test("a refused conversion leaves no Admission, no stay and the reservation unchanged", async () => {
  const hospital = await createHospital("resv-convert-refused");
  const { api, orgSlug, beds } = hospital;
  const bystander = await registerPatient(api, orgSlug, "Bystander");

  const held = await hold(hospital, "Held Patient", beds[0].id, dueNow());
  const later = await hold(hospital, "Tomorrow Patient", beds[1].id);
  const lapsed = await lapsedHold(hospital, "Lapsed Patient", beds[2].id);

  const blockedBed = await extraBed(hospital, "G-4");
  const blocked = await hold(hospital, "Blocked Bed Patient", blockedBed.id, dueNow());
  await api.ipd.blockBed({ orgSlug, bedId: blockedBed.id, reason: "Spill being cleaned" });

  const elsewhereBed = await extraBed(hospital, "G-5");
  const walkInBed = await extraBed(hospital, "G-6");
  const admitted = await hold(hospital, "Already Admitted", elsewhereBed.id, dueNow());
  await api.ipd.admit({
    orgSlug,
    patientId: admitted.patient.id,
    practitionerId: hospital.practitioner.id,
    bedId: walkInBed.id,
  });

  const before = await admissionIds(hospital);

  const attempts = [
    ["wrong patient", held.reservation, bystander.id, beds[0].id],
    ["wrong bed", held.reservation, held.patient.id, blockedBed.id],
    ["stale revision", { ...held.reservation, revision: 0 }, held.patient.id, beds[0].id],
    ["arrival outside the window", later.reservation, later.patient.id, beds[1].id],
    ["lapsed hold", lapsed.reservation, lapsed.patient.id, beds[2].id],
    ["bed blocked at arrival", blocked.reservation, blocked.patient.id, blockedBed.id],
    ["patient already admitted", admitted.reservation, admitted.patient.id, elsewhereBed.id],
  ] as const;

  for (const [label, reservation, patientId, bedId] of attempts) {
    const snapshot = await find(hospital, reservation.id);

    await expectORPCCode(convert(hospital, reservation, patientId, bedId), "CONFLICT", label);

    expect(await find(hospital, reservation.id), label).toEqual(snapshot);
    expect((await boardBed(hospital, bedId)).admission, label).toBeNull();
  }

  expect(await admissionIds(hospital)).toEqual(before);
});

test("two desks converting one hold: exactly one Admission", async () => {
  const hospital = await createHospital("resv-convert-race");
  const bedId = hospital.beds[0].id;
  const { patient, reservation } = await hold(hospital, "Race Arrival", bedId, dueNow());

  const results = await Promise.all(
    [0, 1].map(() => settled(convert(hospital, reservation, patient.id, bedId))),
  );

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });
  expect(await admissionIds(hospital)).toHaveLength(1);
  expect(await find(hospital, reservation.id)).toMatchObject({ status: "converted" });
});

// ── Slice 4: every occupancy and readiness writer respects holds ────────────

function walkIn(
  hospital: Hospital,
  patientId: string,
  bedId: string,
  extra: { displace?: { reason: string } } = {},
  api = hospital.api,
) {
  return api.ipd.admit({
    orgSlug: hospital.orgSlug,
    patientId,
    practitionerId: hospital.practitioner.id,
    bedId,
    ...extra,
  });
}

async function transfer(
  hospital: Hospital,
  admissionId: string,
  bedId: string,
  extra: { displace?: { reason: string } } = {},
  api = hospital.api,
) {
  const { admission } = await hospital.api.ipd.get({ orgSlug: hospital.orgSlug, admissionId });

  return api.ipd.transferBed({
    orgSlug: hospital.orgSlug,
    admissionId,
    expectedRevision: admission.revision,
    bedId,
    ...extra,
  });
}

test("a walk-in or a transfer onto a held bed is refused, even for a hold days away", async () => {
  const hospital = await createHospital("resv-walkin-refused");
  const { api, orgSlug, beds } = hospital;
  const day = (n: number) => fromNow(n * DAY);

  const soon = await hold(hospital, "Tomorrow Hold", beds[0].id);

  const distant = await hold(hospital, "Distant Hold", beds[1].id, {
    plannedArrivalAt: day(5),
    plannedDepartureAt: day(7),
    holdUntil: day(6),
  });

  const inpatient = await admitWalkIn(hospital, beds[2].id, "Moving Patient");
  const walker = await registerPatient(api, orgSlug, "Walk In");
  const before = await admissionIds(hospital);

  for (const held of [soon, distant]) {
    const bedId = held.reservation.bedId!;

    await expectORPCCode(walkIn(hospital, walker.id, bedId), "CONFLICT", "walk-in");
    await expectORPCCode(transfer(hospital, inpatient.admission.id, bedId), "CONFLICT", "transfer");

    expect(await find(hospital, held.reservation.id)).toMatchObject({
      status: "confirmed",
      revision: held.reservation.revision,
    });
    expect((await boardBed(hospital, bedId)).admission).toBeNull();
  }

  expect(await admissionIds(hospital)).toEqual(before);

  const detail = await api.ipd.get({ orgSlug, admissionId: inpatient.admission.id });
  expect(detail.admission).toMatchObject({
    currentBedId: beds[2].id,
    revision: inpatient.admission.revision,
  });
});

test("an owner or admin may displace a hold with a reason; it becomes disrupted and needs attention", async () => {
  const hospital = await createHospital("resv-displace");
  const { api, orgSlug, beds } = hospital;
  const admin = await member(hospital, "resv-displace-admin", "admin");

  const forWalkIn = await hold(hospital, "Displaced By Walk In", beds[0].id);
  const forTransfer = await hold(hospital, "Displaced By Transfer", beds[1].id);
  const inpatient = await admitWalkIn(hospital, beds[2].id, "Urgent Transfer");
  const urgent = await registerPatient(api, orgSlug, "Urgent Walk In");

  const admission = await walkIn(hospital, urgent.id, beds[0].id, {
    displace: { reason: "Emergency admission" },
  });

  expect(admission.currentBedId).toBe(beds[0].id);

  const moved = await transfer(
    hospital,
    inpatient.admission.id,
    beds[1].id,
    { displace: { reason: "Isolation needed" } },
    admin,
  );

  expect(moved.currentBedId).toBe(beds[1].id);

  expect(await find(hospital, forWalkIn.reservation.id)).toMatchObject({
    status: "disrupted",
    effectiveStatus: "disrupted",
    disruptedReason: "Emergency admission",
  });
  expect(await find(hospital, forTransfer.reservation.id)).toMatchObject({
    status: "disrupted",
    disruptedReason: "Isolation needed",
  });

  const attention = (await listed(hospital, "attention")).map((entry) => entry.id);
  expect(attention.sort()).toEqual([forWalkIn.reservation.id, forTransfer.reservation.id].sort());
  expect((await boardBed(hospital, beds[0].id)).holds).toEqual([]);
});

test("reception cannot displace a hold: FORBIDDEN, nothing written, denial audited", async () => {
  const hospital = await createHospital("resv-displace-denied");
  const { api, orgSlug, beds } = hospital;
  const reception = await member(hospital, "resv-displace-reception", "reception");

  const held = await hold(hospital, "Protected Hold", beds[0].id);
  const inpatient = await admitWalkIn(hospital, beds[1].id, "Stays Put");
  const walker = await registerPatient(api, orgSlug, "Turned Away");
  const before = await admissionIds(hospital);
  const deniedBefore = (await auditEntries(hospital, "rbac.permission")).length;
  const displace = { displace: { reason: "Desk override" } };

  await expectORPCCode(
    walkIn(hospital, walker.id, beds[0].id, displace, reception),
    "FORBIDDEN",
    "walk-in",
  );
  await expectORPCCode(
    transfer(hospital, inpatient.admission.id, beds[0].id, displace, reception),
    "FORBIDDEN",
    "transfer",
  );

  expect(await admissionIds(hospital)).toEqual(before);
  expect(await find(hospital, held.reservation.id)).toMatchObject({
    status: "confirmed",
    revision: held.reservation.revision,
  });
  expect((await boardBed(hospital, beds[1].id)).admission?.id).toBe(inpatient.admission.id);
  expect((await auditEntries(hospital, "rbac.permission")).length).toBe(deniedBefore + 2);
});

test("a safety block always lands and disrupts the bed's holds with the block reason", async () => {
  const hospital = await createHospital("resv-block");
  const { api, orgSlug, beds } = hospital;
  const day = (n: number) => fromNow(n * DAY);

  const first = await hold(hospital, "Block First", beds[0].id);

  const second = await hold(hospital, "Block Second", beds[0].id, {
    plannedArrivalAt: day(4),
    plannedDepartureAt: day(6),
    holdUntil: day(5),
  });

  const untouched = await hold(hospital, "Other Bed", beds[1].id);

  const blocked = await api.ipd.blockBed({ orgSlug, bedId: beds[0].id, reason: "Ceiling leak" });
  expect(blocked.blockedReason).toBe("Ceiling leak");

  for (const held of [first, second]) {
    expect(await find(hospital, held.reservation.id)).toMatchObject({
      status: "disrupted",
      disruptedReason: "Ceiling leak",
    });
  }

  expect(await find(hospital, untouched.reservation.id)).toMatchObject({ status: "confirmed" });
  expect((await listed(hospital, "attention")).map((entry) => entry.id).sort()).toEqual(
    [first.reservation.id, second.reservation.id].sort(),
  );
});

test("reception's block keeps the holds confirmed and puts them on the attention list", async () => {
  const hospital = await createHospital("resv-block-reception");
  const { api, orgSlug, beds } = hospital;
  const reception = await member(hospital, "resv-block-reception-desk", "reception");
  const held = await hold(hospital, "Still Held", beds[0].id);

  const blocked = await reception.ipd.blockBed({
    orgSlug,
    bedId: beds[0].id,
    reason: "Spill being cleaned",
  });

  expect(blocked.blockedReason).toBe("Spill being cleaned");
  expect((await boardBed(hospital, beds[0].id)).status).toBe("blocked");
  expect(await find(hospital, held.reservation.id)).toMatchObject({
    status: "confirmed",
    effectiveStatus: "confirmed",
    revision: held.reservation.revision,
    disruptedReason: null,
  });
  expect(
    (await listed(hospital, "attention")).map((entry) => [
      entry.id,
      entry.atRisk,
      entry.atRiskReason,
    ]),
  ).toEqual([[held.reservation.id, true, "blocked"]]);
  expect(await auditEntries(hospital, "ipd.reservation.disrupt")).toEqual([]);

  // Releasing the bed does not free the hold for a walk-in.
  await reception.ipd.releaseBed({
    orgSlug,
    bedId: beds[0].id,
    expectedBlockedAt: blocked.blockedAt!,
  });
  const walker = await registerPatient(api, orgSlug, "Walk In After Release");

  await expectORPCCode(
    walkIn(hospital, walker.id, beds[0].id, {}, reception),
    "CONFLICT",
    "walk-in after release",
  );
  expect(await find(hospital, held.reservation.id)).toMatchObject({
    status: "confirmed",
    revision: held.reservation.revision,
    atRisk: false,
    atRiskReason: null,
  });
  expect((await boardBed(hospital, beds[0].id)).admission).toBeNull();
});

test("a bed with a live hold cannot be taken out of use", async () => {
  const hospital = await createHospital("resv-deactivate");
  const { api, orgSlug, beds } = hospital;
  const held = await hold(hospital, "Keeps The Bed", beds[0].id);

  await expectORPCCode(
    api.ipd.setBedActive({ orgSlug, bedId: beds[0].id, active: false }),
    "CONFLICT",
  );

  expect((await boardBed(hospital, beds[0].id)).holds.map((entry) => entry.reservationId)).toEqual([
    held.reservation.id,
  ]);
});

test("a walk-in and a hold confirmation racing for one free bed: exactly one wins", async () => {
  const hospital = await createHospital("resv-race-walkin");
  const { api, orgSlug, beds } = hospital;
  const bedId = beds[0].id;
  const walker = await registerPatient(api, orgSlug, "Race Walk In");
  const { reservation } = await request(hospital, "Race Hold");

  const [admitted, confirmed] = await Promise.all([
    settled(walkIn(hospital, walker.id, bedId)),
    settled(confirm(hospital, reservation, bedId)),
  ]);

  expect([admitted.ok, confirmed.ok].filter(Boolean)).toHaveLength(1);
  expect([admitted, confirmed].find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });

  const bed = await boardBed(hospital, bedId);

  if (admitted.ok) {
    expect(await find(hospital, reservation.id)).toMatchObject({
      status: "requested",
      revision: 0,
      bedId: null,
    });
    expect(bed.holds).toEqual([]);
  } else {
    expect(await admissionIds(hospital)).toEqual([]);
    expect(bed.admission).toBeNull();
  }
});

test("a conversion is refused while another hold sits on the bed, and succeeds once it moves", async () => {
  const hospital = await createHospital("resv-convert-other-hold");
  const { orgSlug, beds } = hospital;
  const reception = await member(hospital, "resv-convert-other-desk", "reception");
  const bedId = beds[0].id;

  const current = await hold(hospital, "Current Stay", bedId, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(DAY),
    holdUntil: fromNow(HOUR),
  });

  const next = await hold(hospital, "Next Stay", bedId, {
    plannedArrivalAt: fromNow(DAY),
    plannedDepartureAt: fromNow(3 * DAY),
    holdUntil: fromNow(2 * DAY),
  });

  // Open occupancy has no promised end, so the later hold must be resolved first.
  const currentBefore = await find(hospital, current.reservation.id);
  const nextBefore = await find(hospital, next.reservation.id);

  await expectORPCCode(
    convert(hospital, current.reservation, current.patient.id, bedId, {}, reception),
    "CONFLICT",
    "later hold on the bed",
  );

  expect(await admissionIds(hospital)).toEqual([]);
  expect((await boardBed(hospital, bedId)).admission).toBeNull();
  expect(await find(hospital, current.reservation.id)).toEqual(currentBefore);
  expect(await find(hospital, next.reservation.id)).toEqual(nextBefore);

  const moved = await reception.ipd.rescheduleBedReservation({
    orgSlug,
    reservationId: next.reservation.id,
    expectedRevision: next.reservation.revision,
    plannedArrivalAt: next.reservation.plannedArrivalAt,
    plannedDepartureAt: next.reservation.plannedDepartureAt,
    bedId: beds[1].id,
  });

  const admission = await convert(
    hospital,
    current.reservation,
    current.patient.id,
    bedId,
    {},
    reception,
  );

  expect(admission.currentBedId).toBe(bedId);
  expect(await find(hospital, current.reservation.id)).toMatchObject({ status: "converted" });
  expect(await find(hospital, next.reservation.id)).toMatchObject({
    status: "confirmed",
    bedId: beds[1].id,
    revision: moved.revision,
  });
});

test("an owner may convert over another hold with a reason; it is disrupted and audited", async () => {
  const hospital = await createHospital("resv-convert-displace");
  const { beds } = hospital;
  const reception = await member(hospital, "resv-convert-displace-desk", "reception");
  const bedId = beds[0].id;

  const current = await hold(hospital, "Arriving Now", bedId, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(DAY),
    holdUntil: fromNow(HOUR),
  });

  const next = await hold(hospital, "Displaced Later", bedId, {
    plannedArrivalAt: fromNow(DAY),
    plannedDepartureAt: fromNow(3 * DAY),
    holdUntil: fromNow(2 * DAY),
  });

  const displace = { displace: { reason: "Stay extended for treatment" } };

  await expectORPCCode(
    convert(hospital, current.reservation, current.patient.id, bedId, displace, reception),
    "FORBIDDEN",
    "reception cannot displace",
  );

  const admission = await convert(
    hospital,
    current.reservation,
    current.patient.id,
    bedId,
    displace,
  );

  expect(await find(hospital, current.reservation.id)).toMatchObject({
    status: "converted",
    admissionId: admission.id,
  });
  expect(await find(hospital, next.reservation.id)).toMatchObject({
    status: "disrupted",
    disruptedReason: "Stay extended for treatment",
  });
  expect(await auditEntries(hospital, "ipd.reservation.disrupt")).toEqual([
    expect.objectContaining({
      actorId: hospital.owner.user.id,
      target: `bed_reservation:${next.reservation.id}`,
      meta: expect.objectContaining({
        reason: "Stay extended for treatment",
        cause: "ipd.admit",
        bedId,
        admissionId: admission.id,
      }),
    }),
  ]);
});

// ── Slice 5: reschedule, cancel, overstay, audit ────────────────────────────

function reschedule(
  hospital: Hospital,
  reservation: { id: string; revision: number },
  window: Window,
  extra: { bedId?: string } = {},
) {
  return hospital.api.ipd.rescheduleBedReservation({
    orgSlug: hospital.orgSlug,
    reservationId: reservation.id,
    expectedRevision: reservation.revision,
    ...window,
    ...extra,
  });
}

function cancel(hospital: Hospital, reservation: { id: string; revision: number }, reason: string) {
  return hospital.api.ipd.cancelBedReservation({
    orgSlug: hospital.orgSlug,
    reservationId: reservation.id,
    expectedRevision: reservation.revision,
    reason,
  });
}

// Day offsets from one instant, so windows that share a boundary are exactly adjacent.
const DAY_ZERO = Date.now();

function days(from: number, to: number, holdAt: number): Window {
  const at = (n: number) => new Date(DAY_ZERO + n * DAY);

  return { plannedArrivalAt: at(from), plannedDepartureAt: at(to), holdUntil: at(holdAt) };
}

test("rescheduling a request keeps it a request with the new window and bed", async () => {
  const hospital = await createHospital("resv-reschedule-request");
  const { reservation } = await request(hospital, "Moved Request");
  const window = days(2, 4, 2.5);

  const moved = await reschedule(hospital, reservation, window, { bedId: hospital.beds[2].id });

  expect(moved).toMatchObject({
    status: "requested",
    revision: 1,
    bedLabel: "G-3",
    ...window,
  });
  expect((await listed(hospital, "waitlist")).map((entry) => entry.id)).toEqual([reservation.id]);
  await expectORPCCode(reschedule(hospital, reservation, days(3, 5, 4)), "CONFLICT", "stale");
});

test("rescheduling a hold rechecks every conflict and writes nothing when one fails", async () => {
  const hospital = await createHospital("resv-reschedule-hold");
  const { beds } = hospital;

  const moving = await hold(hospital, "Moving Hold", beds[0].id, days(1, 2, 1.5));
  const blocker = await hold(hospital, "Blocking Hold", beds[0].id, days(4, 6, 5));

  const moved = await reschedule(hospital, moving.reservation, days(2, 4, 3));

  expect(moved).toMatchObject({ status: "confirmed", revision: moving.reservation.revision + 1 });

  await expectORPCCode(
    reschedule(hospital, moved, days(3, 5, 4)),
    "CONFLICT",
    "overlaps another hold",
  );
  await expectORPCCode(
    reschedule(hospital, moved, days(-1, 2, 1)),
    "BAD_REQUEST",
    "arrival a day ago",
  );

  expect(await find(hospital, moving.reservation.id)).toMatchObject({
    status: "confirmed",
    revision: moved.revision,
    plannedArrivalAt: moved.plannedArrivalAt,
  });
  expect(await find(hospital, blocker.reservation.id)).toMatchObject({
    revision: blocker.reservation.revision,
  });

  // Onto another free bed of the category, the hold follows.
  const elsewhere = await reschedule(hospital, moved, days(3, 5, 4), { bedId: beds[1].id });

  expect(elsewhere).toMatchObject({ status: "confirmed", bedLabel: "G-2" });
  expect((await boardBed(hospital, beds[0].id)).holds.map((entry) => entry.reservationId)).toEqual([
    blocker.reservation.id,
  ]);
});

test("a hold cannot be rescheduled onto an occupied bed, even for later dates", async () => {
  const hospital = await createHospital("resv-reschedule-occupied");
  const bedId = hospital.beds[0].id;

  const current = await hold(hospital, "Earlier Stay", bedId, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(DAY),
    holdUntil: fromNow(HOUR),
  });

  const next = await hold(hospital, "Later Stay", hospital.beds[1].id, days(1.5, 3, 2));

  await convert(hospital, current.reservation, current.patient.id, bedId);

  await expectORPCCode(
    reschedule(hospital, next.reservation, days(2, 4, 3), { bedId }),
    "CONFLICT",
  );

  expect(await find(hospital, next.reservation.id)).toMatchObject({
    status: "confirmed",
    bedId: hospital.beds[1].id,
    revision: next.reservation.revision,
    plannedArrivalAt: next.reservation.plannedArrivalAt,
  });
});

test("rescheduling a lapsed hold with a future hold time revives it", async () => {
  const hospital = await createHospital("resv-reschedule-lapsed");
  const bedId = hospital.beds[0].id;
  const { reservation } = await lapsedHold(hospital, "Late Arrival", bedId);
  const { holdUntil: _, ...sameDates } = days(1, 3, 2);

  await expectORPCCode(
    reschedule(hospital, reservation, sameDates),
    "BAD_REQUEST",
    "lapsed hold time kept",
  );

  const revived = await reschedule(hospital, reservation, days(1, 3, 2));

  expect(revived).toMatchObject({ status: "confirmed", effectiveStatus: "confirmed" });
  expect((await boardBed(hospital, bedId)).holds.map((entry) => entry.reservationId)).toEqual([
    reservation.id,
  ]);
});

// Arrival just inside the backdate tolerance, which then passes while the test waits.
const TOLERANCE = 10 * MINUTE;

test("a late Patient's hold is extended without moving the planned arrival", async () => {
  const hospital = await createHospital("resv-reschedule-late");
  const bedId = hospital.beds[0].id;
  const arrival = fromNow(-TOLERANCE + 1_500);

  const { reservation } = await hold(hospital, "Running Late", bedId, {
    plannedArrivalAt: arrival,
    plannedDepartureAt: fromNow(DAY),
    holdUntil: fromNow(HOUR),
  });

  await Bun.sleep(arrival.getTime() + TOLERANCE - Date.now() + 100);

  const extended = await reschedule(hospital, reservation, {
    plannedArrivalAt: arrival,
    plannedDepartureAt: fromNow(2 * DAY),
    holdUntil: fromNow(3 * HOUR),
  });

  expect(extended).toMatchObject({
    status: "confirmed",
    effectiveStatus: "confirmed",
    plannedArrivalAt: arrival,
    revision: reservation.revision + 1,
  });

  // Moving the arrival into the past is still refused.
  await expectORPCCode(
    reschedule(hospital, extended, {
      plannedArrivalAt: fromNow(-HOUR),
      plannedDepartureAt: fromNow(2 * DAY),
      holdUntil: fromNow(3 * HOUR),
    }),
    "BAD_REQUEST",
    "arrival moved into the past",
  );
});

test("a request's deadline can be cleared, reviving a lapsed request; a hold keeps one", async () => {
  const hospital = await createHospital("resv-reschedule-deadline");
  const { api, orgSlug, beds } = hospital;

  const { reservation } = await request(hospital, "Lapsed Request", {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(2 * DAY),
    holdUntil: fromNow(1_500),
  });

  await Bun.sleep(reservation.holdUntil!.getTime() - Date.now() + 50);
  expect(await find(hospital, reservation.id)).toMatchObject({ effectiveStatus: "expired" });

  const revived = await api.ipd.rescheduleBedReservation({
    orgSlug,
    reservationId: reservation.id,
    expectedRevision: reservation.revision,
    plannedArrivalAt: reservation.plannedArrivalAt,
    plannedDepartureAt: reservation.plannedDepartureAt,
    holdUntil: null,
  });

  expect(revived).toMatchObject({
    status: "requested",
    effectiveStatus: "requested",
    holdUntil: null,
  });
  expect((await listed(hospital, "waitlist")).map((entry) => entry.id)).toEqual([reservation.id]);

  // Leaving the deadline out keeps what is stored.
  const deadline = fromNow(DAY + 4 * HOUR);

  const { reservation: withDeadline } = await request(hospital, "Keeps Deadline", {
    ...tomorrow(),
    holdUntil: deadline,
  });

  const { holdUntil: _, ...sameWindow } = tomorrow();
  const kept = await reschedule(hospital, withDeadline, sameWindow);

  expect(kept.holdUntil).toEqual(deadline);

  const held = await hold(hospital, "Held Needs Deadline", beds[0].id);

  await expectORPCCode(
    api.ipd.rescheduleBedReservation({
      orgSlug,
      reservationId: held.reservation.id,
      expectedRevision: held.reservation.revision,
      plannedArrivalAt: held.reservation.plannedArrivalAt,
      plannedDepartureAt: held.reservation.plannedDepartureAt,
      holdUntil: null,
    }),
    "BAD_REQUEST",
    "a hold without a deadline",
  );
  expect(await find(hospital, held.reservation.id)).toMatchObject({
    status: "confirmed",
    revision: held.reservation.revision,
  });
});

test("a disrupted hold is confirmed again on another ready bed", async () => {
  const hospital = await createHospital("resv-reconfirm");
  const { api, orgSlug, beds } = hospital;
  const { reservation } = await hold(hospital, "Disrupted Patient", beds[0].id);

  await api.ipd.blockBed({ orgSlug, bedId: beds[0].id, reason: "Broken bed rail" });
  const disrupted = await find(hospital, reservation.id);

  const reconfirmed = await confirm(hospital, disrupted, beds[1].id);

  expect(reconfirmed).toMatchObject({
    status: "confirmed",
    bedLabel: "G-2",
    disruptedReason: null,
    revision: disrupted.revision + 1,
  });
  expect((await listed(hospital, "attention")).map((entry) => entry.id)).toEqual([]);
});

test("cancel works from requested, confirmed, disrupted and lapsed, never from converted or cancelled", async () => {
  const hospital = await createHospital("resv-cancel");
  const { api, orgSlug, beds } = hospital;

  const requested = await request(hospital, "Cancel Requested");
  const confirmed = await hold(hospital, "Cancel Confirmed", beds[0].id);
  const disruptedHold = await hold(hospital, "Cancel Disrupted", beds[1].id);
  await api.ipd.blockBed({ orgSlug, bedId: beds[1].id, reason: "Bed being repaired" });
  const lapsed = await lapsedHold(hospital, "Cancel Lapsed", beds[2].id);

  for (const { reservation } of [requested, confirmed, disruptedHold, lapsed]) {
    const current = await find(hospital, reservation.id);
    const cancelled = await cancel(hospital, current, "Patient chose another hospital");

    expect(cancelled).toMatchObject({
      status: "cancelled",
      effectiveStatus: "cancelled",
      cancelReason: "Patient chose another hospital",
      revision: current.revision + 1,
    });

    await expectORPCCode(cancel(hospital, cancelled, "Again"), "CONFLICT", "already cancelled");
  }

  expect((await boardBed(hospital, beds[0].id)).holds).toEqual([]);

  const arriving = await hold(hospital, "Cancel Converted", beds[0].id, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: fromNow(DAY),
    holdUntil: fromNow(HOUR),
  });

  await convert(hospital, arriving.reservation, arriving.patient.id, beds[0].id);
  const converted = await find(hospital, arriving.reservation.id);

  await expectORPCCode(cancel(hospital, converted, "Too late"), "CONFLICT", "converted");
  expect(await find(hospital, arriving.reservation.id)).toEqual(converted);
});

test("an overstay puts the due hold at risk without moving the occupant", async () => {
  const hospital = await createHospital("resv-overstay");
  const bedId = hospital.beds[0].id;
  const handover = fromNow(3_000);

  const current = await hold(hospital, "Overstaying", bedId, {
    plannedArrivalAt: fromNow(-MINUTE),
    plannedDepartureAt: handover,
    holdUntil: handover,
  });

  const next = await hold(hospital, "Waiting For Bed", hospital.beds[1].id, {
    plannedArrivalAt: handover,
    plannedDepartureAt: fromNow(2 * DAY),
    holdUntil: fromNow(DAY),
  });

  const admission = await convert(hospital, current.reservation, current.patient.id, bedId);

  // No command places a hold on an occupied bed (D064); the read still flags one if it exists.
  await db
    .update(bedReservations)
    .set({ bedId })
    .where(
      and(
        eq(bedReservations.orgId, hospital.organization.id),
        eq(bedReservations.id, next.reservation.id),
      ),
    );

  expect(await find(hospital, next.reservation.id)).toMatchObject({ atRisk: false });

  await Bun.sleep(handover.getTime() - Date.now() + 50);

  const attention = await listed(hospital, "attention");

  expect(
    attention.map((entry) => [entry.id, entry.atRisk, entry.atRiskReason, entry.effectiveStatus]),
  ).toEqual([[next.reservation.id, true, "occupied", "confirmed"]]);
  expect(await find(hospital, next.reservation.id)).toMatchObject({
    status: "confirmed",
    revision: next.reservation.revision,
  });

  const detail = await hospital.api.ipd.get({
    orgSlug: hospital.orgSlug,
    admissionId: admission.id,
  });

  expect(detail.admission).toMatchObject({ status: "admitted", currentBedId: bedId });
});

test("confirm, reschedule, cancel and disrupt are audited with actor and ids", async () => {
  const hospital = await createHospital("resv-audit");
  const { api, orgSlug, beds, owner } = hospital;
  const actorId = owner.user.id;

  const { reservation: requested } = await request(hospital, "Audited Patient");
  const confirmed = await confirm(hospital, requested, beds[0].id);
  const moved = await reschedule(hospital, confirmed, days(2, 4, 3));
  await cancel(hospital, moved, "Family postponed");

  const blockedHold = await hold(hospital, "Blocked Audit", beds[1].id);
  await api.ipd.blockBed({ orgSlug, bedId: beds[1].id, reason: "Mattress torn" });

  const displacedHold = await hold(hospital, "Displaced Audit", beds[2].id);
  const urgent = await registerPatient(api, orgSlug, "Urgent Audit");

  const admission = await walkIn(hospital, urgent.id, beds[2].id, {
    displace: { reason: "Trauma arrival" },
  });

  const target = `bed_reservation:${requested.id}`;

  expect(await auditEntries(hospital, "ipd.reservation.confirm")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actorId,
        target,
        meta: expect.objectContaining({ bedId: beds[0].id }),
      }),
    ]),
  );
  expect(await auditEntries(hospital, "ipd.reservation.reschedule")).toEqual([
    expect.objectContaining({ actorId, target }),
  ]);
  expect(await auditEntries(hospital, "ipd.reservation.cancel")).toEqual([
    expect.objectContaining({
      actorId,
      target,
      meta: expect.objectContaining({ reason: "Family postponed" }),
    }),
  ]);

  const disruptions = await auditEntries(hospital, "ipd.reservation.disrupt");

  expect(disruptions).toHaveLength(2);
  expect(disruptions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actorId,
        target: `bed_reservation:${blockedHold.reservation.id}`,
        meta: expect.objectContaining({
          reason: "Mattress torn",
          cause: "ipd.blockBed",
          bedId: beds[1].id,
        }),
      }),
      expect.objectContaining({
        actorId,
        target: `bed_reservation:${displacedHold.reservation.id}`,
        meta: expect.objectContaining({
          reason: "Trauma arrival",
          cause: "ipd.admit",
          bedId: beds[2].id,
          admissionId: admission.id,
        }),
      }),
    ]),
  );
});

test("the all view pages newest first and returns every reservation exactly once", async () => {
  const hospital = await createHospital("resv-paging");
  const created: string[] = [];

  for (const name of ["Page One", "Page Two", "Page Three", "Page Four", "Page Five"]) {
    created.push((await request(hospital, name)).reservation.id);
  }

  const pages: string[][] = [];
  let cursor: { createdAt: Date; id: string } | undefined;

  do {
    const page = await hospital.api.ipd.listBedReservations({
      orgSlug: hospital.orgSlug,
      view: "all",
      limit: 2,
      cursor,
    });

    pages.push(page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor && pages.length < 10);

  expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
  expect(pages.flat()).toEqual(created.toReversed());
});

// ── Slice 6: tenancy ────────────────────────────────────────────────────────

test("another organization cannot see, confirm, reschedule, cancel or convert a reservation", async () => {
  const hospital = await createHospital("resv-tenant");
  const other = await createHospital("resv-tenant-other");
  const { beds } = hospital;
  const outsider = other.api;
  const claim = { orgSlug: other.orgSlug };

  const held = await hold(hospital, "Private Arrival", beds[0].id, dueNow());
  const { reservation: requested } = await request(hospital, "Private Request");
  const snapshot = await listed(hospital, "all");
  const otherPatient = await registerPatient(outsider, other.orgSlug, "Outsider Patient");

  for (const view of ["arrivals", "waitlist", "attention", "all"] as const) {
    const { items } = await outsider.ipd.listBedReservations({ ...claim, view });

    expect(items, view).toEqual([]);
  }

  const board = await outsider.ipd.bedBoard(claim);

  expect(board.beds.flatMap((bed) => bed.holds)).toEqual([]);

  for (const reservation of [held.reservation, requested]) {
    const target = {
      ...claim,
      reservationId: reservation.id,
      expectedRevision: reservation.revision,
    };

    await expectORPCCode(
      outsider.ipd.confirmBedReservation({
        ...target,
        bedId: other.beds[0].id,
        holdUntil: fromNow(DAY + 4 * HOUR),
      }),
      "CONFLICT",
      "confirm",
    );
    await expectORPCCode(
      outsider.ipd.rescheduleBedReservation({ ...target, ...days(2, 4, 3) }),
      "CONFLICT",
      "reschedule",
    );
    await expectORPCCode(
      outsider.ipd.cancelBedReservation({ ...target, reason: "Not yours" }),
      "CONFLICT",
      "cancel",
    );
  }

  await expectORPCCode(
    outsider.ipd.admit({
      ...claim,
      patientId: otherPatient.id,
      practitionerId: other.practitioner.id,
      bedId: other.beds[0].id,
      reservationId: held.reservation.id,
      expectedReservationRevision: held.reservation.revision,
    }),
    "CONFLICT",
    "convert",
  );

  expect(await listed(hospital, "all")).toEqual(snapshot);
  expect((await outsider.ipd.list({ ...claim, state: "all" })).items).toEqual([]);
});
