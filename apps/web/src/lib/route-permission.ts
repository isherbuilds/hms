import { authorize, type AppPermission } from "@hms/auth/access";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import type { Membership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";

// `permission` must be the whole set the page needs to function, not just the one
// its name suggests — a page that renders but cannot submit is the same denial
// arriving later. `where` differs per page, so it is required rather than defaulted.
export async function requireOrgPermission(
  queryClient: QueryClient,
  orgSlug: string,
  permission: AppPermission,
  where: "/$orgSlug/dashboard" | "/$orgSlug/opd" | "/$orgSlug/pharmacy" | "/$orgSlug/settings",
): Promise<Membership> {
  const membership = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));

  if (!authorize(membership.roles, permission)) {
    throw redirect({ to: where, params: { orgSlug } });
  }

  return membership;
}
