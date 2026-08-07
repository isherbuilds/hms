import { beforeAll, describe, expect, test } from "bun:test";

import { drainAuditWrites } from "@better-stack/api/audit";
import { appRouter, type AppRouterClient } from "@better-stack/api/routers/index";
import { auth } from "@better-stack/auth";
import { db } from "@better-stack/db";
import { file } from "@better-stack/db/schema/file";

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

test("dashboard summaries are scoped, concurrent, and immediately revoke removed members", async () => {
  const owner = await createTestUser("summary-owner");
  const one = await createOrganization(owner, "summary-one");
  const two = await createOrganization(owner, "summary-two");
  const member = await createTestUser("summary-member");
  const visitor = await createTestUser("summary-visitor");
  await joinOrganization(member, one.id);

  const ownerClient = clientFor(owner);
  await db.insert(file).values([
    {
      id: `${one.id}/${crypto.randomUUID()}/ready.txt`,
      userId: owner.user.id,
      orgId: one.id,
      name: "ready.txt",
      size: 1,
      status: "ready",
    },
    {
      id: `${one.id}/${crypto.randomUUID()}/pending.txt`,
      userId: owner.user.id,
      orgId: one.id,
      name: "pending.txt",
      size: 1,
      status: "pending",
    },
  ]);

  const [inOne, inTwo] = await Promise.all([
    ownerClient.dashboard.summary({ orgSlug: one.slug }),
    ownerClient.dashboard.summary({ orgSlug: two.slug }),
  ]);
  expect(inOne).toEqual({ files: 1, people: 2 });
  expect(inTwo).toEqual({ files: 0, people: 1 });

  await expectORPCCode(clientFor(visitor).dashboard.summary({ orgSlug: one.slug }), "FORBIDDEN");

  const memberClient = clientFor(member);
  expect(await memberClient.dashboard.summary({ orgSlug: one.slug })).toEqual(inOne);
  await removeFromOrganization(owner, member.user.email, one.id);
  await expectORPCCode(memberClient.dashboard.summary({ orgSlug: one.slug }), "FORBIDDEN");
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

  const membership = await clientFor(owner).members.list({ orgSlug: organization.slug });
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

  const membership = await clientFor(owner).members.list({
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
  "dashboard.summary": (api, claim) => api.dashboard.summary({ ...claim }),
  "settings.get": (api, claim) => api.settings.get({ ...claim }),
  "settings.update": (api, claim) =>
    api.settings.update({
      ...claim,
      legalName: "intrusion",
      address: "",
      taxId: "",
      currency: "INR",
      mrnPrefix: "",
      invoicePrefix: "INV",
      receiptPrefix: "RCT",
      creditNotePrefix: "CN",
      fiscalYearStartMonth: 4,
    }),
  "audit.list": (api, claim) => api.audit.list({ ...claim }),
  "files.list": (api, claim) => api.files.list({ ...claim }),
  "files.createUpload": (api, claim) =>
    api.files.createUpload({ ...claim, name: "intrusion.txt", size: 1 }),
  "files.finalizeUpload": (api, claim) => api.files.finalizeUpload({ ...claim, key: "k" }),
  "files.getReadUrl": (api, claim) => api.files.getReadUrl({ ...claim, key: "k" }),
  "files.delete": (api, claim) => api.files.delete({ ...claim, key: "k" }),
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
  "members.me": (api, claim) => api.members.me({ ...claim }),
  "members.list": (api, claim) => api.members.list({ ...claim }),
  "members.invite": (api, claim) => api.members.invite({ ...claim, email: "x@example.com" }),
  "members.revokeInvitation": (api, claim) =>
    api.members.revokeInvitation({ ...claim, invitationId: "i" }),
  "members.updateRole": (api, claim) =>
    api.members.updateRole({ ...claim, memberId: "m", role: "admin" }),
  "members.remove": (api, claim) => api.members.remove({ ...claim, memberId: "m" }),
} satisfies Record<string, (api: AppRouterClient, claim: { orgSlug: string }) => Promise<unknown>>;

/** The only place a claim is faked away — every entry above stays type-checked. */
const NO_CLAIM = {} as { orgSlug: string };

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
  const [inAlpha] = (await clientFor(alice).members.list({ orgSlug: alpha.slug })).members.filter(
    (row) => row.userId === stranger.user.id,
  );
  expect(inAlpha).toBeDefined();

  // Bob owns beta, so the permission guard passes — only the scoped pre-read
  // stops alpha's member id from reaching Better Auth.
  const bobClient = clientFor(bob);
  await expectORPCCode(
    bobClient.members.updateRole({ orgSlug: beta.slug, memberId: inAlpha!.id, role: "admin" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.members.remove({ orgSlug: beta.slug, memberId: inAlpha!.id }),
    "NOT_FOUND",
  );

  // Alpha's member is untouched.
  const stillThere = (await clientFor(alice).members.list({ orgSlug: alpha.slug })).members;
  expect(stillThere.map((row) => row.userId)).toContain(stranger.user.id);
  expect(stillThere.find((row) => row.userId === stranger.user.id)?.role).toBe("member");
});

test("an invitation id from another tenant cannot be revoked", async () => {
  const alice = await createTestUser("invite-scope-alice");
  const alpha = await createOrganization(alice, "invite-scope-alpha");
  const bob = await createTestUser("invite-scope-bob");
  const beta = await createOrganization(bob, "invite-scope-beta");

  const invited = await clientFor(alice).members.invite({
    orgSlug: alpha.slug,
    email: `scoped-${crypto.randomUUID()}@example.com`,
  });

  await expectORPCCode(
    clientFor(bob).members.revokeInvitation({ orgSlug: beta.slug, invitationId: invited.id }),
    "NOT_FOUND",
  );

  const stillPending = await clientFor(alice).members.list({ orgSlug: alpha.slug });
  expect(stillPending.invitations.map((row) => row.id)).toContain(invited.id);
});

describe("patient tenancy four questions", () => {
  test("org B cannot see org A patients through search or get", async () => {
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

  test("a patient request naming a foreign organization is FORBIDDEN", async () => {
    const owner = await createTestUser("patient-scope-owner");
    const organization = await createOrganization(owner, "patient-scope-foreign");
    const outsider = await createTestUser("patient-scope-outsider");

    await expectORPCCode(
      clientFor(outsider).patient.search({ orgSlug: organization.slug }),
      "FORBIDDEN",
    );
  });

  test("a removed member is FORBIDDEN on the very next patient call", async () => {
    const owner = await createTestUser("patient-scope-revoke-owner");
    const organization = await createOrganization(owner, "patient-scope-revoke");
    const member = await createTestUser("patient-scope-revoke-member");
    await joinOrganization(member, organization.id);
    const memberClient = clientFor(member);

    expect((await memberClient.patient.search({ orgSlug: organization.slug })).items).toHaveLength(
      0,
    );
    await removeFromOrganization(owner, member.user.email, organization.id);
    await expectORPCCode(memberClient.patient.search({ orgSlug: organization.slug }), "FORBIDDEN");
  });
});

describe("catalog tenancy four questions", () => {
  test("org B cannot see org A catalog items or update them by foreign id", async () => {
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

  test("a catalog request naming a foreign organization is FORBIDDEN", async () => {
    const owner = await createTestUser("catalog-scope-owner");
    const organization = await createOrganization(owner, "catalog-scope-foreign");
    const outsider = await createTestUser("catalog-scope-outsider");

    await expectORPCCode(
      clientFor(outsider).catalog.list({ orgSlug: organization.slug }),
      "FORBIDDEN",
    );
  });

  test("a removed member is FORBIDDEN on the very next catalog call", async () => {
    const owner = await createTestUser("catalog-scope-revoke-owner");
    const organization = await createOrganization(owner, "catalog-scope-revoke");
    const member = await createTestUser("catalog-scope-revoke-member");
    await joinOrganization(member, organization.id);
    const memberClient = clientFor(member);

    expect(await memberClient.catalog.list({ orgSlug: organization.slug })).toEqual([]);
    await removeFromOrganization(owner, member.user.email, organization.id);
    await expectORPCCode(memberClient.catalog.list({ orgSlug: organization.slug }), "FORBIDDEN");
  });
});

describe("staff tenancy four questions", () => {
  test("org B cannot see org A departments or update them by foreign id", async () => {
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

  test("a staff request naming a foreign organization is FORBIDDEN", async () => {
    const owner = await createTestUser("staff-scope-owner");
    const organization = await createOrganization(owner, "staff-scope-foreign");
    const outsider = await createTestUser("staff-scope-outsider");

    await expectORPCCode(
      clientFor(outsider).staff.listDepartments({ orgSlug: organization.slug }),
      "FORBIDDEN",
    );
  });

  test("a removed member is FORBIDDEN on the very next staff call", async () => {
    const owner = await createTestUser("staff-scope-revoke-owner");
    const organization = await createOrganization(owner, "staff-scope-revoke");
    const member = await createTestUser("staff-scope-revoke-member");
    await joinOrganization(member, organization.id);
    const memberClient = clientFor(member);

    expect(await memberClient.staff.listDepartments({ orgSlug: organization.slug })).toEqual([]);
    await removeFromOrganization(owner, member.user.email, organization.id);
    await expectORPCCode(
      memberClient.staff.listDepartments({ orgSlug: organization.slug }),
      "FORBIDDEN",
    );
  });
});
