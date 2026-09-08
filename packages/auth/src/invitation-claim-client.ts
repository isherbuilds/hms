import type { BetterAuthClientPlugin } from "better-auth/client";

import type { invitationClaim } from "./invitation-claim";

export function invitationClaimClient() {
  return {
    id: "invitation-claim",
    $InferServerPlugin: {} as ReturnType<typeof invitationClaim>,
  } satisfies BetterAuthClientPlugin;
}
