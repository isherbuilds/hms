import { env } from "@better-stack/env/web";
import { ac, roles } from "@better-stack/auth/access";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: new URL("/api/auth", env.VITE_SERVER_URL).toString(),
  plugins: [
    organizationClient({
      ac,
      roles,
    }),
  ],
});
