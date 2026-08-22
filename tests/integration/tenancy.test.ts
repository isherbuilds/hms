import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import { appRouter, type AppRouterClient } from "@hms/api/routers/index";
import { auth } from "@hms/auth";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  removeFromOrganization,
  setMemberRoles,
} from "../support/auth";
import { clientFor, eventually, expectAuthStatus, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("public email sign-up is disabled", async () => {
  await createTestUser("seed");

  await expectAuthStatus(
    auth.api.signUpEmail({
      body: {
        email: `uninvited-${crypto.randomUUID()}@example.com`,
        name: "uninvited",
        password: "integration-test-password",
      },
    }),
    "BAD_REQUEST",
    "EMAIL_PASSWORD_SIGN_UP_DISABLED",
  );
});

test("settings are scoped by explicit input: defaults until saved, then the saved row", async () => {
  const owner = await createTestUser("settings-pages");
  const organization = await createOrganization(owner, "settings-pages");
  const api = clientFor(owner);

  // A fresh organization answers with defaults; reads never create a row.
  const fresh = await api.settings.get({ orgSlug: organization.slug });
  expect(fresh.currency).toBe("INR");
  expect(fresh.legalName).toBe("");

  const saved = await api.settings.update({
    orgSlug: organization.slug,
    ...fresh,
    legalName: "Settings Pages Hospital Pvt. Ltd.",
    invoicePrefix: "SPH",
  });
  expect(saved.legalName).toBe("Settings Pages Hospital Pvt. Ltd.");

  // The org named in the input is the org written to and read back from.
  expect(await api.settings.get({ orgSlug: organization.slug })).toEqual(saved);

  // Saving settings is a sensitive success and lands in the audit trail.
  const entry = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    return audit.items.find((item) => item.action === "settings.update");
  });
  expect(entry.actorId).toBe(owner.user.id);
  expect(entry.orgId).toBe(organization.id);
});

test("settings are invisible across orgs, and a foreign org is FORBIDDEN", async () => {
  const alice = await createTestUser("alice");
  const alpha = await createOrganization(alice, "alpha");
  const aliceClient = clientFor(alice);
  const alphaDefaults = await aliceClient.settings.get({ orgSlug: alpha.slug });
  await aliceClient.settings.update({
    orgSlug: alpha.slug,
    ...alphaDefaults,
    legalName: "alpha secret",
  });

  const bob = await createTestUser("bob");
  const beta = await createOrganization(bob, "beta");
  const bobClient = clientFor(bob);

  // Beta still sees its own defaults, not alpha's saved row.
  const visible = await bobClient.settings.get({ orgSlug: beta.slug });
  expect(visible.legalName).toBe("");

  // Bob saving beta's settings must not touch alpha's.
  await bobClient.settings.update({ orgSlug: beta.slug, ...visible, legalName: "beta public" });
  const alphaAfter = await aliceClient.settings.get({ orgSlug: alpha.slug });
  expect(alphaAfter.legalName).toBe("alpha secret");

  // Explicitly naming an org you are not a member of fails loud.
  await expectORPCCode(bobClient.settings.get({ orgSlug: alpha.slug }), "FORBIDDEN");
});

test("a foreign org claim cannot write into that tenant's audit trail", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "foreign-claim-audit");
  const visitor = await createTestUser("visitor");

  await expectORPCCode(
    clientFor(visitor).settings.get({ orgSlug: organization.slug }),
    "FORBIDDEN",
  );
  // Draining beats sleeping: a negative assertion behind a fixed interval
  // passes wrongly the moment a reintroduced write lands just after it.
  await drainAuditWrites();

  const audit = await clientFor(owner).audit.list({ orgSlug: organization.slug });
  expect(audit.items.some((entry) => entry.actorId === visitor.user.id)).toBe(false);
});

test("one client can work in different orgs concurrently", async () => {
  const user = await createTestUser("multi");
  const one = await createOrganization(user, "tab-one");
  const two = await createOrganization(user, "tab-two");
  const api = clientFor(user);

  const [inOne, inTwo] = await Promise.all([
    api.settings
      .get({ orgSlug: one.slug })
      .then((s) => api.settings.update({ orgSlug: one.slug, ...s, legalName: "from tab one" })),
    api.settings
      .get({ orgSlug: two.slug })
      .then((s) => api.settings.update({ orgSlug: two.slug, ...s, legalName: "from tab two" })),
  ]);
  expect(inOne.legalName).toBe("from tab one");
  expect(inTwo.legalName).toBe("from tab two");

  const seenInOne = await api.settings.get({ orgSlug: one.slug });
  expect(seenInOne.legalName).toBe("from tab one");
});

test("today's queue and collections are scoped, concurrent, and revoke with membership", async () => {
  const owner = await createTestUser("today-owner");
  const one = await createOrganization(owner, "today-one");
  const two = await createOrganization(owner, "today-two");
  const outsider = await createTestUser("today-visitor");
  const api = clientFor(owner);

  // A appointment and a pending charge in `one` only. `two` stays empty, which is
  // what makes a leak visible rather than merely unlikely.
  const patient = await api.patient.register({
    orgSlug: one.slug,
    name: "Today Patient",
    phone: "5553100",
    sex: "other",
    ageYears: 41,
    address: "Today Address",
  });
  const department = await api.staff.createDepartment({ orgSlug: one.slug, name: "Today Dept" });
  const practitioner = await api.staff.createPractitioner({
    orgSlug: one.slug,
    name: "Dr. Today",
    departmentId: department.id,
  });
  const { appointment } = await api.opd.createWalkIn({
    orgSlug: one.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  const consult = await api.catalog.create({
    orgSlug: one.slug,
    name: "Consultation",
    code: "TODAY-CONSULT",
    category: "consultation",
    unitPrice: "500.00",
    taxRatePercent: "0",
  });
  await api.billing.addCharge({
    orgSlug: one.slug,
    appointmentId: appointment.id,
    catalogItemId: consult.id,
  });

  // Same client, both orgs, concurrently: scope must come from the claim on
  // each call and never from whichever request happened to run first.
  const [todayOne, todayTwo, moneyOne, moneyTwo] = await Promise.all([
    api.dashboard.today({ orgSlug: one.slug }),
    api.dashboard.today({ orgSlug: two.slug }),
    api.dashboard.collections({ orgSlug: one.slug }),
    api.dashboard.collections({ orgSlug: two.slug }),
  ]);

  expect(todayOne.waiting).toBe(1);
  expect(todayOne.mix).toEqual([{ department: "Today Dept", count: 1 }]);
  expect(todayTwo.waiting).toBe(0);
  expect(todayTwo.mix).toEqual([]);

  expect(Number(moneyOne.unbilled)).toBe(500);
  expect(moneyOne.unbilledOpdAppointments).toBe(1);
  expect(Number(moneyTwo.unbilled)).toBe(0);
  expect(moneyTwo.unbilledOpdAppointments).toBe(0);

  // A non-member naming the org is FORBIDDEN, not an empty result.
  const outsiderApi = clientFor(outsider);
  await expectORPCCode(outsiderApi.dashboard.today({ orgSlug: one.slug }), "FORBIDDEN");
  await expectORPCCode(outsiderApi.dashboard.collections({ orgSlug: one.slug }), "FORBIDDEN");

  // And a member loses both on the very next request after removal.
  const member = await createTestUser("today-member");
  await joinOrganization(member, one.id);
  const memberApi = clientFor(member);
  expect((await memberApi.dashboard.today({ orgSlug: one.slug })).waiting).toBe(1);
  await removeFromOrganization(owner, member.user.email, one.id);
  await expectORPCCode(memberApi.dashboard.today({ orgSlug: one.slug }), "FORBIDDEN");
});

test("plain members are denied audit:read, the denial is recorded, and admins see only their org", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "delta");
  const member = await createTestUser("member");
  await joinOrganization(member, organization.id);

  await expectORPCCode(clientFor(member).audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  // Audit writes are fire-and-forget, so poll briefly for the denial entry.
  const ownerClient = clientFor(owner);
  const denial = await eventually(async () => {
    const audit = await ownerClient.audit.list({ orgSlug: organization.slug });
    for (const entry of audit.items) {
      expect(entry.orgId).toBe(organization.id);
    }
    return audit.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === member.user.id,
    );
  });
  expect(denial.denied).toBe(true);
});

test("settings writes are admin-gated while reads are org-wide", async () => {
  const owner = await createTestUser("settings-gate-owner");
  const organization = await createOrganization(owner, "settings-gate");
  const person = await createTestUser("settings-gate-member");
  await joinOrganization(person, organization.id);

  const personClient = clientFor(person);
  const seen = await personClient.settings.get({ orgSlug: organization.slug });
  expect(seen.currency).toBe("INR");

  await expectORPCCode(
    personClient.settings.update({ orgSlug: organization.slug, ...seen, legalName: "denied" }),
    "FORBIDDEN",
  );

  const membership = await clientFor(owner).member.list({ orgSlug: organization.slug });
  const row = membership.members.find((m) => m.userId === person.user.id);
  expect(row).toBeDefined();
  await setMemberRoles(owner, row!.id, ["admin"], organization.id);

  const saved = await personClient.settings.update({
    orgSlug: organization.slug,
    ...seen,
    legalName: "now allowed",
  });
  expect(saved.legalName).toBe("now allowed");
});

test("the audit trail pages by a stable tenant-scoped cursor", async () => {
  const owner = await createTestUser("audit-pages");
  const organization = await createOrganization(owner, "audit-pages");
  const api = clientFor(owner);

  const base = await api.settings.get({ orgSlug: organization.slug });
  for (const legalName of ["one", "two", "three"]) {
    await api.settings.update({ orgSlug: organization.slug, ...base, legalName });
  }
  await drainAuditWrites();

  const first = await api.audit.list({ orgSlug: organization.slug, limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const second = await api.audit.list({
    orgSlug: organization.slug,
    limit: 2,
    cursor: first.nextCursor!,
  });
  expect(second.items).toHaveLength(1);
  const firstIds = first.items.map((entry) => entry.id);
  expect(firstIds).not.toContain(second.items[0]!.id);
});

test("a member,admin holder gets the union of both roles' permissions", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "union");
  const person = await createTestUser("member");
  await joinOrganization(person, organization.id);

  const personClient = clientFor(person);

  // As a plain member, audit:read is denied.
  await expectORPCCode(personClient.audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  const membership = await clientFor(owner).member.list({
    orgSlug: organization.slug,
  });
  const row = membership.members.find((m) => m.userId === person.user.id);
  expect(row).toBeDefined();

  await setMemberRoles(owner, row!.id, ["member", "admin"], organization.id);

  // Reading only the first stored role would leave this denied. The denial
  // logged a moment ago is the proof the log is genuinely readable now.
  const ownDenial = await eventually(async () => {
    const audit = await personClient.audit.list({ orgSlug: organization.slug });
    return audit.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === person.user.id,
    );
  });
  expect(ownDenial.orgId).toBe(organization.id);
  expect(ownDenial.denied).toBe(true);
});

test("an org slug is immutable, so the tenant claim can never be re-pointed", async () => {
  const owner = await createTestUser("slug-lock");
  const organization = await createOrganization(owner, "slug-lock");

  await expectAuthStatus(
    auth.api.updateOrganization({
      body: {
        organizationId: organization.id,
        data: { slug: `${organization.slug}-renamed` },
      },
      headers: owner.headers,
    }),
    "BAD_REQUEST",
  );

  // The original claim still resolves, and the display name is still editable.
  const api = clientFor(owner);
  await api.settings.get({ orgSlug: organization.slug });
  await auth.api.updateOrganization({
    body: { organizationId: organization.id, data: { name: "Renamed" } },
    headers: owner.headers,
  });
  await api.settings.get({ orgSlug: organization.slug });
});

test("an unknown slug is FORBIDDEN, not NOT_FOUND — existence never leaks", async () => {
  const user = await createTestUser("unknown-slug");
  const organization = await createOrganization(user, "unknown-slug");
  const api = clientFor(user);

  // Identical to the code a real-but-foreign org returns, so the two cases are
  // indistinguishable: a caller cannot probe which slugs exist.
  await expectORPCCode(
    api.settings.get({ orgSlug: `absent-${crypto.randomUUID().slice(0, 8)}` }),
    "FORBIDDEN",
  );
  await api.settings.get({ orgSlug: organization.slug });
});

/**
 * Every guarded procedure, with the tenant claim left as a parameter. The table
 * is compared against `appRouter` below, so adding a procedure without adding it
 * here fails the suite rather than going silently uncovered. The three sweeps
 * that follow reuse it to answer, for every procedure at once, the questions a
 * per-domain test would otherwise have to remember to ask: a missing claim, a
 * foreign claim, and a claim from someone whose membership was just revoked.
 */
const GUARDED_CALLS = {
  "dashboard.today": (api, claim) => api.dashboard.today({ ...claim }),
  "dashboard.collections": (api, claim) => api.dashboard.collections({ ...claim }),
  "settings.get": (api, claim) => api.settings.get({ ...claim }),
  "settings.update": (api, claim) =>
    api.settings.update({
      ...claim,
      legalName: "intrusion",
      address: "",
      taxId: "",
      currency: "INR",
      timeZone: "Asia/Kolkata",
      mrnPrefix: "",
      invoicePrefix: "INV",
      receiptPrefix: "RCT",
      creditNotePrefix: "CN",
      fiscalYearStartMonth: 4,
      followUpValidityDays: 14,
    }),
  "audit.list": (api, claim) => api.audit.list({ ...claim }),
  "file.list": (api, claim) => api.file.list({ ...claim }),
  "file.createUpload": (api, claim) =>
    api.file.createUpload({ ...claim, name: "intrusion.txt", size: 1 }),
  "file.finalizeUpload": (api, claim) => api.file.finalizeUpload({ ...claim, key: "k" }),
  "file.getReadUrl": (api, claim) => api.file.getReadUrl({ ...claim, key: "k" }),
  "file.delete": (api, claim) => api.file.delete({ ...claim, key: "k" }),
  "patient.register": (api, claim) =>
    api.patient.register({
      ...claim,
      name: "Intrusion",
      phone: "5550000",
      sex: "other",
      ageYears: 30,
    }),
  "patient.search": (api, claim) => api.patient.search({ ...claim, query: "intrusion" }),
  "patient.get": (api, claim) => api.patient.get({ ...claim, patientId: crypto.randomUUID() }),
  "patient.update": (api, claim) =>
    api.patient.update({
      ...claim,
      patientId: crypto.randomUUID(),
      name: "Intrusion",
      phone: "5550000",
      sex: "other",
      ageYears: 30,
    }),
  "catalog.list": (api, claim) => api.catalog.list({ ...claim }),
  "catalog.create": (api, claim) =>
    api.catalog.create({
      ...claim,
      name: "Intrusion",
      code: `INTR-${crypto.randomUUID().slice(0, 8)}`,
      category: "other",
      unitPrice: "1.00",
      taxRatePercent: "0",
    }),
  "catalog.update": (api, claim) =>
    api.catalog.update({
      ...claim,
      itemId: crypto.randomUUID(),
      name: "Intrusion",
      code: `INTR-${crypto.randomUUID().slice(0, 8)}`,
      category: "other",
      unitPrice: "1.00",
      taxRatePercent: "0",
      active: true,
    }),
  "staff.listDepartments": (api, claim) => api.staff.listDepartments({ ...claim }),
  "staff.createDepartment": (api, claim) =>
    api.staff.createDepartment({ ...claim, name: "Intrusion" }),
  "staff.updateDepartment": (api, claim) =>
    api.staff.updateDepartment({
      ...claim,
      departmentId: crypto.randomUUID(),
      name: "Intrusion",
    }),
  "staff.listPractitioners": (api, claim) => api.staff.listPractitioners({ ...claim }),
  "staff.createPractitioner": (api, claim) =>
    api.staff.createPractitioner({
      ...claim,
      name: "Intrusion",
      departmentId: crypto.randomUUID(),
    }),
  "staff.updatePractitioner": (api, claim) =>
    api.staff.updatePractitioner({
      ...claim,
      practitionerId: crypto.randomUUID(),
      name: "Intrusion",
      departmentId: crypto.randomUUID(),
    }),
  "opd.book": (api, claim) =>
    api.opd.book({
      ...claim,
      callerName: "Intrusion",
      callerPhone: "0000",
      practitionerId: crypto.randomUUID(),
      departmentId: crypto.randomUUID(),
      scheduledLocal: "2026-08-22T10:00",
    }),
  "opd.createWalkIn": (api, claim) =>
    api.opd.createWalkIn({
      ...claim,
      patientId: crypto.randomUUID(),
      practitionerId: crypto.randomUUID(),
      departmentId: crypto.randomUUID(),
    }),
  "opd.checkIn": (api, claim) =>
    api.opd.checkIn({
      ...claim,
      appointmentId: crypto.randomUUID(),
      patientId: crypto.randomUUID(),
    }),
  "opd.reschedule": (api, claim) =>
    api.opd.reschedule({
      ...claim,
      appointmentId: crypto.randomUUID(),
      scheduledLocal: "2026-08-23T10:00",
    }),
  "opd.startConsultation": (api, claim) =>
    api.opd.startConsultation({
      ...claim,
      appointmentId: crypto.randomUUID(),
    }),
  "opd.complete": (api, claim) =>
    api.opd.complete({ ...claim, appointmentId: crypto.randomUUID() }),
  "opd.cancel": (api, claim) =>
    api.opd.cancel({ ...claim, appointmentId: crypto.randomUUID(), reason: "Intrusion" }),
  "opd.markNoShow": (api, claim) =>
    api.opd.markNoShow({ ...claim, appointmentId: crypto.randomUUID() }),
  "opd.markLeftUnseen": (api, claim) =>
    api.opd.markLeftUnseen({
      ...claim,
      appointmentId: crypto.randomUUID(),
      reason: "Intrusion",
    }),
  "opd.queue": (api, claim) => api.opd.queue({ ...claim }),
  "opd.appointments": (api, claim) => api.opd.appointments({ ...claim }),
  "opd.get": (api, claim) => api.opd.get({ ...claim, appointmentId: crypto.randomUUID() }),
  "opd.attachPrescription": (api, claim) =>
    api.opd.attachPrescription({
      ...claim,
      appointmentId: crypto.randomUUID(),
      fileId: crypto.randomUUID(),
    }),
  "opd.detachPrescription": (api, claim) =>
    api.opd.detachPrescription({
      ...claim,
      attachmentId: crypto.randomUUID(),
    }),
  "billing.worklist": (api, claim) => api.billing.worklist({ ...claim }),
  "billing.listPendingCharges": (api, claim) =>
    api.billing.listPendingCharges({ ...claim, appointmentId: crypto.randomUUID() }),
  "billing.addCharge": (api, claim) =>
    api.billing.addCharge({
      ...claim,
      appointmentId: crypto.randomUUID(),
      catalogItemId: crypto.randomUUID(),
    }),
  "billing.voidCharge": (api, claim) =>
    api.billing.voidCharge({
      ...claim,
      chargeId: crypto.randomUUID(),
      reason: "Intrusion",
    }),
  "billing.issueInvoice": (api, claim) =>
    api.billing.issueInvoice({ ...claim, appointmentId: crypto.randomUUID() }),
  "billing.recordPayment": (api, claim) =>
    api.billing.recordPayment({
      ...claim,
      invoiceId: crypto.randomUUID(),
      method: "cash",
      amount: "1.00",
    }),
  "billing.issueCreditNote": (api, claim) =>
    api.billing.issueCreditNote({
      ...claim,
      invoiceId: crypto.randomUUID(),
      reason: "Intrusion",
      lines: [{ invoiceLineId: crypto.randomUUID(), full: true }],
    }),
  "billing.recordRefund": (api, claim) =>
    api.billing.recordRefund({
      ...claim,
      creditNoteId: crypto.randomUUID(),
      method: "cash",
      amount: "1.00",
    }),
  "billing.invoiceBalance": (api, claim) =>
    api.billing.invoiceBalance({ ...claim, invoiceId: crypto.randomUUID() }),
  "billing.listInvoices": (api, claim) =>
    api.billing.listInvoices({ ...claim, appointmentId: crypto.randomUUID() }),
  "billing.getInvoice": (api, claim) =>
    api.billing.getInvoice({ ...claim, invoiceId: crypto.randomUUID() }),
  "report.trialBalance": (api, claim) =>
    api.report.trialBalance({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "report.balanceSheet": (api, claim) => api.report.balanceSheet({ ...claim, asOf: "2024-01-31" }),
  "report.gst": (api, claim) => api.report.gst({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "member.me": (api, claim) => api.member.me({ ...claim }),
  "member.list": (api, claim) => api.member.list({ ...claim }),
  "member.invite": (api, claim) => api.member.invite({ ...claim, email: "x@example.com" }),
  "member.revokeInvitation": (api, claim) =>
    api.member.revokeInvitation({ ...claim, invitationId: "i" }),
  "member.updateRole": (api, claim) =>
    api.member.updateRole({ ...claim, memberId: "m", role: "admin" }),
  "member.remove": (api, claim) => api.member.remove({ ...claim, memberId: "m" }),
} satisfies Record<string, (api: AppRouterClient, claim: { orgSlug: string }) => Promise<unknown>>;

/** The only place a claim is faked away — every entry above stays type-checked. */
const NO_CLAIM = {} as { orgSlug: string };

/** Wide enough to hold everything a fixture just wrote, inside the report period cap. */
function reportRange(): { from: string; to: string } {
  const day = 24 * 60 * 60 * 1_000;
  const now = Date.now();
  return {
    from: new Date(now - 300 * day).toISOString().slice(0, 10),
    to: new Date(now + day).toISOString().slice(0, 10),
  };
}

test("the guarded-call table covers every procedure in the router", () => {
  const procedures = Object.entries(appRouter)
    .flatMap(([namespace, router]) => Object.keys(router).map((name) => `${namespace}.${name}`))
    .sort();

  expect(Object.keys(GUARDED_CALLS).sort()).toEqual(procedures);
});

test("every procedure is FORBIDDEN when an outsider names a foreign org", async () => {
  const owner = await createTestUser("sweep-owner");
  const organization = await createOrganization(owner, "sweep");
  const outsider = await createTestUser("sweep-outsider");
  const api = clientFor(outsider);

  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(api, { orgSlug: organization.slug }), "FORBIDDEN", name);
  }

  // Nothing the outsider did may appear in the tenant's own audit trail.
  await drainAuditWrites();
  const audit = await clientFor(owner).audit.list({ orgSlug: organization.slug });
  expect(audit.items.some((entry) => entry.actorId === outsider.user.id)).toBe(false);
});

test("every procedure rejects a missing org claim as BAD_REQUEST, not FORBIDDEN", async () => {
  const user = await createTestUser("no-claim");
  const api = clientFor(user);

  // Documented in ADR 0002: a missing claim never reaches the permission
  // guard, so it is a validation failure rather than an authorization one. A
  // procedure that dropped `orgInput` would answer FORBIDDEN here — or worse,
  // succeed — so the code, not merely the rejection, is what is asserted.
  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(api, NO_CLAIM), "BAD_REQUEST", name);
  }
});

test("every procedure is FORBIDDEN for a removed member on the very next request", async () => {
  const owner = await createTestUser("revoked-owner");
  const organization = await createOrganization(owner, "revoked");
  const member = await createTestUser("revoked-member");
  await joinOrganization(member, organization.id);

  const memberClient = clientFor(member);
  // Sanity: while a member, org settings are readable. Without this the sweep
  // below would pass just as well against a user who never joined at all.
  const before = await memberClient.settings.get({ orgSlug: organization.slug });
  expect(before.currency).toBe("INR");

  await removeFromOrganization(owner, member.user.email, organization.id);

  // Membership is proven per request, with no cached session claim to outlive
  // the revocation — so reads and writes alike are rejected immediately.
  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(memberClient, { orgSlug: organization.slug }), "FORBIDDEN", name);
  }
});

test("member mutations reject an id belonging to another tenant", async () => {
  const alice = await createTestUser("member-scope-alice");
  const alpha = await createOrganization(alice, "member-scope-alpha");
  const bob = await createTestUser("member-scope-bob");
  const beta = await createOrganization(bob, "member-scope-beta");

  const stranger = await createTestUser("member-scope-stranger");
  await joinOrganization(stranger, alpha.id);
  const [inAlpha] = (await clientFor(alice).member.list({ orgSlug: alpha.slug })).members.filter(
    (row) => row.userId === stranger.user.id,
  );
  expect(inAlpha).toBeDefined();

  // Bob owns beta, so the permission guard passes — only the scoped pre-read
  // stops alpha's member id from reaching Better Auth.
  const bobClient = clientFor(bob);
  await expectORPCCode(
    bobClient.member.updateRole({ orgSlug: beta.slug, memberId: inAlpha!.id, role: "admin" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.member.remove({ orgSlug: beta.slug, memberId: inAlpha!.id }),
    "NOT_FOUND",
  );

  // Alpha's member is untouched.
  const stillThere = (await clientFor(alice).member.list({ orgSlug: alpha.slug })).members;
  expect(stillThere.map((row) => row.userId)).toContain(stranger.user.id);
  expect(stillThere.find((row) => row.userId === stranger.user.id)?.role).toBe("member");
});

test("an invitation id from another tenant cannot be revoked", async () => {
  const alice = await createTestUser("invite-scope-alice");
  const alpha = await createOrganization(alice, "invite-scope-alpha");
  const bob = await createTestUser("invite-scope-bob");
  const beta = await createOrganization(bob, "invite-scope-beta");

  const invited = await clientFor(alice).member.invite({
    orgSlug: alpha.slug,
    email: `scoped-${crypto.randomUUID()}@example.com`,
  });

  await expectORPCCode(
    clientFor(bob).member.revokeInvitation({ orgSlug: beta.slug, invitationId: invited.id }),
    "NOT_FOUND",
  );

  const stillPending = await clientFor(alice).member.list({ orgSlug: alpha.slug });
  expect(stillPending.invitations.map((row) => row.id)).toContain(invited.id);
});

// Per-domain isolation. A missing claim, a foreign claim, and a revoked
// membership are already proven for every procedure by the three GUARDED_CALLS
// sweeps above, so a domain owes only what those sweeps cannot see: that its own
// rows are invisible from another org, and that one client working in two orgs
// at once keeps them apart.

test("patient rows are invisible from another org through search or get", async () => {
  const alice = await createTestUser("patient-scope-alice");
  const alpha = await createOrganization(alice, "patient-scope-alpha");
  const bob = await createTestUser("patient-scope-bob");
  const beta = await createOrganization(bob, "patient-scope-beta");
  const phone = "5551000";
  const patient = await clientFor(alice).patient.register({
    orgSlug: alpha.slug,
    name: "Alpha Patient",
    phone,
    sex: "female",
    ageYears: 42,
  });

  const bobClient = clientFor(bob);
  expect((await bobClient.patient.search({ orgSlug: beta.slug, phone })).items).toHaveLength(0);
  await expectORPCCode(
    bobClient.patient.get({ orgSlug: beta.slug, patientId: patient.id }),
    "NOT_FOUND",
  );
});

test("one client concurrently scopes patient calls to two organizations", async () => {
  const user = await createTestUser("patient-scope-multi");
  const one = await createOrganization(user, "patient-scope-one");
  const two = await createOrganization(user, "patient-scope-two");
  const api = clientFor(user);

  const [inOne, inTwo] = await Promise.all([
    api.patient.register({
      orgSlug: one.slug,
      name: "Patient In One",
      phone: "5551101",
      sex: "male",
      ageYears: 20,
    }),
    api.patient.register({
      orgSlug: two.slug,
      name: "Patient In Two",
      phone: "5551102",
      sex: "female",
      ageYears: 21,
    }),
  ]);
  const [seenInOne, seenInTwo] = await Promise.all([
    api.patient.search({ orgSlug: one.slug }),
    api.patient.search({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.items.map((patient) => patient.id)).toEqual([inOne.id]);
  expect(seenInTwo.items.map((patient) => patient.id)).toEqual([inTwo.id]);
});

test("catalog rows are invisible from another org and cannot be updated by foreign id", async () => {
  const alice = await createTestUser("catalog-scope-alice");
  const alpha = await createOrganization(alice, "catalog-scope-alpha");
  const bob = await createTestUser("catalog-scope-bob");
  const beta = await createOrganization(bob, "catalog-scope-beta");
  const item = await clientFor(alice).catalog.create({
    orgSlug: alpha.slug,
    name: "Alpha Item",
    code: `ALPHA-${crypto.randomUUID().slice(0, 8)}`,
    category: "other",
    unitPrice: "1.00",
    taxRatePercent: "0",
  });

  const bobClient = clientFor(bob);
  expect(await bobClient.catalog.list({ orgSlug: beta.slug })).toEqual([]);
  await expectORPCCode(
    bobClient.catalog.update({
      orgSlug: beta.slug,
      itemId: item.id,
      name: item.name,
      code: item.code,
      category: item.category,
      unitPrice: item.unitPrice,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
      active: item.active,
    }),
    "NOT_FOUND",
  );
});

test("one client concurrently scopes catalog calls to two organizations", async () => {
  const user = await createTestUser("catalog-scope-multi");
  const one = await createOrganization(user, "catalog-scope-one");
  const two = await createOrganization(user, "catalog-scope-two");
  const api = clientFor(user);
  const [inOne, inTwo] = await Promise.all([
    api.catalog.create({
      orgSlug: one.slug,
      name: "Item In One",
      code: `ONE-${crypto.randomUUID().slice(0, 8)}`,
      category: "other",
      unitPrice: "1.00",
      taxRatePercent: "0",
    }),
    api.catalog.create({
      orgSlug: two.slug,
      name: "Item In Two",
      code: `TWO-${crypto.randomUUID().slice(0, 8)}`,
      category: "other",
      unitPrice: "2.00",
      taxRatePercent: "0",
    }),
  ]);
  const [seenInOne, seenInTwo] = await Promise.all([
    api.catalog.list({ orgSlug: one.slug }),
    api.catalog.list({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.map((item) => item.id)).toEqual([inOne.id]);
  expect(seenInTwo.map((item) => item.id)).toEqual([inTwo.id]);
});

test("staff rows are invisible from another org and cannot be updated by foreign id", async () => {
  const alice = await createTestUser("staff-scope-alice");
  const alpha = await createOrganization(alice, "staff-scope-alpha");
  const bob = await createTestUser("staff-scope-bob");
  const beta = await createOrganization(bob, "staff-scope-beta");
  const department = await clientFor(alice).staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha Department",
  });

  const bobClient = clientFor(bob);
  expect(await bobClient.staff.listDepartments({ orgSlug: beta.slug })).toEqual([]);
  await expectORPCCode(
    bobClient.staff.updateDepartment({
      orgSlug: beta.slug,
      departmentId: department.id,
      name: "Foreign Rename",
    }),
    "NOT_FOUND",
  );
});

test("one client concurrently scopes staff calls to two organizations", async () => {
  const user = await createTestUser("staff-scope-multi");
  const one = await createOrganization(user, "staff-scope-one");
  const two = await createOrganization(user, "staff-scope-two");
  const api = clientFor(user);
  const [inOne, inTwo] = await Promise.all([
    api.staff.createDepartment({ orgSlug: one.slug, name: "Department In One" }),
    api.staff.createDepartment({ orgSlug: two.slug, name: "Department In Two" }),
  ]);
  const [seenInOne, seenInTwo] = await Promise.all([
    api.staff.listDepartments({ orgSlug: one.slug }),
    api.staff.listDepartments({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.map((department) => department.id)).toEqual([inOne.id]);
  expect(seenInTwo.map((department) => department.id)).toEqual([inTwo.id]);
});

test("OPD appointment rows are invisible from another org through queue or get", async () => {
  const alice = await createTestUser("opd-scope-alice");
  const alpha = await createOrganization(alice, "opd-scope-alpha");
  const aliceClient = clientFor(alice);
  const patient = await aliceClient.patient.register({
    orgSlug: alpha.slug,
    name: "Alpha OpdAppointment Patient",
    phone: "5552401",
    sex: "other",
    ageYears: 30,
    address: "",
  });
  const department = await aliceClient.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha OpdAppointment Department",
  });
  const practitioner = await aliceClient.staff.createPractitioner({
    orgSlug: alpha.slug,
    name: "Dr. Alpha OpdAppointment",
    departmentId: department.id,
  });
  const created = await aliceClient.opd.createWalkIn({
    orgSlug: alpha.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });

  const bob = await createTestUser("opd-scope-bob");
  const beta = await createOrganization(bob, "opd-scope-beta");
  const bobClient = clientFor(bob);
  expect(await bobClient.opd.queue({ orgSlug: beta.slug })).toEqual({
    items: [],
    nextCursor: null,
  });
  await expectORPCCode(
    bobClient.opd.get({ orgSlug: beta.slug, appointmentId: created.appointment.id }),
    "NOT_FOUND",
  );
});

test("one client concurrently scopes OPD calls to two organizations", async () => {
  const user = await createTestUser("opd-scope-multi");
  const one = await createOrganization(user, "opd-scope-one");
  const two = await createOrganization(user, "opd-scope-two");
  const api = clientFor(user);
  const [patientOne, patientTwo] = await Promise.all([
    api.patient.register({
      orgSlug: one.slug,
      name: "OpdAppointment Patient One",
      phone: "5552402",
      sex: "other",
      ageYears: 30,
      address: "",
    }),
    api.patient.register({
      orgSlug: two.slug,
      name: "OpdAppointment Patient Two",
      phone: "5552403",
      sex: "other",
      ageYears: 30,
      address: "",
    }),
  ]);
  const [departmentOne, departmentTwo] = await Promise.all([
    api.staff.createDepartment({ orgSlug: one.slug, name: "OpdAppointment Department One" }),
    api.staff.createDepartment({ orgSlug: two.slug, name: "OpdAppointment Department Two" }),
  ]);
  const [practitionerOne, practitionerTwo] = await Promise.all([
    api.staff.createPractitioner({
      orgSlug: one.slug,
      name: "Dr. OpdAppointment One",
      departmentId: departmentOne.id,
    }),
    api.staff.createPractitioner({
      orgSlug: two.slug,
      name: "Dr. OpdAppointment Two",
      departmentId: departmentTwo.id,
    }),
  ]);

  const [inOne, inTwo] = await Promise.all([
    api.opd.createWalkIn({
      orgSlug: one.slug,
      patientId: patientOne.id,
      practitionerId: practitionerOne.id,
      departmentId: departmentOne.id,
    }),
    api.opd.createWalkIn({
      orgSlug: two.slug,
      patientId: patientTwo.id,
      practitionerId: practitionerTwo.id,
      departmentId: departmentTwo.id,
    }),
  ]);
  const [seenInOne, seenInTwo] = await Promise.all([
    api.opd.queue({ orgSlug: one.slug }),
    api.opd.queue({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.items.map((appointment) => appointment.id)).toEqual([inOne.appointment.id]);
  expect(seenInTwo.items.map((appointment) => appointment.id)).toEqual([inTwo.appointment.id]);
});

async function createScopedInvoice(
  api: AppRouterClient,
  organization: { slug: string },
  seed: string,
) {
  await api.settings.update({
    orgSlug: organization.slug,
    legalName: `${seed} Hospital`,
    address: `${seed} Address`,
    taxId: "",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "MRN",
    invoicePrefix: "INV",
    receiptPrefix: "RCT",
    creditNotePrefix: "CN",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
  });
  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5553400",
    sex: "other",
    ageYears: 30,
    address: "",
  });
  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
  });
  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: `Dr. ${seed}`,
    departmentId: department.id,
  });
  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    departmentId: department.id,
  });
  const item = await api.catalog.create({
    orgSlug: organization.slug,
    name: `${seed} Charge`,
    code: `SCOPE-${crypto.randomUUID().slice(0, 8)}`,
    category: "other",
    unitPrice: "100.00",
    taxRatePercent: "0",
  });
  await api.billing.addCharge({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
    catalogItemId: item.id,
  });
  const issued = await api.billing.issueInvoice({
    orgSlug: organization.slug,
    appointmentId: created.appointment.id,
  });
  return { appointment: created.appointment, ...issued };
}

test("invoices are invisible from another org through get or list", async () => {
  const alice = await createTestUser("billing-scope-alice");
  const alpha = await createOrganization(alice, "billing-scope-alpha");
  const aliceClient = clientFor(alice);
  const issued = await createScopedInvoice(aliceClient, alpha, "Billing Alpha");
  const bob = await createTestUser("billing-scope-bob");
  const beta = await createOrganization(bob, "billing-scope-beta");
  const bobClient = clientFor(bob);

  await expectORPCCode(
    bobClient.billing.getInvoice({ orgSlug: beta.slug, invoiceId: issued.invoice.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.billing.listInvoices({ orgSlug: beta.slug, appointmentId: issued.appointment.id }),
    "NOT_FOUND",
  );
});

test("one client concurrently scopes billing calls to two organizations", async () => {
  const user = await createTestUser("billing-scope-multi");
  const one = await createOrganization(user, "billing-scope-one");
  const two = await createOrganization(user, "billing-scope-two");
  const api = clientFor(user);
  const [inOne, inTwo] = await Promise.all([
    createScopedInvoice(api, one, "Billing One"),
    createScopedInvoice(api, two, "Billing Two"),
  ]);
  const [seenInOne, seenInTwo] = await Promise.all([
    api.billing.listInvoices({ orgSlug: one.slug, appointmentId: inOne.appointment.id }),
    api.billing.listInvoices({ orgSlug: two.slug, appointmentId: inTwo.appointment.id }),
  ]);

  expect(seenInOne.map((invoice) => invoice.id)).toEqual([inOne.invoice.id]);
  expect(seenInTwo.map((invoice) => invoice.id)).toEqual([inTwo.invoice.id]);
});

test("reports reject a foreign org claim and expose none of that org's figures in a member's own org", async () => {
  const alice = await createTestUser("report-scope-alice");
  const alpha = await createOrganization(alice, "report-scope-alpha");
  await createScopedInvoice(clientFor(alice), alpha, "Report Alpha");

  const betaOwner = await createTestUser("report-scope-beta-owner");
  const beta = await createOrganization(betaOwner, "report-scope-beta");
  const bob = await createTestUser("report-scope-beta-member");
  await joinOrganization(bob, beta.id);
  const bobClient = clientFor(bob);
  const range = reportRange();

  await expectORPCCode(
    bobClient.report.trialBalance({ orgSlug: alpha.slug, ...range }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    bobClient.report.balanceSheet({ orgSlug: alpha.slug, asOf: range.to }),
    "FORBIDDEN",
  );
  await expectORPCCode(bobClient.report.gst({ orgSlug: alpha.slug, ...range }), "FORBIDDEN");

  const [trialBalance, balanceSheet, gst] = await Promise.all([
    bobClient.report.trialBalance({ orgSlug: beta.slug, ...range }),
    bobClient.report.balanceSheet({ orgSlug: beta.slug, asOf: range.to }),
    bobClient.report.gst({ orgSlug: beta.slug, ...range }),
  ]);
  expect(trialBalance.rows).toEqual([]);
  expect(trialBalance.totals).toEqual({
    openingDebit: "0.00",
    openingCredit: "0.00",
    debit: "0.00",
    credit: "0.00",
    closingDebit: "0.00",
    closingCredit: "0.00",
  });
  expect(balanceSheet.assets).toEqual([]);
  expect(balanceSheet.liabilities).toEqual([]);
  expect(balanceSheet.equity).toEqual([]);
  expect(balanceSheet.totals).toEqual({
    assets: "0.00",
    liabilitiesAndEquity: "0.00",
  });
  expect(gst.documents).toEqual([]);
  expect(gst.rateSummary).toEqual([]);
  expect(gst.hsnSummary).toEqual([]);
  expect(gst.totals).toEqual({
    taxableValue: "0.00",
    cgst: "0.00",
    sgst: "0.00",
    taxAmount: "0.00",
    gross: "0.00",
  });
});

test("one client concurrently scopes report calls to two organizations", async () => {
  const user = await createTestUser("report-scope-multi");
  const one = await createOrganization(user, "report-scope-one");
  const two = await createOrganization(user, "report-scope-two");
  const api = clientFor(user);
  const [inOne, inTwo] = await Promise.all([
    createScopedInvoice(api, one, "Report One"),
    createScopedInvoice(api, two, "Report Two"),
  ]);
  await api.billing.recordPayment({
    orgSlug: one.slug,
    invoiceId: inOne.invoice.id,
    method: "cash",
    amount: "40.00",
  });

  const range = reportRange();
  const [trialOne, trialTwo, balanceOne, balanceTwo, gstOne, gstTwo] = await Promise.all([
    api.report.trialBalance({ orgSlug: one.slug, ...range }),
    api.report.trialBalance({ orgSlug: two.slug, ...range }),
    api.report.balanceSheet({ orgSlug: one.slug, asOf: range.to }),
    api.report.balanceSheet({ orgSlug: two.slug, asOf: range.to }),
    api.report.gst({ orgSlug: one.slug, ...range }),
    api.report.gst({ orgSlug: two.slug, ...range }),
  ]);

  expect(trialOne.rows.find((row) => row.code === "1200")?.closingDebit).toBe("60.00");
  expect(trialTwo.rows.find((row) => row.code === "1200")?.closingDebit).toBe("100.00");
  expect(balanceOne.assets.find((row) => row.code === "1000")?.balance).toBe("40.00");
  expect(balanceTwo.assets.some((row) => row.code === "1000")).toBe(false);
  expect(gstOne.documents.map((document) => document.patientName)).toEqual(["Report One Patient"]);
  expect(gstTwo.documents.map((document) => document.patientName)).toEqual(["Report Two Patient"]);
  expect(gstOne.documents.map((document) => document.number)).toEqual([
    inOne.invoice.invoiceNumber,
  ]);
  expect(gstTwo.documents.map((document) => document.number)).toEqual([
    inTwo.invoice.invoiceNumber,
  ]);
});
