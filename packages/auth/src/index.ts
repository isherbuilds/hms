import { db } from "@hms/db";
import * as schema from "@hms/db/schema/auth";
import { env } from "@hms/env/server";
import { organization } from "better-auth/plugins/organization";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";

import { ac, roles } from "./access";
import { organizationSlugIssue } from "./organization-slug";

export function invitationUrl(invitationId: string): string {
  return new URL(`/join?invitation=${invitationId}`, env.CORS_ORIGIN).toString();
}

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    // Creation performs the authoritative check; exposing this probe would let any
    // signed-in account enumerate organization URLs.
    disabledPaths: ["/organization/check-slug"],
    emailAndPassword: {
      enabled: true,
      // Sign-up is closed: accounts are created by an operator. Login stays open.
      disableSignUp: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    session: {
      cookieCache: {
        enabled: true,
      },
    },
    advanced: {
      database: {
        // Better Auth 1.7 moved this out of `experimental`. Left there it is silently
        // ignored and a session resolves with a query per model instead of one join.
        joins: true,
        // Better Auth mints the primary key for every row it owns, defaulting to a random
        // string that scatters across the index. Not `crypto.randomUUID({ version: 7 })` —
        // that accepts the option and silently returns a v4.
        generateId: () => Bun.randomUUIDv7(),
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      },
      crossSubDomainCookies: env.BETTER_AUTH_COOKIE_DOMAIN
        ? {
            enabled: true,
            domain: env.BETTER_AUTH_COOKIE_DOMAIN,
          }
        : undefined,
    },
    plugins: [
      organization({
        ac,
        roles,
        allowUserToCreateOrganization: (user) => {
          // Emails are stored lowercased, so normalize the env value before comparing.
          return user.email === env.FOUNDING_EMAIL.toLowerCase();
        },
        // Object storage cannot join the database cascade. Keep this closed until deletion
        // has an explicit object-cleanup flow.
        disableOrganizationDeletion: true,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: candidate }) => {
            const issue = organizationSlugIssue(candidate.slug);
            if (issue) {
              throw new APIError("BAD_REQUEST", {
                message: issue,
              });
            }
          },
          // The slug is the tenant claim every request carries, so it must be stable, not
          // merely unique: Better Auth never reserves a vacated slug, so a rename would free
          // it for another tenant and re-point every existing link.
          beforeUpdateOrganization: async ({ organization: update }) => {
            if (update.slug !== undefined) {
              throw new APIError("BAD_REQUEST", {
                message: "An organization slug cannot be changed after creation",
              });
            }
          },
        },
        // Until a real provider is wired here the link is logged, and `member.invite`
        // returns it too, so the flow is never silently broken.
        sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
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
