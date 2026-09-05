import { auth } from "@hms/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";

// Where a signed-in visitor belongs when they open a page that is not for them:
// the landing page or the sign-in form. The first organization by name matches the
// order the in-app switcher shows, so "first" means the same thing everywhere.
// `activeOrganizationId` is never consulted (D001): it can name an org the user left.
const homeFor = createServerFn({ method: "GET" }).handler(async () => {
  const { headers } = getRequest();
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  const organizations = await auth.api.listOrganizations({ headers });
  const [first] = organizations.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  return first?.slug ?? "";
});

// Throws a redirect for a signed-in visitor; returns for a signed-out one. `href`
// is an already-validated destination that wins over the default, so a deep link
// that bounced through sign-in still lands where it was going.
export async function redirectSignedInHome(href?: string): Promise<void> {
  const orgSlug = await homeFor();
  if (orgSlug === null) return;
  if (href) throw redirect({ href });
  if (orgSlug) throw redirect({ to: "/$orgSlug/dashboard", params: { orgSlug } });
  throw redirect({ to: "/join" });
}
