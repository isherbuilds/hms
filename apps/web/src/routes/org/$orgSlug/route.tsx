import { Navigate, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useRef } from "react";

import { AppShell } from "@/components/app-shell";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { sessionGate } from "@/lib/session-gate";

export const Route = createFileRoute("/org/$orgSlug")({
  ssr: false,
  // The redirect decision lives here, not in render: the useSession store can
  // hold a stale `data: null` snapshot from a signed-out visit on the first
  // render after sign-in (nothing subscribes to it on /login), which bounced
  // fresh sign-ins straight back. beforeLoad checks a fresh session once per
  // navigation, and its `location.href` is always the org destination — never
  // /login — so ?redirect chains cannot nest either.
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const hasObservedSession = useRef(false);
  if (session.data) hasObservedSession.current = true;

  if (session.error) {
    return <Navigate to="/login" search={{}} />;
  }

  const gate = sessionGate(hasObservedSession.current, session.isPending, Boolean(session.data));
  if (gate === "redirect") {
    return <Navigate to="/login" search={{}} />;
  }

  // beforeLoad already proved the initial session. A null client snapshot is
  // allowed only until the hook observes that session; a later null means the
  // session expired or was revoked and must return to login.
  if (gate === "loading" || organizations.isPending) {
    return <Loader />;
  }

  if (organizations.data && !organizations.data.some((org) => org.slug === orgSlug)) {
    return <Navigate to="/onboarding" />;
  }

  return (
    <AppShell orgSlug={orgSlug}>
      <Outlet />
    </AppShell>
  );
}
