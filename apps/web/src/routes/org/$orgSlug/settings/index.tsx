import { authorize } from "@hms/auth/access";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { orpc } from "@/lib/orpc";
import { SETTINGS_TABS } from "@/routes/org/$orgSlug/settings/route";

/**
 * `/settings` is an address, not a page. It resolves to the first tab this
 * member can actually open, so an accountant who can read the audit log but
 * not save settings still lands somewhere useful instead of on a denial.
 */
export const Route = createFileRoute("/org/$orgSlug/settings/")({
  beforeLoad: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.ensureQueryData(
      orpc.members.me.queryOptions({ input: { orgSlug } }),
    );
    const first = SETTINGS_TABS.find(({ permission }) => authorize(membership.roles, permission));
    throw redirect({
      to: first?.to ?? "/org/$orgSlug/dashboard",
      params: { orgSlug },
    });
  },
});
