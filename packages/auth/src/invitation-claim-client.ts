import type { BetterAuthClientPlugin } from "better-auth/client";

import type { invitationClaim } from "./invitation-claim";

export function invitationClaimClient() {
  return {
    id: "invitation-claim",
    // SAFETY: Better Auth uses this marker only to infer server-plugin types, never as runtime data.
    $InferServerPlugin: {} as ReturnType<typeof invitationClaim>,
  } satisfies BetterAuthClientPlugin;
}
