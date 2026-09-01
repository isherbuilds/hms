import { auth } from "@hms/auth";
import type { AuthSession } from "@hms/auth";
import type { RoleKey } from "@hms/auth/access";

// Produced only by the `orgProcedure` guard.
export type OrgMembership = {
  orgId: string;
  roles: RoleKey[];
};

export type ORPCContext = {
  headers: Headers;
  session: AuthSession | null;
  // One server-rendered page fans out into several calls that all prove the same
  // membership. Created per request and never outliving it, so revocation still
  // takes effect on the next request.
  memberships: Map<string, Promise<OrgMembership | null>>;
};

// Every adapter must go through this: a hand-built literal would opt out of the
// shared session and membership map.
export async function createRequestContext(headers: Headers): Promise<ORPCContext> {
  const session = await auth.api.getSession({ headers });

  return { headers, session, memberships: new Map() };
}
