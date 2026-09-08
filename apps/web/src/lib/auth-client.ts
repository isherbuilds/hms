import { env } from "@hms/env/web";
import { ac, roles } from "@hms/auth/access";
import { invitationClaimClient } from "@hms/auth/invitation-claim-client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Better Fetch returns plain error objects, not Error instances. Keep server
// faults generic while preserving actionable validation and authentication errors.
export function authErrorMessage(error: { status: number; message?: string }, fallback: string) {
  return error.status < 500 && error.message ? error.message : fallback;
}

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: new URL("/api/auth", env.VITE_SERVER_URL).toString(),
  plugins: [
    invitationClaimClient(),
    organizationClient({
      ac,
      roles,
    }),
  ],
});
