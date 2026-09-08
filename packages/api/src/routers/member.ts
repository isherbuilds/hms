import { auth, invitationUrl } from "@hms/auth";
import { ORG_ROLES, authorize } from "@hms/auth/access";
import { db } from "@hms/db";
import { invitation, member, organization, user } from "@hms/db/schema/auth";
import { SETTINGS_DEFAULTS, organizationSettings } from "@hms/db/schema/organization-settings";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern } from "../lib/schemas";

const roleInput = z.enum(ORG_ROLES);

// A member id from another tenant must not reach Better Auth's own endpoints.
async function assertMemberIdInScope(memberId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Member not found" });
  }
}

// Writes delegate to Better Auth as the caller so its invariants hold, always with
// an explicit `organizationId` — never the session's active org.
export const memberRouter = {
  me: orgProcedure({ member: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId, roles, userId } = context.scope;
    const sessionUser = context.session!.user;

    const [organizations, [settings]] = await Promise.all([
      // Predicate on `userId` by design: this lists which orgs the user belongs to, never
      // data inside one.
      db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, userId))
        .orderBy(asc(organization.name), asc(organization.id)),
      db
        .select({
          timeZone: organizationSettings.timeZone,
          currency: organizationSettings.currency,
        })
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, orgId))
        .limit(1),
    ]);

    return {
      roles,
      user: { name: sessionUser.name, email: sessionUser.email },
      organizations,
      timeZone: settings?.timeZone ?? SETTINGS_DEFAULTS.timeZone,
      currency: settings?.currency ?? SETTINGS_DEFAULTS.currency,
    };
  }),

  list: orgProcedure(
    { member: ["read"] },
    orgInput.extend({
      q: z.string().trim().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId, roles } = context.scope;
    const search = input.q ? likePattern(input.q) : undefined;
    // An invitation id creates the invited account (D006), so only members who
    // could have issued it get the rows and their links.
    const canInvite = authorize(roles, { invitation: ["create"] });
    const [members, invited] = await Promise.all([
      db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          name: user.name,
          email: user.email,
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
      canInvite
        ? db
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
            .limit(input.limit)
        : [],
    ]);

    return {
      members,
      invitations: invited.map((row) => ({ ...row, url: invitationUrl(row.id) })),
    };
  }),

  invite: orgProcedure(
    { invitation: ["create"] },
    orgInput.extend({ email: z.email(), role: roleInput }),
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

    // The link is the recipient's proof of eligibility until email delivery exists.
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
    // Scoped read first: a foreign invitation id must not reach Better Auth's cancel path.
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
  }),

  updateRole: orgProcedure(
    { member: ["update"] },
    orgInput.extend({ memberId: z.string().min(1), role: roleInput }),
  ).handler(async ({ context, input }) => {
    await assertMemberIdInScope(input.memberId, context.scope.orgId);

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
  }),

  remove: orgProcedure(
    { member: ["delete"] },
    orgInput.extend({ memberId: z.string().min(1) }),
  ).handler(async ({ context, input }) => {
    await assertMemberIdInScope(input.memberId, context.scope.orgId);

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
  }),
};
