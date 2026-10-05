import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
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
import { uniqueSuffix } from "../support/unique";
import { UNPRICED } from "../support/pharmacy";

const RECEIVED_ON = "2026-09-01";

beforeAll(async () => {
  await resetTestDatabase();
});

test("settings are scoped by explicit input and stay invisible to another org", async () => {
  const owner = await createTestUser("settings-pages");
  const organization = await createOrganization(owner, "settings-pages");
  const api = clientFor(owner);

  const fresh = await api.settings.get({ orgSlug: organization.slug });
  expect(fresh.currency).toBe("INR");
  expect(fresh.legalName).toBe("");

  const saved = await api.settings.update({
    orgSlug: organization.slug,
    ...fresh,
    legalName: "Settings Pages Hospital Pvt. Ltd.",
  });

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

  const bob = await createTestUser("settings-other");
  const other = await createOrganization(bob, "settings-other");
  const bobClient = clientFor(bob);
  const visible = await bobClient.settings.get({ orgSlug: other.slug });
  expect(visible.legalName).toBe("");

  await bobClient.settings.update({ orgSlug: other.slug, ...visible, legalName: "other public" });
  expect((await api.settings.get({ orgSlug: organization.slug })).legalName).toBe(saved.legalName);
});

test("desk money and dashboard collections are scoped, concurrent, and revoke with membership", async () => {
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

  const [moneyOne, moneyTwo, toBillOne, toBillTwo] = await Promise.all([
    api.billing.worklist({ orgSlug: one.slug }),
    api.billing.worklist({ orgSlug: two.slug }),
    api.billing.toBill({ orgSlug: one.slug }),
    api.billing.toBill({ orgSlug: two.slug }),
  ]);

  expect(moneyOne.summary.toBillTotal).toBe(500_00n);
  expect(moneyTwo.summary.toBillTotal).toBe(0n);
  expect(toBillOne).toEqual({ count: 1, total: 500_00n });
  expect(toBillTwo).toEqual({ count: 0, total: 0n });
  // A range keeps only that period's visits; the charge's visit is today.
  expect(
    await api.billing.toBill({ orgSlug: one.slug, from: "2020-01-01", to: "2020-01-07" }),
  ).toEqual({
    count: 0,
    total: 0n,
  });

  const outsiderApi = clientFor(outsider);
  await expectORPCCode(outsiderApi.dashboard.collections({ orgSlug: one.slug }), "FORBIDDEN");

  const member = await createTestUser("today-member");
  await joinOrganization(member, one.id);
  const memberApi = clientFor(member);
  expect((await memberApi.dashboard.collections({ orgSlug: one.slug })).collected).toBe(0n);
  await removeFromOrganization(owner, member.user.email, one.id);
  await expectORPCCode(memberApi.dashboard.collections({ orgSlug: one.slug }), "FORBIDDEN");
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

test("a reception,admin holder gets the union of both roles, and earlier denials stay recorded in that org", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "union");
  const person = await createTestUser("member");
  await joinOrganization(person, organization.id);

  const personClient = clientFor(person);
  const seen = await personClient.settings.get({ orgSlug: organization.slug });
  expect(seen.currency).toBe("INR");

  await expectORPCCode(
    personClient.settings.update({ orgSlug: organization.slug, ...seen, legalName: "denied" }),
    "FORBIDDEN",
  );
  await expectORPCCode(personClient.audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  const membership = await clientFor(owner).member.list({
    orgSlug: organization.slug,
  });

  const row = membership.members.find((m) => m.userId === person.user.id);
  expect(row).toBeDefined();

  await setMemberRoles(owner, row!.id, ["reception", "admin"], organization.id);

  const saved = await personClient.settings.update({
    orgSlug: organization.slug,
    ...seen,
    legalName: "now allowed",
  });

  expect(saved.legalName).toBe("now allowed");

  const ownDenial = await eventually(async () => {
    const audit = await personClient.audit.list({ orgSlug: organization.slug });

    for (const entry of audit.items) {
      expect(entry.orgId).toBe(organization.id);
    }

    return audit.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === person.user.id,
    );
  });

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
  "dashboard.queue": (api, claim) => api.dashboard.queue({ ...claim }),
  "dashboard.collections": (api, claim) => api.dashboard.collections({ ...claim }),
  "dashboard.trend": (api, claim) => api.dashboard.trend({ ...claim }),
  "settings.get": (api, claim) => api.settings.get({ ...claim }),
  "settings.update": (api, claim) =>
    api.settings.update({
      ...claim,
      legalName: "intrusion",
      address: "",
      taxId: "",
      gstin: "",
      drugLicence20: "",
      drugLicence21: "",
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
      category: "other",
      unitPrice: 1_00n,
      taxRatePercent: "0",
    }),
  "catalog.update": (api, claim) =>
    api.catalog.update({
      ...claim,
      itemId: Bun.randomUUIDv7(),
      name: "Intrusion",
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
  "billing.toBill": (api, claim) => api.billing.toBill({ ...claim }),
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
    api.billing.patientCredit({ ...claim, patientId: Bun.randomUUIDv7(), treatmentPlanId: null }),
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
      item: { catalogItemId: Bun.randomUUIDv7(), sittingsPlanned: 1 },
    }),
  "treatment.addItem": (api, claim) =>
    api.treatment.addItem({
      ...claim,
      planId: Bun.randomUUIDv7(),
      item: { catalogItemId: Bun.randomUUIDv7(), sittingsPlanned: 1 },
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
  "report.invoiceRegister": (api, claim) =>
    api.report.invoiceRegister({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "report.revenueSignals": (api, claim) =>
    api.report.revenueSignals({
      ...claim,
      from: "2024-01-01",
      to: "2024-01-31",
      kind: "no_charge",
    }),
  "report.expiryExposure": (api, claim) => api.report.expiryExposure({ ...claim }),
  "report.revenueBreakdown": (api, claim) =>
    api.report.revenueBreakdown({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.invoiceRegisterXlsx": (api, claim) =>
    api.export.invoiceRegisterXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.revenueControlXlsx": (api, claim) =>
    api.export.revenueControlXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.trialBalanceXlsx": (api, claim) =>
    api.export.trialBalanceXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.balanceSheetXlsx": (api, claim) =>
    api.export.balanceSheetXlsx({ ...claim, asOf: "2024-01-31" }),
  "export.dailyCollectionsXlsx": (api, claim) =>
    api.export.dailyCollectionsXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.opdRegisterXlsx": (api, claim) =>
    api.export.opdRegisterXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
  "export.gstOutwardXlsx": (api, claim) =>
    api.export.gstOutwardXlsx({ ...claim, from: "2024-01-01", to: "2024-01-31" }),
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
      sold: true,
      taxRatePercent: "12",
      active: true,
      stockUnit: "tablet",
      unitsPerPack: 10,
      expires: true,
      pack: "10 tablets",
    }),
  "pharmacy.updateProduct": (api, claim) =>
    api.pharmacy.updateProduct({
      ...claim,
      productId: "missing",
      name: "Intrusion",
      sold: true,
      taxRatePercent: "12",
      active: true,
      stockUnit: "tablet",
      unitsPerPack: 10,
      expires: true,
      pack: "10 tablets",
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
          pricedPer: "unit",
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
    item: { catalogItemId: service.id, sittingsPlanned: 1 },
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
    bobClient.billing.patientCredit({
      orgSlug: beta.slug,
      patientId: alphaRows.patient.id,
      treatmentPlanId: null,
    }),
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

test("member and invitation mutations reject an id belonging to another tenant", async () => {
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

  const invited = await clientFor(alice).member.invite({
    orgSlug: alpha.slug,
    email: `scoped-${Bun.randomUUIDv7()}@example.com`,
    role: "reception",
  });

  await expectORPCCode(
    bobClient.member.revokeInvitation({ orgSlug: beta.slug, invitationId: invited.id }),
    "NOT_FOUND",
  );

  const stillPending = await clientFor(alice).member.list({ orgSlug: alpha.slug });
  expect(stillPending.invitations.map((row) => row.id)).toContain(invited.id);
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
    sold: true,
    taxRatePercent: "12",
    active: true,
    stockUnit: "tablet",
    unitsPerPack: 10,
    expires: true,
    pack: "10 tablets",
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
        pricedPer: "unit",
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
  await expectORPCCode(
    bobClient.pharmacy.sell({
      orgSlug: beta.slug,
      lines: [{ batchId: batch.batchId, qty: 1 }],
      buyer: { name: "Foreign buyer" },
      payments: [],
      expectedGrandTotal: 1_00n,
    }),
    "NOT_FOUND",
  );
});

test("payer access stays tenant-scoped across foreign claims, roles, and revocation", async () => {
  const owner = await createTestUser("payer-scope-owner");
  const one = await createOrganization(owner, "payer-scope-one");
  const two = await createOrganization(owner, "payer-scope-two");
  const api = clientFor(owner);

  const inOne = await api.payer.create({
    orgSlug: one.slug,
    name: "Alpha Health",
    type: "insurer",
  });

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

test("patient, catalog, staff, OPD and invoice rows are invisible from another org", async () => {
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

  if (!created.invoice) throw new Error("Expected walk-in to issue an invoice");

  const [visits, account, ownVisit] = await Promise.all([
    aliceClient.patient.visits({ orgSlug: alpha.slug, patientId: patient.id }),
    aliceClient.patient.account({ orgSlug: alpha.slug, patientId: patient.id }),
    aliceClient.opd.get({ orgSlug: alpha.slug, appointmentId: created.appointment.id }),
  ]);

  expect(visits.items.map((row) => row.id)).toEqual([created.appointment.id]);
  expect(account.invoices.map((row) => row.id)).toEqual([created.invoice.id]);
  expect(account.outstanding).toBe(100_00n);
  expect(ownVisit.appointment.id).toBe(created.appointment.id);

  const bob = await createTestUser("opd-scope-bob");
  const beta = await createOrganization(bob, "opd-scope-beta");
  const bobClient = clientFor(bob);
  const foreignPatient = { orgSlug: beta.slug, patientId: patient.id };

  expect(
    (await bobClient.patient.search({ orgSlug: beta.slug, phone: patient.phone })).items,
  ).toHaveLength(0);
  await expectORPCCode(bobClient.patient.get(foreignPatient), "NOT_FOUND");
  await expectORPCCode(bobClient.patient.visits(foreignPatient), "NOT_FOUND");
  await expectORPCCode(bobClient.patient.account(foreignPatient), "NOT_FOUND");

  expect((await bobClient.catalog.list({ orgSlug: beta.slug })).items).toEqual([]);
  await expectORPCCode(
    bobClient.catalog.update({
      orgSlug: beta.slug,
      itemId: fee.id,
      name: fee.name,
      category: fee.category,
      unitPrice: fee.unitPrice,
      customRate: false,
      taxRatePercent: fee.taxRatePercent,
      taxCode: fee.taxCode,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.catalog.setActive({ orgSlug: beta.slug, itemId: fee.id, active: false }),
    "NOT_FOUND",
  );

  expect(await bobClient.staff.listDepartments({ orgSlug: beta.slug })).toEqual([]);
  await expectORPCCode(
    bobClient.staff.updateDepartment({
      orgSlug: beta.slug,
      departmentId: department.id,
      name: "Foreign Rename",
    }),
    "NOT_FOUND",
  );

  expect(
    await bobClient.opd.day({ orgSlug: beta.slug, q: patient.name, includeClosed: true }),
  ).toEqual({ items: [], nextCursor: null });
  await expectORPCCode(
    bobClient.opd.get({ orgSlug: beta.slug, appointmentId: created.appointment.id }),
    "NOT_FOUND",
  );

  await expectORPCCode(
    bobClient.billing.getInvoice({ orgSlug: beta.slug, invoiceId: created.invoice.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.billing.listInvoices({ orgSlug: beta.slug, appointmentId: created.appointment.id }),
    "NOT_FOUND",
  );
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
    patient,
    appointment: created.appointment,
    invoice: created.invoice,
    payments: created.payments,
  };
}

test("reports in a member's own org expose none of another org's figures", async () => {
  const alice = await createTestUser("report-scope-alice");
  const alpha = await createOrganization(alice, "report-scope-alpha");
  await createScopedInvoice(clientFor(alice), alpha, "Report Alpha");

  const betaOwner = await createTestUser("report-scope-beta-owner");
  const beta = await createOrganization(betaOwner, "report-scope-beta");
  const bob = await createTestUser("report-scope-beta-member");
  await joinOrganization(bob, beta.id, "accountant");
  const bobClient = clientFor(bob);
  const range = reportRange();

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
  expect(gst.summary!.rateSummary).toEqual([]);
  expect(gst.summary!.hsnSummary).toEqual([]);
  expect(gst.summary!.totals).toEqual({
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

test("one client works in two orgs concurrently and every domain returns only its own rows", async () => {
  const user = await createTestUser("concurrent-scope");
  const one = await createOrganization(user, "concurrent-one");
  const two = await createOrganization(user, "concurrent-two");
  const api = clientFor(user);
  const unpaid = { expectedGrandTotal: 100_00n, payments: [], note: "Settle at the counter" };

  async function seed(organization: { slug: string }, name: string) {
    const visit = await createScopedInvoice(api, organization, name, unpaid);
    const course = await createTreatmentScopeFixture(api, organization, `${name} Course`);

    const payer = await api.payer.create({
      orgSlug: organization.slug,
      name: `${name} Health`,
      type: "insurer",
    });

    return { name, visit, course, payer };
  }

  const [inOne, inTwo] = await Promise.all([
    seed(one, "Concurrent One"),
    seed(two, "Concurrent Two"),
  ]);

  await api.billing.recordPayments({
    orgSlug: one.slug,
    invoiceId: inOne.visit.invoice.id,
    payments: [{ method: "cash", amount: 40_00n }],
  });

  const range = reportRange();

  async function read(organization: { slug: string }, rows: typeof inOne) {
    const orgSlug = organization.slug;
    const patientId = rows.course.patient.id;

    const [
      settings,
      patients,
      catalog,
      departments,
      day,
      invoices,
      plans,
      credit,
      payers,
      trial,
      gst,
    ] = await Promise.all([
      api.settings.get({ orgSlug }),
      api.patient.search({ orgSlug }),
      api.catalog.list({ orgSlug }),
      api.staff.listDepartments({ orgSlug }),
      api.opd.day({ orgSlug }),
      api.billing.listInvoices({ orgSlug, appointmentId: rows.visit.appointment.id }),
      api.treatment.listForPatient({ orgSlug, patientId }),
      api.billing.patientCredit({ orgSlug, patientId, treatmentPlanId: null }),
      api.payer.list({ orgSlug }),
      api.report.trialBalance({ orgSlug, ...range }),
      api.report.gst({ orgSlug, ...range }),
    ]);

    expect(settings.legalName).toBe(`${rows.name} Hospital`);
    expect(patients.items.map((row) => row.id).sort()).toEqual(
      [rows.visit.patient.id, patientId].sort(),
    );
    expect(catalog.items.map((row) => row.name).sort()).toEqual([
      `${rows.name} Consultation`,
      `${rows.name} Course Service`,
    ]);
    expect(departments.map((row) => row.name).sort()).toEqual([
      `${rows.name} Course Department`,
      `${rows.name} Department`,
    ]);
    expect(day.items.map((row) => row.id)).toEqual([rows.visit.appointment.id]);
    expect(invoices.map((row) => row.id)).toEqual([rows.visit.invoice.id]);
    expect(rows.visit.appointment.tokenNumber).toBe(1);
    expect(rows.visit.invoice.invoiceNumber.endsWith("/1")).toBe(true);
    expect(plans.map((row) => row.id)).toEqual([rows.course.plan.id]);
    expect(credit.total).toBe(rows.course.advance.amount);
    expect(payers.map((row) => row.id)).toEqual([rows.payer.id]);
    expect(gst.documents.map((row) => row.number)).toEqual([rows.visit.invoice.invoiceNumber]);

    return trial.rows.find((row) => row.code === "1200")?.closingDebit;
  }

  const [receivableOne, receivableTwo] = await Promise.all([read(one, inOne), read(two, inTwo)]);

  expect(receivableOne).toBe(60_00n);
  expect(receivableTwo).toBe(100_00n);
});

test("revenue control denies desk roles with central audits and never exposes foreign rows or cursors", async () => {
  const owner = await createTestUser("revenue-scope-owner");
  const alpha = await createOrganization(owner, "revenue-scope-alpha");
  const beta = await createOrganization(owner, "revenue-scope-beta");
  const api = clientFor(owner);
  const issued = await createScopedInvoice(api, alpha, "Revenue Alpha");
  const date = issued.invoice.businessDate;
  const claim = { orgSlug: alpha.slug };

  const financialCalls = Object.entries(GUARDED_CALLS).filter(([name]) =>
    [
      "report.invoiceRegister",
      "report.revenueSignals",
      "report.expiryExposure",
      "report.revenueBreakdown",
      "export.invoiceRegisterXlsx",
      "export.revenueControlXlsx",
    ].includes(name),
  );

  // Existing role-denial machinery covers every new endpoint, not just its route.
  const cashier = await createTestUser("revenue-scope-cashier");
  await joinOrganization(cashier, alpha.id, "cashier");

  for (const [name, call] of financialCalls) {
    await expectORPCCode(call(clientFor(cashier), claim), "FORBIDDEN", name);
  }

  await drainAuditWrites();
  const audit = await api.audit.list(claim);

  const denials = audit.items.filter(
    (entry) => entry.actorId === cashier.user.id && entry.action === "rbac.permission",
  );

  expect(denials).toHaveLength(financialCalls.length);
  expect(denials.every((entry) => entry.denied && entry.orgId === alpha.id)).toBe(true);

  const accountant = await createTestUser("revenue-scope-accountant");
  await joinOrganization(accountant, beta.id, "accountant");
  const scoped = clientFor(accountant);
  const register = await api.report.invoiceRegister({ ...claim, from: date, to: date });
  const foreignRow = register.rows[0];

  if (!foreignRow) throw new Error("expected the alpha invoice");

  const [empty, totals, signals, revenue, expiry] = await Promise.all([
    scoped.report.invoiceRegister({
      orgSlug: beta.slug,
      from: date,
      to: date,
      query: issued.invoice.invoiceNumber,
      cursor: {
        businessDate: foreignRow.businessDate,
        createdAt: foreignRow.createdAt.toISOString(),
        id: foreignRow.id,
      },
    }),
    scoped.report.invoiceRegister({ orgSlug: beta.slug, from: date, to: date }),
    scoped.report.revenueSignals({
      orgSlug: beta.slug,
      from: date,
      to: date,
      kind: "discount",
      cursor: { eventAt: foreignRow.createdAt.toISOString(), id: foreignRow.id },
    }),
    scoped.report.revenueBreakdown({ orgSlug: beta.slug, from: date, to: date }),
    scoped.report.expiryExposure({ orgSlug: beta.slug }),
  ]);

  expect(empty.rows).toEqual([]);
  expect(totals.summary!.totals.count).toBe(0);
  expect(signals.rows).toEqual([]);
  expect(revenue.totals.netTaxableValue).toBe(0n);
  expect(expiry.rows).toEqual([]);
  // The shared sweep above also proves missing claims, foreign slugs and immediate revocation.
});
