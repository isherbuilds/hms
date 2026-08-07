import { createDb } from "@better-stack/db";
import * as schema from "@better-stack/db/schema/auth";
import { env } from "@better-stack/env/server";
import { organization } from "better-auth/plugins/organization";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";

import { ac, roles } from "./access";

/** The page that lists a user's pending invitations and lets them accept one. */
export function invitationUrl(invitationId: string): string {
  return new URL(
    `/onboarding?invitation=${invitationId}`,
    env.CORS_ORIGIN,
  ).toString();
}

export function createAuth() {
  const db = createDb();

  return betterAuth({
    experimental: {
      joins: true,
    },
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
      // Sign-up is closed: accounts are created by an operator through
      // `scripts/create-user.ts`, not by a public endpoint. Login stays open.
      disableSignUp: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    session: {
      cookieCache: {
        enabled: true,
        // maxAge: 5 * 60,
      },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        /**
         * Organization creation is restricted to the single operator account
         * identified by FOUNDING_EMAIL — nobody else can create one
         */
        allowUserToCreateOrganization: (user) => {
          // Emails are stored lowercased (see `createUserWithPassword`), so
          // normalize the env value before comparing.
          return user.email === env.FOUNDING_EMAIL.toLowerCase();
        },
        // Object storage cannot participate in the database cascade. Keep this
        // endpoint closed until deletion has an explicit object-cleanup flow.
        disableOrganizationDeletion: true,
        organizationHooks: {
          /**
           * The slug is the tenant claim every org-scoped request carries, so it
           * must be stable, not merely unique. Better Auth never reserves a
           * vacated slug, so a rename would free it for another tenant to claim
           * and silently re-point every existing link at a different customer.
           * `name` stays editable; it authorizes nothing.
           */
          beforeUpdateOrganization: async ({ organization: update }) => {
            if (update.slug !== undefined) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "An organization slug cannot be changed after creation",
              });
            }
          },
        },
        /**
         * Accounts are created by an operator, so an invitation is how a
         * person is placed into an organization — wire a real provider here.
         * Until one is configured the link is logged, and `members.invite`
         * also returns it so an admin can pass it on directly; the flow is
         * never silently broken.
         */
        sendInvitationEmail: async ({
          id,
          email,
          organization: org,
          inviter,
        }) => {
          console.info(
            `[invite] ${inviter.user.email} invited ${email} to ${org.name}: ${invitationUrl(id)}`,
          );
        },
      }),
    ],
  });
}

export const auth = createAuth();
export type AuthSession = typeof auth.$Infer.Session;
export { ac, roles } from "./access";
export type { AppPermission, RoleKey } from "./access";
