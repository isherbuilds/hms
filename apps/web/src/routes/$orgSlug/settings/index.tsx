import { authorize } from "@hms/auth/access";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { SETTINGS_TABS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";

/**
 * `/settings` is an address, not a page. It resolves to the first tab this
 * member can actually open, so an accountant who can read the audit log but
 * not save settings still lands somewhere useful instead of on a denial.
 */
export const Route = createFileRoute("/$orgSlug/settings/")({
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.fetchQuery({
      ...orpc.member.me.queryOptions({ input: { orgSlug } }),
      staleTime: 0,
    });
    const first = SETTINGS_TABS.find(({ permission }) => authorize(membership.roles, permission));
    throw redirect({
      to: first?.to ?? "/$orgSlug/dashboard",
      params: { orgSlug },
    });
  },
});
