import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@hms/api/audit";
import { auth } from "@hms/auth";
import { createUserWithPassword } from "@hms/auth/manual-user";
import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";
import { invitation, member, user } from "@hms/db/schema/auth";
import { env } from "@hms/env/server";
import { and, eq } from "drizzle-orm";

import { app } from "../../apps/server/src/index";
import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { expectAuthStatus } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("public email sign-up is refused without an invitation", async () => {
  const email = `signup-${Bun.randomUUIDv7()}@example.com`;
  await expectAuthStatus(
    auth.api.signUpEmail({
      body: {
        email,
        name: "Sign-up probe",
        password: "integration-test-password",
      },
    }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );

  expect(await db.select({ id: user.id }).from(user).where(eq(user.email, email))).toHaveLength(0);
});

test("an operator-created account can sign in and is email-verified for account linking", async () => {
  const email = `operator-${Bun.randomUUIDv7()}@example.com`;

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

  const stranger = await createTestUser("bootstrap-stranger");
  await expectAuthStatus(
    auth.api.createOrganization({
      body: { name: "Too early", slug: "too-early" },
      headers: stranger.headers,
    }),
    "FORBIDDEN",
    "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
  );

  const first = await auth.api.createOrganization({
    body: { name: "First Org", slug: "first-org" },
    headers: founder,
  });

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, first!.id));

  expect(membership?.role).toBe("owner");

  const second = await auth.api.createOrganization({
    body: { name: "Second Org", slug: "second-org" },
    headers: founder,
  });

  expect(second).toBeDefined();

  const owner = await createTestUser("gate-owner");
  await createOrganization(owner, "gate");
  await expectAuthStatus(
    auth.api.createOrganization({
      body: { name: "Not Even For Owners", slug: "not-even-owners" },
      headers: owner.headers,
    }),
    "FORBIDDEN",
    "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
  );
});

test("short and reserved root slugs cannot create organizations", async () => {
  const owner = await createTestUser("static-route-slug-owner");

  for (const slug of ["abc", "CREATE", "docs", "blog"]) {
    await expectAuthStatus(
      auth.api.createOrganization({
        body: { name: "Invalid organization URL", slug, userId: owner.user.id },
      }),
      "BAD_REQUEST",
    );
  }
});

// D001 accepts Better Auth's org endpoints mounted whole only while both halves
// hold: same permissions enforced, and no audit row. Both are asserted here.
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

  const denied = await removeDirectly(plainMember.cookie, target.user.email);
  expect(denied.ok).toBe(false);
  // SAFETY: a denied Better Auth response body is JSON carrying `code`; the assertion is
  // what proves it, and the preceding `denied.ok` check establishes the error path.
  expect(((await denied.json()) as { code?: string }).code).toBe(
    "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER",
  );

  const stillMember = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, target.user.id));

  expect(stillMember).toHaveLength(1);

  // Control case: without it the assertion above would pass against an endpoint
  // that refuses everyone.
  expect((await removeDirectly(owner.cookie, target.user.email)).status).toBe(200);
  expect(
    await db.select({ id: member.id }).from(member).where(eq(member.userId, target.user.id)),
  ).toHaveLength(0);

  await drainAuditWrites();

  const [audited] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.orgId, organization.id));

  expect(audited).toBeUndefined();
});

test("an invitee creates an account from the invitation id, joins, and signs in with the password", async () => {
  const email = `onboarding-${Bun.randomUUIDv7()}@example.com`;
  const owner = await createTestUser("onboarding-owner");
  const organizationName = "onboarding-organization";
  const organization = await createOrganization(owner, organizationName);

  const invited = await auth.api.createInvitation({
    body: { email, role: "reception", organizationId: organization.id },
    headers: owner.headers,
  });

  const status = await app.request(`/api/auth/invitation/claim-status?invitationId=${invited.id}`);

  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({
    accountExists: false,
    email,
    organizationName,
    organizationSlug: organization.slug,
  });

  const password = "integration-test-password";

  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.CORS_ORIGIN },
    body: JSON.stringify({ email, name: "Invited User", password, invitationId: invited.id }),
  });

  expect(response.status).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  expect(cookie).toContain("session");
  // SAFETY: a successful native sign-up responds with the created user; the assertions
  // below read only these two fields and fail the test if either is absent.
  const created = (await response.json()) as { user: { id: string; emailVerified: boolean } };
  expect(created.user.emailVerified).toBe(false);
  expect(await auth.api.invitationClaimStatus({ query: { invitationId: invited.id } })).toEqual({
    accountExists: true,
    email,
    organizationName,
    organizationSlug: organization.slug,
  });

  const headers = new Headers({ cookie, origin: env.CORS_ORIGIN });
  await auth.api.acceptInvitation({ body: { invitationId: invited.id }, headers });

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organization.id), eq(member.userId, created.user.id)));

  expect(membership?.role).toBe("reception");
  expect((await auth.api.signInEmail({ body: { email, password } })).user.id).toBe(created.user.id);
});

test("an invitation id creates only its own invited email while it is live", async () => {
  const email = `revoked-onboarding-${Bun.randomUUIDv7()}@example.com`;
  const owner = await createTestUser("revoked-onboarding-owner");
  const organization = await createOrganization(owner, "revoked-onboarding");

  const invited = await auth.api.createInvitation({
    body: { email, role: "reception", organizationId: organization.id },
    headers: owner.headers,
  });

  const signUp = (body: { email: string; invitationId: string }) =>
    auth.api.signUpEmail({
      body: { name: "Impersonator", password: "integration-test-password", ...body },
    });

  await expectAuthStatus(
    signUp({ email: `other-${Bun.randomUUIDv7()}@example.com`, invitationId: invited.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
  await auth.api.cancelInvitation({ body: { invitationId: invited.id }, headers: owner.headers });
  await expectAuthStatus(
    signUp({ email, invitationId: invited.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
  expect(await db.select({ id: user.id }).from(user).where(eq(user.email, email))).toHaveLength(0);

  const expired = await auth.api.createInvitation({
    body: { email, role: "reception", organizationId: organization.id },
    headers: owner.headers,
  });

  await db
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invitation.id, expired.id));

  const expiredStatus = await app.request(
    `/api/auth/invitation/claim-status?invitationId=${expired.id}`,
  );

  expect(expiredStatus.status).toBe(404);
  await expectAuthStatus(
    signUp({ email, invitationId: expired.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
});
