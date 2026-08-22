import { auth } from "@hms/auth";
import type { AuthSession } from "@hms/auth";
import type { RoleKey } from "@hms/auth/access";

/**
 * A member's proven place in one organization: the resolved tenant id and the
 * roles that authorize against it. Produced only by the `orgProcedure` guard.
 */
export type OrgMembership = {
  orgId: string;
  roles: RoleKey[];
};

/**
 * Framework adapters supply request dependencies only. Authorization state is
 * derived by the `orgProcedure` permission guard from the org claim in
 * procedure input.
 */
export type ORPCContext = {
  headers: Headers;
  session: AuthSession | null;
  /**
   * Membership rows already resolved during *this* request, keyed by caller and
   * claimed slug. One server-rendered page fans out into several procedure
   * calls that all prove the same membership; without this they each repeat the
   * same join. Revocation still takes effect on the next request because the
   * map is created per request and never outlives it — see
   * `createRequestContext`.
   */
  memberships: Map<string, Promise<OrgMembership | null>>;
};

/**
 * One context per request. Every adapter must go through this so that a request
 * resolves its session once and shares one membership map; building the object
 * literal by hand would silently opt out of both.
 */
export async function createRequestContext(headers: Headers): Promise<ORPCContext> {
  const session = await auth.api.getSession({ headers });

  return { headers, session, memberships: new Map() };
}
