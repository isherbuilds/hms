import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { orgToday } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { hasErrorCode } from "@/lib/orpc-error";

export const Route = createFileRoute("/$orgSlug")({
  ssr: true,
  loader: async ({ context: { queryClient }, location, params: { orgSlug } }) => {
    let membership;
    try {
      membership = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));
    } catch (error) {
      if (hasErrorCode(error, "UNAUTHORIZED")) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      if (hasErrorCode(error, "FORBIDDEN")) {
        throw redirect({ to: "/join" });
      }
      throw error;
    }

    return {
      timeZone: membership.timeZone,
      today: orgToday(membership.timeZone),
    };
  },
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();

  return (
    <AppShell orgSlug={orgSlug}>
      <Outlet />
    </AppShell>
  );
}
