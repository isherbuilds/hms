import { Navigate, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/org/$orgSlug")({
  ssr: false,
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();
  const location = useLocation();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();

  // Children no longer depend on this list — they scope by the URL slug, and the
  // server proves membership per call. The gate only spares a user who is about
  // to be redirected a flash of 403s, so it can be dropped for a faster paint.
  if (session.isPending || (session.data && organizations.isPending)) {
    return <Loader />;
  }

  if (!session.data) {
    return <Navigate to="/login" search={{ redirect: location.href }} />;
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
