import { authorize, parseRoles, type AppPermission } from "@hms/auth/access";
import { db } from "@hms/db";
import { member, organization } from "@hms/db/schema/auth";
import { ORPCError, os } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../../audit";
import type { ORPCContext } from "../context";

export type Scope = {
  userId: string;
  orgId: string;
};

/**
 * The raw builder is deliberately not exported: every procedure in this app is
 * org-scoped and permission-guarded, so the only way to declare one is
 * `orgProcedure`, which cannot be constructed without stating a permission.
 * A genuinely public endpoint would be a new architectural decision, not a
 * default (see ADR 0015).
 */
const base = os.$context<ORPCContext>();

/**
 * The unverified tenant claim, named by the page URL. Safe to key authorization
 * on only because `packages/auth` rejects slug changes after creation. Handlers
 * scope on `context.scope.orgId` — never on this.
 */
export const orgInput = z.object({ orgSlug: z.string().min(1) });

export async function authorizeOrg(
  context: ORPCContext,
  orgSlug: string,
  permission: AppPermission,
): Promise<Scope> {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  // Looked up fresh on every request so revocation takes effect immediately.
  // Resolving the slug and proving membership in one statement is what keeps
  // "no such org" and "not a member" indistinguishable to the caller.
  const userId = context.session.user.id;
  const [membership] = await db
    .select({ role: member.role, orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(organization.slug, orgSlug), eq(member.userId, userId)))
    .limit(1);

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

  const orgId = membership.orgId;
  const roles = parseRoles(membership.role);
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

  return { userId, orgId };
}

/**
 * The single way to declare a procedure. The permission is a constructor
 * argument, so an unguarded org endpoint cannot compile; the input schema must
 * carry the `orgSlug` claim (extend `orgInput`) because the guard reads it
 * after validation. Membership is resolved fresh per request — never cached.
 */
export const orgProcedure = <TSchema extends z.ZodType<{ orgSlug: string }, any>>(
  permission: AppPermission,
  input: TSchema,
) =>
  base.input(input).use(async ({ context, next }, { orgSlug }: { orgSlug: string }) => {
    const scope = await authorizeOrg(context, orgSlug, permission);
    return next({ context: { scope } });
  });
