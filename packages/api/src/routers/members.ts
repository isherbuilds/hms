import { auth, invitationUrl } from "@hms/auth";
import { ORG_ROLES, parseRoles } from "@hms/auth/access";
import { db } from "@hms/db";
import { invitation, member, user } from "@hms/db/schema/auth";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";

const roleInput = z.enum(ORG_ROLES);

/** `%`/`_` in user input must match literally, not as LIKE wildcards. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * A member id from another tenant must not reach Better Auth's own endpoints,
 * the same rule `revokeInvitation` applies to invitation ids.
 */
async function assertMemberInScope(memberId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Member not found" });
  }
}

/**
 * Membership and invitations for the caller's organization.
 *
 * Reads go straight to the database with the tenant predicate. Writes delegate
 * to Better Auth's own API as the authenticated caller, so its invariants
 * (last-owner protection, invitation lifecycle) hold — `organizationId` is
 * always passed explicitly, never taken from the session's active org.
 */
export const membersRouter = {
  /**
   * The caller's own roles in this org, so the client can hide controls it is
   * not allowed to use. Authorization still happens server-side on every call.
   */
  me: orgProcedure({ member: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId, userId } = context.scope;
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Membership not found" });
    }
    return { roles: parseRoles(row.role) };
  }),

  list: orgProcedure(
    { member: ["read"] },
    orgInput.extend({
      q: z.string().trim().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const search = input.q ? likePattern(input.q) : undefined;
    const [members, invitations] = await Promise.all([
      db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          name: user.name,
          email: user.email,
          image: user.image,
          joinedAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, orgId),
            search ? or(ilike(user.name, search), ilike(user.email, search)) : undefined,
          ),
        )
        .orderBy(asc(member.createdAt))
        .limit(input.limit),
      db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, orgId),
            eq(invitation.status, "pending"),
            gt(invitation.expiresAt, new Date()),
            search ? ilike(invitation.email, search) : undefined,
          ),
        )
        .orderBy(asc(invitation.expiresAt))
        .limit(input.limit),
    ]);

    return { members, invitations };
  }),

  invite: orgProcedure(
    { invitation: ["create"] },
    orgInput.extend({ email: z.email(), role: roleInput.default("member") }),
  ).handler(async ({ context, input }) => {
    const created = await auth.api.createInvitation({
      body: {
        email: input.email,
        role: input.role,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.invite",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `email:${input.email}`,
      meta: { role: input.role },
    });

    // Returned so an admin can hand the link over directly while no email
    // provider is wired up.
    return {
      id: created.id,
      email: created.email,
      url: invitationUrl(created.id),
    };
  }),

  revokeInvitation: orgProcedure(
    { invitation: ["cancel"] },
    orgInput.extend({ invitationId: z.string().min(1) }),
  ).handler(async ({ context, input }) => {
    // Scoped read first: an invitation id from another tenant must not reach
    // Better Auth's cancel path at all.
    const [row] = await db
      .select({ email: invitation.email })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, input.invitationId),
          eq(invitation.organizationId, context.scope.orgId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Invitation not found" });
    }

    await auth.api.cancelInvitation({
      body: { invitationId: input.invitationId },
      headers: context.headers,
    });

    audit({
      action: "member.invite.revoke",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `email:${row.email}`,
    });

    return { success: true as const };
  }),

  updateRole: orgProcedure(
    { member: ["update"] },
    orgInput.extend({ memberId: z.string().min(1), role: roleInput }),
  ).handler(async ({ context, input }) => {
    await assertMemberInScope(input.memberId, context.scope.orgId);

    await auth.api.updateMemberRole({
      body: {
        memberId: input.memberId,
        role: input.role,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.role.update",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `member:${input.memberId}`,
      meta: { role: input.role },
    });

    return { success: true as const };
  }),

  remove: orgProcedure(
    { member: ["delete"] },
    orgInput.extend({ memberId: z.string().min(1) }),
  ).handler(async ({ context, input }) => {
    await assertMemberInScope(input.memberId, context.scope.orgId);

    await auth.api.removeMember({
      body: {
        memberIdOrEmail: input.memberId,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.remove",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `member:${input.memberId}`,
    });

    return { success: true as const };
  }),
};
