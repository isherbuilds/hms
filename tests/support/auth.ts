import { auth } from "@hms/auth";
import { createUserWithPassword } from "@hms/auth/manual-user";
import { uniqueSuffix } from "./unique";
export type TestUser = {
  cookie: string;
  headers: Headers;
  user: { id: string; email: string; name: string };
};

const TEST_PASSWORD = "integration-test-password";

export async function createTestUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${Bun.randomUUIDv7()}@example.com`;
  const name = `${prefix} test user`;
  const { id } = await createUserWithPassword({ email, name, password: TEST_PASSWORD });

  const { headers: responseHeaders } = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    returnHeaders: true,
  });

  const setCookie = responseHeaders.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) {
    throw new Error("Better Auth sign-in did not return a session cookie");
  }

  return {
    cookie,
    headers: new Headers({ cookie }),
    user: { id, email, name },
  };
}

// Better Auth's system path (a userId with no session) bypasses
// `allowUserToCreateOrganization`; the creator still becomes owner.
export async function createOrganization(
  owner: TestUser,
  name: string,
): Promise<{ id: string; slug: string }> {
  const organization = await auth.api.createOrganization({
    body: { name, slug: `${name}-${uniqueSuffix()}`, userId: owner.user.id },
  });
  if (!organization) {
    throw new Error(`Failed to create organization "${name}"`);
  }
  return { id: organization.id, slug: organization.slug };
}

export async function joinOrganization(
  joiner: TestUser,
  organizationId: string,
  role: "member" | "admin" = "member",
): Promise<void> {
  await auth.api.addMember({
    body: { userId: joiner.user.id, organizationId, role },
  });
}

export async function setMemberRoles(
  owner: TestUser,
  memberId: string,
  roles: Array<"member" | "admin" | "owner">,
  organizationId: string,
): Promise<void> {
  await auth.api.updateMemberRole({
    body: { memberId, role: roles, organizationId },
    headers: owner.headers,
  });
}

export async function removeFromOrganization(
  owner: TestUser,
  memberEmail: string,
  organizationId: string,
): Promise<void> {
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberEmail, organizationId },
    headers: owner.headers,
  });
}
