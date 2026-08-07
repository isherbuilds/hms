import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@better-stack/api/audit";
import { auth } from "@better-stack/auth";
import { createUserWithPassword } from "@better-stack/auth/manual-user";
import { db } from "@better-stack/db";
import { auditLog } from "@better-stack/db/schema/audit";
import { member, user } from "@better-stack/db/schema/auth";
import { file } from "@better-stack/db/schema/file";
import { todo } from "@better-stack/db/schema/todo";
import { env } from "@better-stack/env/server";
import { eq } from "drizzle-orm";

import { app } from "../../apps/server/src/index";
import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { expectAuthStatus } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("public email sign-up is disabled", async () => {
  await expectAuthStatus(
    auth.api.signUpEmail({
      body: {
        email: `signup-${crypto.randomUUID()}@example.com`,
        name: "Sign-up probe",
        password: "integration-test-password",
      },
    }),
    "BAD_REQUEST",
    "EMAIL_PASSWORD_SIGN_UP_DISABLED",
  );

  const [probe] = await db.select({ id: user.id }).from(user).limit(1);
  expect(probe?.id).toBeUndefined();
});

test("an operator-created account can sign in and is email-verified for account linking", async () => {
  const email = `operator-${crypto.randomUUID()}@example.com`;
  const { id } = await createUserWithPassword({
    email,
    name: "Operator user",
    password: "integration-test-password",
  });

  const [created] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, id));
  expect(created?.emailVerified).toBe(true);

  const { headers } = await auth.api.signInEmail({
    body: { email, password: "integration-test-password" },
    returnHeaders: true,
  });
  expect(headers.get("set-cookie")).toContain("session");
});

/**
 * Organization creation is restricted to the FOUNDING_EMAIL account alone —
 * there is no org-count nuance, so this test has no ordering requirement.
 */
test("only the founding email can create an organization", async () => {
  await createUserWithPassword({
    email: env.FOUNDING_EMAIL,
    name: "Founding operator",
    password: "integration-test-password",
  });
  const signIn = await auth.api.signInEmail({
    body: { email: env.FOUNDING_EMAIL, password: "integration-test-password" },
    returnHeaders: true,
  });
  const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeDefined();
  const founder = new Headers({ cookie: cookie! });

  // A signed-in stranger is denied.
  const stranger = await createTestUser("bootstrap-stranger");
  await expectAuthStatus(
    auth.api.createOrganization({
      body: { name: "Too early", slug: "too-early" },
      headers: stranger.headers,
    }),
    "FORBIDDEN",
    "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
  );

  // The founding email is allowed, and becomes the first org's owner.
  const first = await auth.api.createOrganization({
    body: { name: "First Org", slug: "first-org" },
    headers: founder,
  });
  expect(first).toBeDefined();
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, first!.id));
  expect(membership?.role).toBe("owner");

  // The exception does not expire: the founding email may keep creating orgs
  // (it stays the sole creator), but an owner of an existing org may not.
  const second = await auth.api.createOrganization({
    body: { name: "Second Org", slug: "second-org" },
    headers: founder,
  });
  expect(second).toBeDefined();

  const owner = await createTestUser("gate-owner");
  const ownerOrg = await createOrganization(owner, "gate");
  expect(ownerOrg).toBeDefined();
  await expectAuthStatus(
    auth.api.createOrganization({
      body: { name: "Not Even For Owners", slug: "not-even-owners" },
      headers: owner.headers,
    }),
    "FORBIDDEN",
    "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
  );
});

test("organization deletion stays disabled until external objects can be cleaned up", async () => {
  const owner = await createTestUser("delete-org-owner");
  const organization = await createOrganization(owner, "delete-org");

  // The body code is Better Auth's own machine-readable constant, so this pins
  // the reason for the rejection without pinning the sentence it renders as.
  await expectAuthStatus(
    auth.api.deleteOrganization({
      body: { organizationId: organization.id },
      headers: owner.headers,
    }),
    "NOT_FOUND",
    "ORGANIZATION_DELETION_DISABLED",
  );
});

test("a user can have only one membership row per organization", async () => {
  const owner = await createTestUser("unique-member-owner");
  const organization = await createOrganization(owner, "unique-member");

  await expect(
    db
      .insert(member)
      .values({
        id: crypto.randomUUID(),
        organizationId: organization.id,
        userId: owner.user.id,
        role: "member",
        createdAt: new Date(),
      })
      .execute(),
  ).rejects.toThrow();
});

test("deleting an attributed user preserves organization content", async () => {
  const owner = await createTestUser("attribution-owner");
  const organization = await createOrganization(owner, "attribution");
  const [createdTodo] = await db
    .insert(todo)
    .values({
      orgId: organization.id,
      userId: owner.user.id,
      text: "Keep this todo",
    })
    .returning({ id: todo.id });
  const fileId = `${organization.id}/${crypto.randomUUID()}/keep.txt`;
  await db.insert(file).values({
    id: fileId,
    orgId: organization.id,
    userId: owner.user.id,
    name: "keep.txt",
    size: 1,
    status: "ready",
  });

  await db.delete(user).where(eq(user.id, owner.user.id));

  const [preservedTodo] = await db.select().from(todo).where(eq(todo.id, createdTodo!.id));
  const [preservedFile] = await db.select().from(file).where(eq(file.id, fileId));
  expect(preservedTodo?.userId).toBeNull();
  expect(preservedFile?.userId).toBeNull();
});

/**
 * ADR 0002 accepts that Better Auth's organization endpoints are mounted whole
 * at `/api/auth/*` rather than closed at the edge, on two load-bearing claims:
 * they enforce the same permissions (so the open surface is not a privilege
 * bypass), and they write no audit row (so `members.*` stays the preferred
 * path). Both are asserted here — an accepted trade-off is only accepted while
 * the half that makes it safe still holds.
 */
test("the direct Better Auth surface enforces the same permissions and skips the audit trail", async () => {
  const owner = await createTestUser("direct-surface-owner");
  const organization = await createOrganization(owner, "direct-surface");
  const plainMember = await createTestUser("direct-surface-member");
  const target = await createTestUser("direct-surface-target");
  await joinOrganization(plainMember, organization.id);
  await joinOrganization(target, organization.id);

  const removeDirectly = (cookie: string, memberIdOrEmail: string) =>
    app.request("http://localhost/api/auth/organization/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ organizationId: organization.id, memberIdOrEmail }),
    });

  // A plain member holds no member:delete, and the direct endpoint honours that.
  // Better Auth picks its own status for the refusal, so the machine-readable
  // code and the unchanged membership are what get pinned, not the number.
  const denied = await removeDirectly(plainMember.cookie, target.user.email);
  expect(denied.ok).toBe(false);
  expect(((await denied.json()) as { code?: string }).code).toBe(
    "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER",
  );
  const stillMember = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, target.user.id));
  expect(stillMember).toHaveLength(1);

  // The owner does hold it — without this the assertion above would pass just
  // as well against an endpoint that refuses everyone.
  expect((await removeDirectly(owner.cookie, target.user.email)).status).toBe(200);
  expect(
    await db.select({ id: member.id }).from(member).where(eq(member.userId, target.user.id)),
  ).toHaveLength(0);

  // The documented cost of that convenience: no audit row, unlike members.remove.
  await drainAuditWrites();
  const [audited] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.orgId, organization.id));
  expect(audited).toBeUndefined();
});
