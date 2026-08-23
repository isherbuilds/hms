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

/**
 * The raw builder is deliberately not exported: every procedure in this app is
 * org-scoped and permission-guarded, so the only way to declare one is
 * `orgProcedure`, which cannot be constructed without stating a permission.
 * A genuinely public endpoint would be a new architectural decision, not a
 * default (see decision D001).
 */
const base = os.$context<ORPCContext>();

/**
 * The unverified tenant claim, named by the page URL. Safe to key authorization
 * on only because `packages/auth` rejects slug changes after creation. Handlers
 * scope on `context.scope.orgId` — never on this.
 */
export const orgInput = z.object({ orgSlug: z.string().min(1) });

/**
 * Resolves the caller's membership in the claimed org, at most once per request.
 * The *promise* is memoized before it settles, so procedure calls that fan out
 * concurrently from one page render share a single in-flight join instead of
 * racing to issue their own. A `null` result is memoized too: a rejected claim
 * must not be re-probed either.
 */
async function resolveMembership(
  context: ORPCContext,
  userId: string,
  orgSlug: string,
): Promise<OrgMembership | null> {
  // A slug cannot contain a NUL, so no two (user, slug) pairs can collide.
  const key = `${userId}\u0000${orgSlug}`;
  const memoized = context.memberships.get(key);
  if (memoized) {
    return memoized;
  }

  // Looked up fresh per request — and once within it — so revocation takes
  // effect on the next request. Resolving the slug and proving membership in
  // one statement is what keeps "no such org" and "not a member"
  // indistinguishable to the caller. `parseRoles` still throws on an unknown
  // role, so a corrupt row fails loudly rather than silently losing authority.
  const pending = db
    .select({ role: member.role, orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(organization.slug, orgSlug), eq(member.userId, userId)))
    .limit(1)
    .then(([row]) => (row ? { orgId: row.orgId, roles: parseRoles(row.role) } : null));

  context.memberships.set(key, pending);
  return pending;
}

export async function authorizeOrg(
  context: ORPCContext,
  orgSlug: string,
  permission: AppPermission,
): Promise<Scope> {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  const userId = context.session.user.id;
  const membership = await resolveMembership(context, userId, orgSlug);

  if (!membership) {
    // Deliberately NOT written to the tenant audit trail: an outsider must
    // never be able to inject rows (or leak their user id) into an org they
    // don't belong to — tests/integration/tenancy.test.ts enforces this. The
    // probe is still an operator-level signal, so it goes to server logs.
    console.warn(
      JSON.stringify({ event: "rbac.membership.denied", actorId: userId, claimedSlug: orgSlug }),
    );
    throw new ORPCError("FORBIDDEN");
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
    throw new ORPCError("FORBIDDEN");
  }

  return { userId, orgId, roles };
}

/**
 * The single way to declare a procedure. The permission is a constructor
 * argument, so an unguarded org endpoint cannot compile; the input schema must
 * carry the `orgSlug` claim (extend `orgInput`) because the guard reads it
 * after validation. Membership is resolved fresh per request — shared within
 * one request, never across requests. The permission check runs on every call.
 */
export const orgProcedure = <TSchema extends z.ZodType<{ orgSlug: string }, unknown>>(
  permission: AppPermission,
  input: TSchema,
) =>
  base.input(input).use(async ({ context, next }, { orgSlug }: { orgSlug: string }) => {
    const scope = await authorizeOrg(context, orgSlug, permission);
    return next({ context: { scope } });
  });
