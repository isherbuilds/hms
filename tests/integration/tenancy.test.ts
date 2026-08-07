import { beforeAll, expect, test } from "bun:test";

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

test("a todo is scoped by explicit input and paged by a stable tenant-scoped cursor", async () => {
  const owner = await createTestUser("todo-pages");
  const organization = await createOrganization(owner, "todo-pages");
  const api = clientFor(owner);
  const created = await api.todo.create({ orgSlug: organization.slug, text: "one" });
  await api.todo.create({ orgSlug: organization.slug, text: "two" });
  await api.todo.create({ orgSlug: organization.slug, text: "three" });

  // The org named in the input is the org written to and read back from.
  expect(created.orgId).toBe(organization.id);
  const all = await api.todo.getAll({ orgSlug: organization.slug });
  expect(all.items.map((row) => row.id)).toContain(created.id);

  const first = await api.todo.getAll({ orgSlug: organization.slug, limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const second = await api.todo.getAll({
    orgSlug: organization.slug,
    limit: 2,
    cursor: first.nextCursor!,
  });
  expect(second.items).toHaveLength(1);
  expect(second.items.map((row) => row.id)).not.toContain(first.items[0]!.id);
  expect(second.items.map((row) => row.id)).not.toContain(first.items[1]!.id);
});

test("todos are invisible across orgs, and a foreign org is FORBIDDEN", async () => {
  const alice = await createTestUser("alice");
  const alpha = await createOrganization(alice, "alpha");
  const aliceClient = clientFor(alice);
  const aliceTodo = await aliceClient.todo.create({
    orgSlug: alpha.slug,
    text: "alpha secret",
  });

  const bob = await createTestUser("bob");
  const beta = await createOrganization(bob, "beta");
  const bobClient = clientFor(bob);

  const visible = await bobClient.todo.getAll({ orgSlug: beta.slug });
  expect(visible.items.map((t) => t.id)).not.toContain(aliceTodo.id);

  await expectORPCCode(
    bobClient.todo.toggle({
      orgSlug: beta.slug,
      id: aliceTodo.id,
      completed: true,
    }),
    "NOT_FOUND",
  );

  // Explicitly naming an org you are not a member of fails loud.
  await expectORPCCode(bobClient.todo.getAll({ orgSlug: alpha.slug }), "FORBIDDEN");
});

test("a foreign org claim cannot write into that tenant's audit trail", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "foreign-claim-audit");
  const visitor = await createTestUser("visitor");

  await expectORPCCode(clientFor(visitor).todo.getAll({ orgSlug: organization.slug }), "FORBIDDEN");
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
    api.todo.create({ orgSlug: one.slug, text: "from tab one" }),
    api.todo.create({ orgSlug: two.slug, text: "from tab two" }),
  ]);
  expect(inOne.orgId).toBe(one.id);
  expect(inTwo.orgId).toBe(two.id);

  const seenInOne = await api.todo.getAll({ orgSlug: one.slug });
  expect(seenInOne.items.map((t) => t.id)).toContain(inOne.id);
  expect(seenInOne.items.map((t) => t.id)).not.toContain(inTwo.id);
});

test("dashboard summaries are scoped, concurrent, and immediately revoke removed members", async () => {
  const owner = await createTestUser("summary-owner");
  const one = await createOrganization(owner, "summary-one");
  const two = await createOrganization(owner, "summary-two");
  const member = await createTestUser("summary-member");
  const visitor = await createTestUser("summary-visitor");
  await joinOrganization(member, one.id);

  const ownerClient = clientFor(owner);
  const openTodo = await ownerClient.todo.create({ orgSlug: one.slug, text: "open" });
  const completedTodo = await ownerClient.todo.create({ orgSlug: one.slug, text: "done" });
  await ownerClient.todo.toggle({ orgSlug: one.slug, id: completedTodo.id, completed: true });
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
  expect(inOne).toEqual({ openTodos: 1, files: 1, people: 2 });
  expect(inTwo).toEqual({ openTodos: 0, files: 0, people: 1 });
  expect(openTodo.orgId).toBe(one.id);

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
  await api.todo.getAll({ orgSlug: organization.slug });
  await auth.api.updateOrganization({
    body: { organizationId: organization.id, data: { name: "Renamed" } },
    headers: owner.headers,
  });
  await api.todo.getAll({ orgSlug: organization.slug });
});

test("an unknown slug is FORBIDDEN, not NOT_FOUND — existence never leaks", async () => {
  const user = await createTestUser("unknown-slug");
  const organization = await createOrganization(user, "unknown-slug");
  const api = clientFor(user);

  // Identical to the code a real-but-foreign org returns, so the two cases are
  // indistinguishable: a caller cannot probe which slugs exist.
  await expectORPCCode(
    api.todo.getAll({ orgSlug: `absent-${crypto.randomUUID().slice(0, 8)}` }),
    "FORBIDDEN",
  );
  await api.todo.getAll({ orgSlug: organization.slug });
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
  "todo.getAll": (api, claim) => api.todo.getAll({ ...claim }),
  "todo.create": (api, claim) => api.todo.create({ ...claim, text: "intrusion" }),
  "todo.toggle": (api, claim) => api.todo.toggle({ ...claim, id: 1, completed: true }),
  "todo.delete": (api, claim) => api.todo.delete({ ...claim, id: 1 }),
  "audit.list": (api, claim) => api.audit.list({ ...claim }),
  "files.list": (api, claim) => api.files.list({ ...claim }),
  "files.createUpload": (api, claim) =>
    api.files.createUpload({ ...claim, name: "intrusion.txt", size: 1 }),
  "files.finalizeUpload": (api, claim) => api.files.finalizeUpload({ ...claim, key: "k" }),
  "files.getReadUrl": (api, claim) => api.files.getReadUrl({ ...claim, key: "k" }),
  "files.delete": (api, claim) => api.files.delete({ ...claim, key: "k" }),
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
  const orgTodo = await clientFor(owner).todo.create({
    orgSlug: organization.slug,
    text: "roadmap",
  });

  // Sanity: while a member, the org todo is visible. Without this the sweep
  // below would pass just as well against a user who never joined at all.
  const before = await memberClient.todo.getAll({ orgSlug: organization.slug });
  expect(before.items.map((t) => t.id)).toContain(orgTodo.id);

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
