import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import { localMinute } from "@hms/api/lib/business-date";
import { appRouter, type AppRouterClient } from "@hms/api/routers/index";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { and, eq } from "drizzle-orm";

import {
  createOrganization,
  createTestUser,
  joinOrganization,
  removeFromOrganization,
  setMemberRoles,
} from "../support/auth";
import { clientFor, eventually, expectAuthStatus, expectORPCCode } from "../support/client";
import { addPendingCatalogCharge } from "../support/billing";
import { resetTestDatabase } from "../support/database";
import { shiftLocalMinute } from "../support/time";
import { uniqueSuffix } from "../support/unique";
import { UNPRICED } from "../support/pharmacy";

const RECEIVED_ON = "2026-09-01";

beforeAll(async () => {
  await resetTestDatabase();
});

test("settings are scoped by explicit input: defaults until saved, then the saved row", async () => {
  const owner = await createTestUser("settings-pages");
  const organization = await createOrganization(owner, "settings-pages");
  const api = clientFor(owner);

  const fresh = await api.settings.get({ orgSlug: organization.slug });
  expect(fresh.currency).toBe("INR");
  expect(fresh.legalName).toBe("");

  await expectORPCCode(
    api.settings.update({ orgSlug: organization.slug, ...fresh, currency: "USD" }),
    "CONFLICT",
  );

  const saved = await api.settings.update({
    orgSlug: organization.slug,
    ...fresh,
    legalName: "Settings Pages Hospital Pvt. Ltd.",
    invoicePrefix: "SPH",
  });

  expect(saved.legalName).toBe("Settings Pages Hospital Pvt. Ltd.");
  expect(saved.currency).toBe("INR");

  expect(await api.settings.get({ orgSlug: organization.slug })).toEqual(saved);
  await expectORPCCode(
    api.settings.update({ orgSlug: organization.slug, ...saved, currency: "EUR" }),
    "CONFLICT",
  );

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

  const visible = await bobClient.settings.get({ orgSlug: beta.slug });
  expect(visible.legalName).toBe("");

  await bobClient.settings.update({ orgSlug: beta.slug, ...visible, legalName: "beta public" });
  const alphaAfter = await aliceClient.settings.get({ orgSlug: alpha.slug });
  expect(alphaAfter.legalName).toBe("alpha secret");

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
  // Drain instead of sleeping so a late write still fails the test.
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
  const settings = await api.settings.get({ orgSlug: one.slug });
  await api.settings.update({
    orgSlug: one.slug,
    ...settings,
    unbilledAlertHours: 1,
  });

  const patient = await api.patient.register({
    orgSlug: one.slug,
    name: "Today Patient",
    phone: "5553100",
    sex: "other",
    dateOfBirth: "1985-08-27",
    dobEstimated: true,
    address: "Today Address",
  });

  const department = await api.staff.createDepartment({ orgSlug: one.slug, name: "Today Dept" });

  const practitioner = await api.staff.createPractitioner({
    orgSlug: one.slug,
    name: "Dr. Today",
    departmentId: department.id,
  });

  const booked = await api.opd.book({
    orgSlug: one.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: "2030-03-15T10:30",
  });

  const { appointment } = await api.opd.checkIn({
    orgSlug: one.slug,
    appointmentId: booked.id,
  });

  const consult = await api.catalog.create({
    orgSlug: one.slug,
    name: "Consultation",
    code: "TODAY-CONSULT",
    category: "other",
    unitPrice: 500_00n,
    taxRatePercent: "0",
  });

  const charge = await addPendingCatalogCharge({
    orgId: one.id,
    userId: owner.user.id,
    appointmentId: appointment.id,
    catalogItemId: consult.id,
  });

  await db
    .update(charges)
    .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(and(eq(charges.orgId, one.id), eq(charges.id, charge.id)));

  const [todayOne, todayTwo, moneyOne, moneyTwo] = await Promise.all([
    api.dashboard.today({ orgSlug: one.slug }),
    api.dashboard.today({ orgSlug: two.slug }),
    api.dashboard.collections({ orgSlug: one.slug }),
    api.dashboard.collections({ orgSlug: two.slug }),
  ]);

  expect(todayOne.checkedIn).toBe(1);
  expect(todayOne.mix).toEqual([{ department: "Today Dept", count: 1 }]);
  expect(todayTwo.checkedIn).toBe(0);
  expect(todayTwo.mix).toEqual([]);

  expect(moneyOne.unbilled).toBe(500_00n);
  expect(moneyTwo.unbilled).toBe(0n);

  const outsiderApi = clientFor(outsider);
  await expectORPCCode(outsiderApi.dashboard.today({ orgSlug: one.slug }), "FORBIDDEN");
  await expectORPCCode(outsiderApi.dashboard.collections({ orgSlug: one.slug }), "FORBIDDEN");

  const member = await createTestUser("today-member");
  await joinOrganization(member, one.id);
  const memberApi = clientFor(member);
  expect((await memberApi.dashboard.today({ orgSlug: one.slug })).checkedIn).toBe(1);
  await removeFromOrganization(owner, member.user.email, one.id);
  await expectORPCCode(memberApi.dashboard.today({ orgSlug: one.slug }), "FORBIDDEN");
});

test("plain members are denied audit:read, the denial is recorded, and admins see only their org", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "delta");
  const member = await createTestUser("member");
  await joinOrganization(member, organization.id);

  await expectORPCCode(clientFor(member).audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

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

  await expectORPCCode(personClient.audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  const membership = await clientFor(owner).member.list({
    orgSlug: organization.slug,
  });

  const row = membership.members.find((m) => m.userId === person.user.id);
  expect(row).toBeDefined();

  await setMemberRoles(owner, row!.id, ["reception", "admin"], organization.id);

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

  await expectORPCCode(api.settings.get({ orgSlug: `absent-${uniqueSuffix()}` }), "FORBIDDEN");
  await api.settings.get({ orgSlug: organization.slug });
});

// Compared against `appRouter` so an unlisted procedure fails the suite.
type OrgClaim = { orgSlug: string };

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
      advanceReceiptPrefix: "ADV",
      creditNotePrefix: "CN",
      pharmacyInvoicePrefix: "PH",
      fiscalYearStartMonth: 4,
      followUpValidityDays: 14,
      unbilledAlertHours: 24,
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
      dateOfBirth: "1996-08-27",
      dobEstimated: true,
    }),
  "patient.search": (api, claim) => api.patient.search({ ...claim, query: "intrusion" }),
  "patient.get": (api, claim) => api.patient.get({ ...claim, patientId: Bun.randomUUIDv7() }),
  "patient.update": (api, claim) =>
    api.patient.update({
      ...claim,
      patientId: Bun.randomUUIDv7(),
      updatedAt: new Date(0).toISOString(),
      name: "Intrusion",
      phone: "5550000",
      sex: "other",
      dateOfBirth: "1996-08-27",
      dobEstimated: true,
    }),
  "patient.visits": (api, claim) => api.patient.visits({ ...claim, patientId: Bun.randomUUIDv7() }),
  "patient.account": (api, claim) =>
    api.patient.account({ ...claim, patientId: Bun.randomUUIDv7() }),
  "catalog.list": (api, claim) => api.catalog.list({ ...claim }),
  "catalog.searchServices": (api, claim) =>
    api.catalog.searchServices({ ...claim, query: "intrusion", includeConsultation: false }),
  "catalog.create": (api, claim) =>
    api.catalog.create({
      ...claim,
      name: "Intrusion",
      code: `INTR-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 1_00n,
      taxRatePercent: "0",
    }),
  "catalog.update": (api, claim) =>
    api.catalog.update({
      ...claim,
      itemId: Bun.randomUUIDv7(),
      name: "Intrusion",
      code: `INTR-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 1_00n,
      customRate: false,
      taxRatePercent: "0",
    }),
  "catalog.setActive": (api, claim) =>
    api.catalog.setActive({ ...claim, itemId: Bun.randomUUIDv7(), active: true }),
  "payer.list": (api, claim) => api.payer.list({ ...claim }),
  "payer.create": (api, claim) =>
    api.payer.create({ ...claim, name: `Intrusion ${uniqueSuffix()}`, type: "insurer" }),
  "payer.update": (api, claim) =>
    api.payer.update({
      ...claim,
      payerId: Bun.randomUUIDv7(),
      name: "Intrusion",
      type: "insurer",
      active: true,
    }),
  "staff.listDepartments": (api, claim) => api.staff.listDepartments({ ...claim }),
  "staff.createDepartment": (api, claim) =>
    api.staff.createDepartment({ ...claim, name: "Intrusion" }),
  "staff.updateDepartment": (api, claim) =>
    api.staff.updateDepartment({
      ...claim,
      departmentId: Bun.randomUUIDv7(),
      name: "Intrusion",
    }),
  "staff.listPractitioners": (api, claim) => api.staff.listPractitioners({ ...claim }),
  "staff.createPractitioner": (api, claim) =>
    api.staff.createPractitioner({
      ...claim,
      name: "Intrusion",
      departmentId: Bun.randomUUIDv7(),
    }),
  "staff.updatePractitioner": (api, claim) =>
    api.staff.updatePractitioner({
      ...claim,
      practitionerId: Bun.randomUUIDv7(),
      name: "Intrusion",
      departmentId: Bun.randomUUIDv7(),
    }),
  "opd.book": (api, claim) =>
    api.opd.book({
      ...claim,
      callerName: "Intrusion",
      callerPhone: "0000",
      practitionerId: Bun.randomUUIDv7(),
      scheduledLocal: "2026-08-22T10:00",
    }),
  "opd.quoteWalkIn": (api, claim) =>
    api.opd.quoteWalkIn({
      ...claim,
      patientId: Bun.randomUUIDv7(),
      practitionerId: Bun.randomUUIDv7(),
    }),
  "opd.createWalkIn": (api, claim) =>
    api.opd.createWalkIn({
      ...claim,
      patientId: Bun.randomUUIDv7(),
      practitionerId: Bun.randomUUIDv7(),
      settlement: {
        expectedGrandTotal: 0n,
        payments: [],
        note: "Guarded-call tenant probe",
      },
    }),
  "opd.checkIn": (api, claim) =>
    api.opd.checkIn({
      ...claim,
      appointmentId: Bun.randomUUIDv7(),
      patientId: Bun.randomUUIDv7(),
    }),
  "opd.reschedule": (api, claim) =>
    api.opd.reschedule({
      ...claim,
      appointmentId: Bun.randomUUIDv7(),
      scheduledLocal: "2026-08-23T10:00",
    }),
  "opd.cancel": (api, claim) =>
    api.opd.cancel({ ...claim, appointmentId: Bun.randomUUIDv7(), reason: "Intrusion" }),
  "opd.markNoShow": (api, claim) =>
    api.opd.markNoShow({ ...claim, appointmentId: Bun.randomUUIDv7() }),
  "opd.day": (api, claim) => api.opd.day({ ...claim }),
  "opd.get": (api, claim) => api.opd.get({ ...claim, appointmentId: Bun.randomUUIDv7() }),
  "opd.attachPrescription": (api, claim) =>
    api.opd.attachPrescription({
      ...claim,
      appointmentId: Bun.randomUUIDv7(),
      fileId: Bun.randomUUIDv7(),
    }),
  "opd.detachPrescription": (api, claim) =>
    api.opd.detachPrescription({
      ...claim,
      attachmentId: Bun.randomUUIDv7(),
    }),
  "billing.worklist": (api, claim) => api.billing.worklist({ ...claim }),
  "billing.advancesHeld": (api, claim) => api.billing.advancesHeld({ ...claim }),
  "billing.refundDue": (api, claim) => api.billing.refundDue({ ...claim }),
  "billing.openInvoices": (api, claim) => api.billing.openInvoices({ ...claim }),
  "billing.voidCharge": (api, claim) =>
    api.billing.voidCharge({
      ...claim,
      chargeId: Bun.randomUUIDv7(),
      reason: "Intrusion",
    }),
  "billing.settleCharges": (api, claim) =>
    api.billing.settleCharges({
      ...claim,
      appointmentId: Bun.randomUUIDv7(),
      expectedChargeRevision: 0,
      expectedGrandTotal: 0n,
      note: "Guarded-call tenant probe",
    }),
  "billing.recordPayments": (api, claim) =>
    api.billing.recordPayments({
      ...claim,
      invoiceId: Bun.randomUUIDv7(),
      payments: [{ method: "cash", amount: 1_00n }],
    }),
  "billing.recordAdvance": (api, claim) =>
    api.billing.recordAdvance({
      ...claim,
      patientId: Bun.randomUUIDv7(),
      method: "cash",
      amount: 1_00n,
    }),
  "billing.recordAdvanceRefund": (api, claim) =>
    api.billing.recordAdvanceRefund({
      ...claim,
      advanceReceiptId: Bun.randomUUIDv7(),
      method: "cash",
      amount: 1_00n,
    }),
  "billing.patientCredit": (api, claim) =>
    api.billing.patientCredit({ ...claim, patientId: Bun.randomUUIDv7() }),
  "billing.getAdvanceReceipt": (api, claim) =>
    api.billing.getAdvanceReceipt({ ...claim, advanceId: Bun.randomUUIDv7() }),
  "billing.issueCreditNote": (api, claim) =>
    api.billing.issueCreditNote({
      ...claim,
      invoiceId: Bun.randomUUIDv7(),
      reason: "Intrusion",
      lines: [{ invoiceLineId: Bun.randomUUIDv7(), full: true }],
    }),
  "billing.recordRefund": (api, claim) =>
    api.billing.recordRefund({
      ...claim,
      creditNoteId: Bun.randomUUIDv7(),
      method: "cash",
      amount: 1_00n,
    }),
  "billing.listInvoices": (api, claim) =>
    api.billing.listInvoices({ ...claim, appointmentId: Bun.randomUUIDv7() }),
  "billing.getInvoice": (api, claim) =>
    api.billing.getInvoice({ ...claim, invoiceId: Bun.randomUUIDv7() }),
  "treatment.create": (api, claim) =>
    api.treatment.create({
      ...claim,
      patientId: Bun.randomUUIDv7(),
      practitionerId: Bun.randomUUIDv7(),
      item: { catalogItemId: Bun.randomUUIDv7(), qtyPlanned: 1 },
    }),
  "treatment.addItem": (api, claim) =>
    api.treatment.addItem({
      ...claim,
      planId: Bun.randomUUIDv7(),
      item: { catalogItemId: Bun.randomUUIDv7(), qtyPlanned: 1 },
    }),
  "treatment.dropItem": (api, claim) =>
    api.treatment.dropItem({ ...claim, itemId: Bun.randomUUIDv7(), reason: "Intrusion" }),
  "treatment.setNextSitting": (api, claim) =>
    api.treatment.setNextSitting({
      ...claim,
      planId: Bun.randomUUIDv7(),
      nextSittingOn: null,
      note: null,
    }),
  "treatment.linkVisit": (api, claim) =>
    api.treatment.linkVisit({
      ...claim,
      planId: Bun.randomUUIDv7(),
      appointmentId: Bun.randomUUIDv7(),
    }),
  "treatment.postToVisit": (api, claim) =>
    api.treatment.postToVisit({
      ...claim,
      itemId: Bun.randomUUIDv7(),
      appointmentId: Bun.randomUUIDv7(),
    }),
  "treatment.complete": (api, claim) =>
    api.treatment.complete({ ...claim, planId: Bun.randomUUIDv7() }),
  "treatment.close": (api, claim) =>
    api.treatment.close({ ...claim, planId: Bun.randomUUIDv7(), reason: "Intrusion" }),
  "treatment.listForPatient": (api, claim) =>
    api.treatment.listForPatient({ ...claim, patientId: Bun.randomUUIDv7() }),
  "treatment.followUps": (api, claim) => api.treatment.followUps({ ...claim }),
  "report.trialBalance": (api, claim) =>
    api.report.trialBalance({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "report.balanceSheet": (api, claim) => api.report.balanceSheet({ ...claim, asOf: "2024-01-31" }),
  "report.gst": (api, claim) => api.report.gst({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "report.dailyCollections": (api, claim) =>
    api.report.dailyCollections({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "report.opdRegister": (api, claim) =>
    api.report.opdRegister({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "member.me": (api, claim) => api.member.me({ ...claim }),
  "member.list": (api, claim) => api.member.list({ ...claim }),
  "member.invite": (api, claim) =>
    api.member.invite({ ...claim, email: "x@example.com", role: "reception" }),
  "member.revokeInvitation": (api, claim) =>
    api.member.revokeInvitation({ ...claim, invitationId: "i" }),
  "member.updateRole": (api, claim) =>
    api.member.updateRole({ ...claim, memberId: "m", role: "admin" }),
  "member.remove": (api, claim) => api.member.remove({ ...claim, memberId: "m" }),
  "pharmacy.createProduct": (api, claim) =>
    api.pharmacy.createProduct({
      ...claim,
      name: "Intrusion",
      catalog: { code: `INTR-${uniqueSuffix()}`, taxRatePercent: "12" },
      stockUnit: "tablet",
      unitsPerPack: 10,
    }),
  "pharmacy.updateProduct": (api, claim) =>
    api.pharmacy.updateProduct({
      ...claim,
      productId: "missing",
      name: "Intrusion",
      catalog: { code: `INTR-${uniqueSuffix()}`, taxRatePercent: "12" },
      stockUnit: "tablet",
      unitsPerPack: 10,
    }),
  "pharmacy.listProducts": (api, claim) => api.pharmacy.listProducts({ ...claim }),
  "pharmacy.searchStock": (api, claim) =>
    api.pharmacy.searchStock({ ...claim, query: "intrusion" }),
  "pharmacy.stockOnHand": (api, claim) => api.pharmacy.stockOnHand({ ...claim }),
  "pharmacy.listMovements": (api, claim) =>
    api.pharmacy.listMovements({ ...claim, batchId: "missing" }),
  "pharmacy.receiveGoods": (api, claim) =>
    api.pharmacy.receiveGoods({
      ...claim,
      supplierName: "Intrusion",
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId: "missing",
          batchNumber: "B1",
          expiryDate: "2030-01",
          mrp: 100n,
          qty: 1,
          cost: UNPRICED,
        },
      ],
    }),
  "pharmacy.adjustStock": (api, claim) =>
    api.pharmacy.adjustStock({
      ...claim,
      batchId: "missing",
      reason: "writeoff",
      qty: 1,
      bucket: "shelf",
      note: "tenancy",
    }),
  "pharmacy.sell": (api, claim) =>
    api.pharmacy.sell({
      ...claim,
      lines: [{ batchId: "missing", qty: 1 }],
      buyer: { name: "walk in" },
      payments: [],
      expectedGrandTotal: 0n,
    }),
  "pharmacy.returnSale": (api, claim) =>
    api.pharmacy.returnSale({
      ...claim,
      saleId: "missing",
      reasonCode: "damaged",
      lines: [{ invoiceLineId: "missing", qty: 1 }],
    }),
  "pharmacy.getSale": (api, claim) => api.pharmacy.getSale({ ...claim, saleId: "missing" }),
  "pharmacy.listSales": (api, claim) => api.pharmacy.listSales({ ...claim }),
} satisfies Record<string, (api: AppRouterClient, claim: OrgClaim) => Promise<object | void>>;

// SAFETY: deliberately empty claim, typed only to reach the procedure signatures.
const NO_CLAIM = {} as OrgClaim;

function reportRange() {
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

  await drainAuditWrites();
  const audit = await clientFor(owner).audit.list({ orgSlug: organization.slug });
  expect(audit.items.some((entry) => entry.actorId === outsider.user.id)).toBe(false);
});

test("every procedure rejects a missing org claim as BAD_REQUEST, not FORBIDDEN", async () => {
  const user = await createTestUser("no-claim");
  const api = clientFor(user);

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
  const before = await memberClient.settings.get({ orgSlug: organization.slug });
  expect(before.currency).toBe("INR");

  await removeFromOrganization(owner, member.user.email, organization.id);

  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(memberClient, { orgSlug: organization.slug }), "FORBIDDEN", name);
  }
});

async function createTreatmentScopeFixture(
  api: AppRouterClient,
  organization: { slug: string },
  seed: string,
) {
  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: `555${uniqueSuffix().slice(-7)}`,
    sex: "other",
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
  });

  const service = await api.catalog.create({
    orgSlug: organization.slug,
    name: `${seed} Service`,
    code: `TREAT-${uniqueSuffix()}`,
    category: "procedure",
    unitPrice: 10_00n,
    taxRatePercent: "0",
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

  const plan = await api.treatment.create({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    item: { catalogItemId: service.id, qtyPlanned: 1 },
  });

  const advance = await api.billing.recordAdvance({
    orgSlug: organization.slug,
    patientId: patient.id,
    treatmentPlanId: plan.id,
    method: "cash",
    amount: 20_00n,
  });

  return { advance, patient, plan };
}

test("treatment plans and advance receipts are invisible by row id and list across organizations", async () => {
  const alice = await createTestUser("treatment-scope-alice");
  const alpha = await createOrganization(alice, "treatment-scope-alpha");
  const alphaRows = await createTreatmentScopeFixture(clientFor(alice), alpha, "Alpha Treatment");
  const bob = await createTestUser("treatment-scope-bob");
  const beta = await createOrganization(bob, "treatment-scope-beta");
  const bobClient = clientFor(bob);

  await expectORPCCode(
    bobClient.treatment.listForPatient({
      orgSlug: beta.slug,
      patientId: alphaRows.patient.id,
    }),
    "NOT_FOUND",
  );
  // A foreign plan id matches no row of beta, so there is nothing for beta to close.
  await expectORPCCode(
    bobClient.treatment.close({
      orgSlug: beta.slug,
      planId: alphaRows.plan.id,
      reason: "Intrusion",
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    bobClient.billing.patientCredit({ orgSlug: beta.slug, patientId: alphaRows.patient.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.billing.getAdvanceReceipt({
      orgSlug: beta.slug,
      advanceId: alphaRows.advance.id,
    }),
    "NOT_FOUND",
  );
  expect((await bobClient.treatment.followUps({ orgSlug: beta.slug })).items).toEqual([]);
  expect((await bobClient.billing.advancesHeld({ orgSlug: beta.slug })).items).toEqual([]);
});

test("one client concurrently scopes treatment and advance calls to two organizations", async () => {
  const owner = await createTestUser("treatment-scope-multi");
  const one = await createOrganization(owner, "treatment-scope-one");
  const two = await createOrganization(owner, "treatment-scope-two");
  const api = clientFor(owner);

  const [inOne, inTwo] = await Promise.all([
    createTreatmentScopeFixture(api, one, "Treatment One"),
    createTreatmentScopeFixture(api, two, "Treatment Two"),
  ]);

  const [planOne, planTwo, creditOne, creditTwo, accountOne, accountTwo, listOne, listTwo] =
    await Promise.all([
      api.treatment.listForPatient({ orgSlug: one.slug, patientId: inOne.patient.id }),
      api.treatment.listForPatient({ orgSlug: two.slug, patientId: inTwo.patient.id }),
      api.billing.patientCredit({ orgSlug: one.slug, patientId: inOne.patient.id }),
      api.billing.patientCredit({ orgSlug: two.slug, patientId: inTwo.patient.id }),
      api.patient.account({ orgSlug: one.slug, patientId: inOne.patient.id }),
      api.patient.account({ orgSlug: two.slug, patientId: inTwo.patient.id }),
      api.treatment.followUps({ orgSlug: one.slug }),
      api.treatment.followUps({ orgSlug: two.slug }),
    ]);

  expect(planOne.map((row) => row.id)).toEqual([inOne.plan.id]);
  expect(planTwo.map((row) => row.id)).toEqual([inTwo.plan.id]);
  expect(creditOne.total).toBe(inOne.advance.amount);
  expect(creditTwo.total).toBe(inTwo.advance.amount);
  expect(accountOne.advanceReceipts.map((row) => row.id)).toEqual([inOne.advance.id]);
  expect(accountTwo.advanceReceipts.map((row) => row.id)).toEqual([inTwo.advance.id]);
  expect(listOne.items.map((row) => row.id)).toEqual([inOne.plan.id]);
  expect(listTwo.items.map((row) => row.id)).toEqual([inTwo.plan.id]);
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

  // Bob owns beta, so only the scoped pre-read stops alpha's member id.
  const bobClient = clientFor(bob);
  await expectORPCCode(
    bobClient.member.updateRole({ orgSlug: beta.slug, memberId: inAlpha!.id, role: "admin" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.member.remove({ orgSlug: beta.slug, memberId: inAlpha!.id }),
    "NOT_FOUND",
  );

  const stillThere = (await clientFor(alice).member.list({ orgSlug: alpha.slug })).members;
  expect(stillThere.map((row) => row.userId)).toContain(stranger.user.id);
  expect(stillThere.find((row) => row.userId === stranger.user.id)?.role).toBe("reception");
});

test("an invitation id from another tenant cannot be revoked", async () => {
  const alice = await createTestUser("invite-scope-alice");
  const alpha = await createOrganization(alice, "invite-scope-alpha");
  const bob = await createTestUser("invite-scope-bob");
  const beta = await createOrganization(bob, "invite-scope-beta");

  const invited = await clientFor(alice).member.invite({
    orgSlug: alpha.slug,
    email: `scoped-${Bun.randomUUIDv7()}@example.com`,
    role: "reception",
  });

  await expectORPCCode(
    clientFor(bob).member.revokeInvitation({ orgSlug: beta.slug, invitationId: invited.id }),
    "NOT_FOUND",
  );

  const stillPending = await clientFor(alice).member.list({ orgSlug: alpha.slug });
  expect(stillPending.invitations.map((row) => row.id)).toContain(invited.id);
});

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
    dateOfBirth: "1984-08-27",
    dobEstimated: true,
  });

  const bobClient = clientFor(bob);
  expect((await bobClient.patient.search({ orgSlug: beta.slug, phone })).items).toHaveLength(0);
  await expectORPCCode(
    bobClient.patient.get({ orgSlug: beta.slug, patientId: patient.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.patient.visits({ orgSlug: beta.slug, patientId: patient.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.patient.account({ orgSlug: beta.slug, patientId: patient.id }),
    "NOT_FOUND",
  );

  const aliceClient = clientFor(alice);

  const [visits, account] = await Promise.all([
    aliceClient.patient.visits({ orgSlug: alpha.slug, patientId: patient.id }),
    aliceClient.patient.account({ orgSlug: alpha.slug, patientId: patient.id }),
  ]);

  expect(visits.items).toHaveLength(0);
  expect(account.invoices).toHaveLength(0);
  expect(account.outstanding).toBe(0n);
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
      dateOfBirth: "2006-08-27",
      dobEstimated: true,
    }),
    api.patient.register({
      orgSlug: two.slug,
      name: "Patient In Two",
      phone: "5551102",
      sex: "female",
      dateOfBirth: "2005-08-27",
      dobEstimated: true,
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
    code: `ALPHA-${uniqueSuffix()}`,
    category: "other",
    unitPrice: 1_00n,
    taxRatePercent: "0",
  });

  const bobClient = clientFor(bob);
  expect((await bobClient.catalog.list({ orgSlug: beta.slug })).items).toEqual([]);
  await expectORPCCode(
    bobClient.catalog.update({
      orgSlug: beta.slug,
      itemId: item.id,
      name: item.name,
      code: item.code,
      category: item.category,
      unitPrice: item.unitPrice,
      customRate: false,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.catalog.setActive({ orgSlug: beta.slug, itemId: item.id, active: false }),
    "NOT_FOUND",
  );
});

test("pharmacy stock is invisible from another org", async () => {
  const alice = await createTestUser("pharmacy-scope-alice");
  const alpha = await createOrganization(alice, "pharmacy-scope-alpha");
  const bob = await createTestUser("pharmacy-scope-bob");
  const beta = await createOrganization(bob, "pharmacy-scope-beta");

  const aliceClient = clientFor(alice);

  const product = await aliceClient.pharmacy.createProduct({
    orgSlug: alpha.slug,
    name: "Alpha Tablet",
    catalog: { code: `ALPHA-${uniqueSuffix()}`, taxRatePercent: "12" },
    stockUnit: "tablet",
    unitsPerPack: 10,
  });

  const receipt = await aliceClient.pharmacy.receiveGoods({
    orgSlug: alpha.slug,
    supplierName: "Alpha Supplier",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "ALPHA-B1",
        expiryDate: "2030-01",
        mrp: 100n,
        qty: 5,
        cost: UNPRICED,
      },
    ],
  });

  const [batch] = receipt.batches;

  if (!batch) throw new Error("the receipt returned no batch");

  const bobClient = clientFor(bob);

  expect(
    (await bobClient.pharmacy.stockOnHand({ orgSlug: beta.slug, productId: product.productId }))
      .items,
  ).toEqual([]);
  await expectORPCCode(
    bobClient.pharmacy.listMovements({ orgSlug: beta.slug, batchId: batch.batchId }),
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
      code: `ONE-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 1_00n,
      taxRatePercent: "0",
    }),
    api.catalog.create({
      orgSlug: two.slug,
      name: "Item In Two",
      code: `TWO-${uniqueSuffix()}`,
      category: "other",
      unitPrice: 2_00n,
      taxRatePercent: "0",
    }),
  ]);

  const [seenInOne, seenInTwo] = await Promise.all([
    api.catalog.list({ orgSlug: one.slug }),
    api.catalog.list({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.items.map((item) => item.id)).toEqual([inOne.id]);
  expect(seenInTwo.items.map((item) => item.id)).toEqual([inTwo.id]);
});

test("payer access stays tenant-scoped across concurrency, foreign claims, and revocation", async () => {
  const owner = await createTestUser("payer-scope-owner");
  const one = await createOrganization(owner, "payer-scope-one");
  const two = await createOrganization(owner, "payer-scope-two");
  const api = clientFor(owner);

  const [inOne, inTwo] = await Promise.all([
    api.payer.create({ orgSlug: one.slug, name: "Alpha Health", type: "insurer" }),
    api.payer.create({ orgSlug: two.slug, name: "Beta Corporate", type: "corporate" }),
  ]);

  const [seenInOne, seenInTwo] = await Promise.all([
    api.payer.list({ orgSlug: one.slug }),
    api.payer.list({ orgSlug: two.slug }),
  ]);

  expect(seenInOne.map((payer) => payer.id)).toEqual([inOne.id]);
  expect(seenInTwo.map((payer) => payer.id)).toEqual([inTwo.id]);

  await expectORPCCode(
    api.payer.update({
      orgSlug: two.slug,
      payerId: inOne.id,
      name: "Foreign Rename",
      type: "insurer",
      active: true,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.payer.create({ orgSlug: one.slug, name: "Alpha Health", type: "scheme" }),
    "CONFLICT",
  );

  const receptionist = await createTestUser("payer-scope-reception");
  await joinOrganization(receptionist, one.id);
  const receptionApi = clientFor(receptionist);
  expect((await receptionApi.payer.list({ orgSlug: one.slug })).map((payer) => payer.id)).toEqual([
    inOne.id,
  ]);
  await expectORPCCode(
    receptionApi.payer.create({ orgSlug: one.slug, name: "Desk Payer", type: "tpa" }),
    "FORBIDDEN",
  );
  await expectORPCCode(receptionApi.payer.list({ orgSlug: two.slug }), "FORBIDDEN");

  await removeFromOrganization(owner, receptionist.user.email, one.id);
  await expectORPCCode(receptionApi.payer.list({ orgSlug: one.slug }), "FORBIDDEN");
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
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: "",
  });

  const fee = await aliceClient.catalog.create({
    orgSlug: alpha.slug,
    name: "Alpha consultation",
    code: `ALPHA-CONSULT-${uniqueSuffix()}`,
    category: "consultation",
    unitPrice: 100_00n,
    taxRatePercent: "0",
  });

  const department = await aliceClient.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha OpdAppointment Department",
  });

  const practitioner = await aliceClient.staff.createPractitioner({
    orgSlug: alpha.slug,
    name: "Dr. Alpha OpdAppointment",
    departmentId: department.id,
    consultFeeItemId: fee.id,
  });

  const currentMinute = localMinute(
    new Date(),
    (await aliceClient.settings.get({ orgSlug: alpha.slug })).timeZone,
  );

  const created = await aliceClient.opd.createWalkIn({
    orgSlug: alpha.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement: {
      expectedGrandTotal: 100_00n,
      payments: [],
      note: "Tenant visibility probe",
    },
  });

  const pastBooking = await aliceClient.opd.book({
    orgSlug: alpha.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    scheduledLocal: shiftLocalMinute(currentMinute, 1),
  });

  const bob = await createTestUser("opd-scope-bob");
  const beta = await createOrganization(bob, "opd-scope-beta");
  const bobClient = clientFor(bob);
  expect(
    await bobClient.opd.day({
      orgSlug: beta.slug,
      from: "2026-08-22",
      to: "2026-08-22",
      q: patient.name,
      includeClosed: true,
    }),
  ).toEqual({ items: [], nextCursor: null });
  expect(
    (await aliceClient.opd.get({ orgSlug: alpha.slug, appointmentId: pastBooking.id })).appointment
      .status,
  ).toBe("booked");
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
      dateOfBirth: "1996-08-27",
      dobEstimated: true,
      address: "",
    }),
    api.patient.register({
      orgSlug: two.slug,
      name: "OpdAppointment Patient Two",
      phone: "5552403",
      sex: "other",
      dateOfBirth: "1996-08-27",
      dobEstimated: true,
      address: "",
    }),
  ]);

  const [feeOne, feeTwo] = await Promise.all([
    api.catalog.create({
      orgSlug: one.slug,
      name: "Organization One Consultation",
      code: `ONE-CONSULT-${uniqueSuffix()}`,
      category: "consultation",
      unitPrice: 100_00n,
      taxRatePercent: "0",
    }),
    api.catalog.create({
      orgSlug: two.slug,
      name: "Organization Two Consultation",
      code: `TWO-CONSULT-${uniqueSuffix()}`,
      category: "consultation",
      unitPrice: 100_00n,
      taxRatePercent: "0",
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
      consultFeeItemId: feeOne.id,
    }),
    api.staff.createPractitioner({
      orgSlug: two.slug,
      name: "Dr. OpdAppointment Two",
      departmentId: departmentTwo.id,
      consultFeeItemId: feeTwo.id,
    }),
  ]);

  const [inOne, inTwo] = await Promise.all([
    api.opd.createWalkIn({
      orgSlug: one.slug,
      patientId: patientOne.id,
      practitionerId: practitionerOne.id,
      settlement: {
        expectedGrandTotal: 100_00n,
        payments: [{ method: "cash", amount: 100_00n }],
      },
    }),
    api.opd.createWalkIn({
      orgSlug: two.slug,
      patientId: patientTwo.id,
      practitionerId: practitionerTwo.id,
      settlement: {
        expectedGrandTotal: 100_00n,
        payments: [{ method: "cash", amount: 100_00n }],
      },
    }),
  ]);

  const [seenInOne, seenInTwo] = await Promise.all([
    api.opd.day({ orgSlug: one.slug }),
    api.opd.day({ orgSlug: two.slug }),
  ]);

  if (!inOne.invoice || !inTwo.invoice) throw new Error("Expected walk-ins to issue invoices");

  expect(seenInOne.items.map((appointment) => appointment.id)).toEqual([inOne.appointment.id]);
  expect(seenInTwo.items.map((appointment) => appointment.id)).toEqual([inTwo.appointment.id]);
  expect(inOne.appointment.tokenNumber).toBe(1);
  expect(inTwo.appointment.tokenNumber).toBe(1);
  expect(inOne.invoice.invoiceNumber.endsWith("/1")).toBe(true);
  expect(inTwo.invoice.invoiceNumber.endsWith("/1")).toBe(true);
  expect(inOne.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);
  expect(inTwo.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);
});

async function createScopedInvoice(
  api: AppRouterClient,
  organization: { slug: string },
  seed: string,
  settlement: Parameters<AppRouterClient["opd"]["createWalkIn"]>[0]["settlement"] = {
    expectedGrandTotal: 100_00n,
    payments: [{ method: "cash", amount: 100_00n }],
  },
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
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    pharmacyInvoicePrefix: "PH",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 24,
  });

  const patient = await api.patient.register({
    orgSlug: organization.slug,
    name: `${seed} Patient`,
    phone: "5553400",
    sex: "other",
    dateOfBirth: "1996-08-27",
    dobEstimated: true,
    address: "",
  });

  const fee = await api.catalog.create({
    orgSlug: organization.slug,
    name: `${seed} Consultation`,
    code: `SCOPE-${uniqueSuffix()}`,
    category: "consultation",
    unitPrice: 100_00n,
    taxRatePercent: "0",
  });

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: `${seed} Department`,
  });

  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: `Dr. ${seed}`,
    departmentId: department.id,
    consultFeeItemId: fee.id,
  });

  const created = await api.opd.createWalkIn({
    orgSlug: organization.slug,
    patientId: patient.id,
    practitionerId: practitioner.id,
    settlement,
  });

  if (!created.invoice) throw new Error("Expected walk-in to issue an invoice");

  return {
    appointment: created.appointment,
    invoice: created.invoice,
    payments: created.payments,
  };
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
  expect(inOne.appointment.tokenNumber).toBe(1);
  expect(inTwo.appointment.tokenNumber).toBe(1);
  expect(inOne.invoice.invoiceNumber.endsWith("/1")).toBe(true);
  expect(inTwo.invoice.invoiceNumber.endsWith("/1")).toBe(true);
  expect(inOne.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);
  expect(inTwo.payments[0]!.receiptNumber.endsWith("/1")).toBe(true);
});

test("reports reject a foreign org claim and expose none of that org's figures in a member's own org", async () => {
  const alice = await createTestUser("report-scope-alice");
  const alpha = await createOrganization(alice, "report-scope-alpha");
  await createScopedInvoice(clientFor(alice), alpha, "Report Alpha");

  const betaOwner = await createTestUser("report-scope-beta-owner");
  const beta = await createOrganization(betaOwner, "report-scope-beta");
  const bob = await createTestUser("report-scope-beta-member");
  await joinOrganization(bob, beta.id, "accountant");
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
    openingDebit: 0n,
    openingCredit: 0n,
    debit: 0n,
    credit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  });
  expect(balanceSheet.assets).toEqual([]);
  expect(balanceSheet.liabilities).toEqual([]);
  expect(balanceSheet.equity).toEqual([]);
  expect(balanceSheet.totals).toEqual({
    assets: 0n,
    liabilitiesAndEquity: 0n,
  });
  expect(gst.documents).toEqual([]);
  expect(gst.rateSummary).toEqual([]);
  expect(gst.hsnSummary).toEqual([]);
  expect(gst.totals).toEqual({
    taxableValue: 0n,
    cgst: 0n,
    sgst: 0n,
    taxAmount: 0n,
    gross: 0n,
  });
});

test("cashiers can close a shift without gaining financial reports", async () => {
  const owner = await createTestUser("report-cashier-owner");
  const organization = await createOrganization(owner, "report-cashier");
  const cashier = await createTestUser("report-cashier");
  await joinOrganization(cashier, organization.id, "cashier");
  const api = clientFor(cashier);
  const today = new Date().toISOString().slice(0, 10);

  expect(
    (await api.report.dailyCollections({ orgSlug: organization.slug, from: today, to: today }))
      .rows,
  ).toEqual([]);
  await expectORPCCode(
    api.report.opdRegister({ orgSlug: organization.slug, from: today, to: today }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    api.report.trialBalance({ orgSlug: organization.slug, ...reportRange() }),
    "FORBIDDEN",
  );
});

test("one client concurrently scopes report calls to two organizations", async () => {
  const user = await createTestUser("report-scope-multi");
  const one = await createOrganization(user, "report-scope-one");
  const two = await createOrganization(user, "report-scope-two");
  const api = clientFor(user);

  const unpaid = {
    expectedGrandTotal: 100_00n,
    payments: [],
    note: "Settle at the counter",
  };

  const [inOne, inTwo] = await Promise.all([
    createScopedInvoice(api, one, "Report One", unpaid),
    createScopedInvoice(api, two, "Report Two", unpaid),
  ]);

  await api.billing.recordPayments({
    orgSlug: one.slug,
    invoiceId: inOne.invoice.id,
    payments: [{ method: "cash", amount: 40_00n }],
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

  expect(trialOne.rows.find((row) => row.code === "1200")?.closingDebit).toBe(60_00n);
  expect(trialTwo.rows.find((row) => row.code === "1200")?.closingDebit).toBe(100_00n);
  expect(balanceOne.assets.find((row) => row.code === "1000")?.balance).toBe(40_00n);
  expect(balanceTwo.assets.some((row) => row.code === "1000")).toBe(false);
  expect(gstOne.documents.map((document) => document.patientName)).toEqual(["report one patient"]);
  expect(gstTwo.documents.map((document) => document.patientName)).toEqual(["report two patient"]);
  expect(gstOne.documents.map((document) => document.number)).toEqual([
    inOne.invoice.invoiceNumber,
  ]);
  expect(gstTwo.documents.map((document) => document.number)).toEqual([
    inTwo.invoice.invoiceNumber,
  ]);
});
