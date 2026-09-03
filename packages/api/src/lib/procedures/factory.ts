import { authorize, parseRoles, type AppPermission, type RoleKey } from "@hms/auth/access";
import { db } from "@hms/db";
import { member, organization } from "@hms/db/schema/auth";
import { ORPCError, os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../../audit";
import type { OrgMembership, ORPCContext } from "../context";

export type Scope = {
  userId: string;
  orgId: string;
  roles: RoleKey[];
};

// Not exported: every procedure goes through `orgProcedure`, which cannot be
// constructed without stating a permission (decision D001).
const base = os.$context<ORPCContext>();

// The unverified claim, named by the page URL. Safe to key authorization on only
// because slug changes are rejected after creation. Handlers scope on
// `context.scope.orgId` — never on this.
export const orgInput = z.object({ orgSlug: z.string().min(1) });

// The promise is memoized before it settles, so calls fanning out from one page
// render share a single in-flight join. A `null` result is memoized too.
async function resolveMembership(
  context: ORPCContext,
  userId: string,
  orgSlug: string,
): Promise<OrgMembership | null> {
  const memoized = context.memberships.get(orgSlug);
  if (memoized) {
    return memoized;
  }

  // One statement for slug and membership: "no such org" and "not a member" must
  // stay indistinguishable to the caller. `parseRoles` throws on an unknown role.
  const pending = db
    .select({ role: member.role, orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(organization.slug, orgSlug), eq(member.userId, userId)))
    .limit(1)
    .then(([row]) => (row ? { orgId: row.orgId, roles: parseRoles(row.role) } : null));

  context.memberships.set(orgSlug, pending);
  return pending;
}

// One wording for "no such org" and "you are not a member". Telling them apart would
// leak the existence that answering FORBIDDEN instead of NOT_FOUND exists to hide.
const NO_ORG_ACCESS = "You do not have access to this organization.";

async function authorizeOrg(
  context: ORPCContext,
  orgSlug: string,
  permission: AppPermission,
): Promise<Scope> {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }

  const userId = context.session.user.id;
  const membership = await resolveMembership(context, userId, orgSlug);

  if (!membership) {
    // Never written to the tenant audit trail: an outsider must not inject rows, or
    // leak their user id, into an org they don't belong to (tenancy.test.ts).
    console.warn(
      JSON.stringify({ event: "rbac.membership.denied", actorId: userId, claimedSlug: orgSlug }),
    );
    throw new ORPCError("FORBIDDEN", { message: NO_ORG_ACCESS });
  }

  const { orgId, roles } = membership;
  if (!authorize(roles, permission)) {
    audit({
      action: "rbac.permission",
      denied: true,
      actorId: userId,
      orgId,
      meta: { roles, permission },
    });
    throw new ORPCError("FORBIDDEN", { message: "You do not have permission to do that." });
  }

  return { userId, orgId, roles };
}

export const orgProcedure = <TSchema extends z.ZodType<{ orgSlug: string }, unknown>>(
  permission: AppPermission,
  input: TSchema,
) =>
  base.input(input).use(async ({ context, next }, { orgSlug }: { orgSlug: string }) => {
    const scope = await authorizeOrg(context, orgSlug, permission);
    return next({ context: { scope } });
  });
