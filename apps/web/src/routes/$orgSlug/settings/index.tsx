import { authorize } from "@hms/auth/access";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { SETTINGS_TABS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";

// An address, not a page: resolves to the first tab this member can open.
export const Route = createFileRoute("/$orgSlug/settings/")({
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.query({
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
