import type { AppRouter } from "@hms/api/routers/index";
import { authorize, type AppPermission } from "@hms/auth/access";
import type { RouterClient } from "@orpc/server";
import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export type Membership = Awaited<ReturnType<RouterClient<AppRouter>["member"]["me"]>>;

/**
 * The only way to read membership. The `/$orgSlug` loader awaits `member.me`, so it
 * is always cached here and never pending or failed — a `useQuery` beside this one
 * only adds branches that cannot run.
 *
 * `select` runs on every render, so keep it an allocation-free projection. Narrow to
 * the field you render: the whole object wakes on any settings edit.
 */
export function useMembership(orgSlug: string): Membership;
export function useMembership<T>(orgSlug: string, select: (membership: Membership) => T): T;
export function useMembership<T>(orgSlug: string, select?: (membership: Membership) => T) {
  return useSuspenseQuery({
    ...orpc.member.me.queryOptions({ input: { orgSlug } }),
    select,
  }).data;
}

export function useCan(orgSlug: string, permission: AppPermission): boolean {
  return useMembership(orgSlug, (membership) => authorize(membership.roles, permission));
}
