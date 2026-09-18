import { db } from "@hms/db";
import { invitation, organization, user } from "@hms/db/schema/auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

// Database time, so the fragment is safe to build once at import.
const live = and(eq(invitation.status, "pending"), gt(invitation.expiresAt, sql`now()`));

export function invitationClaim() {
  return {
    id: "invitation-claim",
    init() {
      return {
        options: {
          databaseHooks: {
            user: {
              create: {
                // The invitation id is an opaque UUID handed to one person by an admin;
                // presenting it with the invited email is the proof of eligibility until
                // an email provider exists (D006). Operator scripts insert directly and
                // never reach this hook, so every other creation path is refused.
                async before(user, ctx) {
                  const invitationId = ctx?.path === "/sign-up/email" && ctx.body?.invitationId;

                  const [invited] = invitationId
                    ? await db
                        .select({ id: invitation.id })
                        .from(invitation)
                        .where(
                          and(
                            eq(invitation.id, String(invitationId)),
                            eq(invitation.email, user.email),
                            live,
                          ),
                        )
                        .limit(1)
                    : [];

                  if (!invited) {
                    throw new APIError("FORBIDDEN", {
                      code: "INVITATION_REQUIRED",
                      message: "Account creation requires a current invitation for this email.",
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
    endpoints: {
      invitationClaimStatus: createAuthEndpoint(
        "/invitation/claim-status",
        {
          method: "GET",
          query: z.object({ invitationId: z.string().min(1) }),
        },
        async (ctx) => {
          const [invited] = await db
            .select({
              email: invitation.email,
              organizationName: organization.name,
              organizationSlug: organization.slug,
              accountExists: sql<boolean>`${user.id} is not null`,
            })
            .from(invitation)
            .innerJoin(organization, eq(organization.id, invitation.organizationId))
            .leftJoin(user, eq(user.email, invitation.email))
            .where(and(eq(invitation.id, ctx.query.invitationId), live));

          if (!invited) {
            throw new APIError("NOT_FOUND", {
              message: "This invitation is no longer available. Ask the sender for a new link.",
            });
          }

          return ctx.json(invited);
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
