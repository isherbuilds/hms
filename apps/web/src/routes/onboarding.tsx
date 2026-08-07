import { Button, buttonVariants } from "@better-stack/ui/components/button";
import { Input } from "@better-stack/ui/components/input";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  // The key stays absent (not `undefined`) when there is no invitation, so
  // navigating to /onboarding does not have to name a search param.
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    typeof search.invitation === "string" ? { invitation: search.invitation } : {},
  // An invite link lands here signed out — accounts are created by an
  // operator, so a recipient without an account yet cannot accept. Carry the
  // whole location through /login so `?invitation=` survives the round trip
  // and the Join panel renders on return.
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: OnboardingRoute,
});

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "org"}-${crypto.randomUUID().slice(0, 6)}`;
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ring-1 ring-border">
      <header className="border-b border-border px-3 py-2">
        <h2 className="cn-font-heading text-xs font-medium">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function OnboardingRoute() {
  const { invitation: highlightedId } = Route.useSearch();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const organizations = authClient.useListOrganizations();

  const acceptInvitation = async (invitationId: string) => {
    setBusy(true);
    try {
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (error) {
        toast.error(error.message || "Could not accept the invitation");
        return;
      }
      // The invitation carries only the org id; the route is keyed by slug.
      const { data: joined } = await authClient.organization.getFullOrganization({
        query: { organizationId: data.invitation.organizationId },
      });
      await organizations.refetch();
      if (!joined) {
        toast.error("Joined, but could not open the organization. Pick it from the list.");
        return;
      }
      await navigate({ to: "/org/$orgSlug/dashboard", params: { orgSlug: joined.slug } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not accept the invitation");
    } finally {
      setBusy(false);
    }
  };

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await authClient.organization.create({
        name: name.trim(),
        slug: slugify(name),
      });
      if (error) {
        toast.error(error.message || "Could not create the organization");
        return;
      }
      await organizations.refetch();
      await navigate({ to: "/org/$orgSlug/dashboard", params: { orgSlug: data.slug } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the organization");
    } finally {
      setBusy(false);
    }
  };

  const mine = organizations.data ?? [];

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="cn-font-heading text-sm font-medium">Choose an organization</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every screen in this app belongs to exactly one organization. This tab will work in the
          one you pick — other tabs are unaffected.
        </p>
      </div>

      {organizations.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        mine.length > 0 && (
          <Section title="Your organizations" hint="Pick one to continue.">
            <div className="flex flex-col gap-1">
              {mine.map((org) => (
                <Link
                  key={org.id}
                  to="/org/$orgSlug/dashboard"
                  params={{ orgSlug: org.slug }}
                  className={buttonVariants({
                    variant: "ghost",
                    size: "lg",
                    className: "h-10 w-full justify-start gap-2 px-2",
                  })}
                >
                  <span className="min-w-0 truncate text-xs">{org.name}</span>
                </Link>
              ))}
            </div>
          </Section>
        )
      )}

      {highlightedId && (
        <Section title="Invitation" hint="Join the organization that invited this account.">
          <div className="flex items-center gap-2 px-2 py-1.5 ring-1 ring-foreground/30">
            <span className="min-w-0 flex-1 text-xs">Your invitation is ready.</span>
            <Button
              size="sm"
              disabled={busy}
              autoFocus
              onClick={() => void acceptInvitation(highlightedId)}
            >
              Join
            </Button>
          </div>
        </Section>
      )}

      <Section
        title="Create an organization"
        hint="Start a new workspace. You will be its owner and can invite others."
      >
        <form onSubmit={createOrganization} className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Organization name"
            aria-label="Organization name"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Working…" : "Create"}
          </Button>
        </form>
      </Section>
    </div>
  );
}
