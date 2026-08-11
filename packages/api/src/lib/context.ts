import { auth } from "@hms/auth";
import type { AuthSession } from "@hms/auth";
import type { Context as HonoContext } from "hono";

/**
 * Framework adapters supply request dependencies only. Authorization state is
 * derived by the `orgProcedure` permission guard from the org claim in
 * procedure input.
 */
export type ORPCContext = {
  headers: Headers;
  session: AuthSession | null;
};

export async function createContext({ context }: { context: HonoContext }): Promise<ORPCContext> {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({ headers });

  return { headers, session };
}
