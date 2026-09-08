import { Button, buttonVariants } from "@hms/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon, Building2Icon, MailIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InvitationAccess } from "@/components/invitation-access";
import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { SignInForm } from "@/components/sign-in-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export const Route = createFileRoute("/join")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    typeof search.invitation === "string" && search.invitation.length > 0
      ? { invitation: search.invitation }
      : {},
  component: JoinOrganizationRoute,
});

function JoinOrganizationRoute() {
  const { invitation } = Route.useSearch();
  const { data: session, isPending, error } = authClient.useSession();

  let content: ReactNode = (
    <p role="status" className="text-xs text-muted-foreground">
      Loading your account…
    </p>
  );
  if (error) {
    content = <ErrorNote title="Could not load your account" error={error} />;
  } else if (!isPending && !session) {
    content = invitation ? (
      <InvitationAccess key={invitation} invitationId={invitation} />
    ) : (
      <SignInForm />
    );
  } else if (session) {
    content = (
      <div key={session.user.id} className="flex flex-col gap-6">
        {invitation ? (
          <InvitationAccess
            key={invitation}
            invitationId={invitation}
            accountEmail={session.user.email}
          />
        ) : (
          <OrganizationPicker userId={session.user.id} />
        )}
        <SwitchAccount email={session.user.email} />
      </div>
    );
  }

  return (
    <OrganizationEntryLayout
      eyebrow="JOIN YOUR HOSPITAL"
      title="Continue where your hospital works."
      description="Create your account from an invitation, or sign in to open your organizations."
      aside={null}
    >
      {content}
    </OrganizationEntryLayout>
  );
}

function OrganizationPicker({ userId }: { userId: string }) {
  const destinations = useQuery({
    queryKey: ["auth", "join", userId],
    queryFn: async () => {
      const [organizations, invitations] = await Promise.all([
        authClient.organization.list(),
        authClient.organization.listUserInvitations(),
      ]);
      if (organizations.error)
        throw new Error(
          authErrorMessage(organizations.error, "Could not load organizations. Try again."),
        );
      if (invitations.error)
        throw new Error(
          authErrorMessage(invitations.error, "Could not load invitations. Try again."),
        );
      return { organizations: organizations.data, invitations: invitations.data };
    },
  });

  if (destinations.isPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading organizations…
      </p>
    );
  if (destinations.error)
    return (
      <ErrorNote title="Could not load organizations and invitations" error={destinations.error} />
    );
  const { organizations, invitations } = destinations.data;
  const pending = invitations.filter(
    (invitation) => new Date(invitation.expiresAt).getTime() > Date.now(),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-medium">Choose where to continue</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Review an invitation or open an existing organization.
        </p>
      </div>
      {pending.length > 0 && (
        <section aria-labelledby="pending-invitations">
          <h3
            id="pending-invitations"
            className="mb-2 font-mono text-xs tracking-widest text-muted-foreground"
          >
            INVITATIONS
          </h3>
          <div className="divide-y divide-border border-y border-border">
            {pending.map((invitation) => (
              <div key={invitation.id} className="flex items-center gap-3 py-3">
                <MailIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-xs font-medium">{invitation.organizationName}</p>
                  <p className="text-xs text-muted-foreground">Invited as {invitation.role}</p>
                </div>
                <Link
                  to="/join"
                  search={{ invitation: invitation.id }}
                  className={buttonVariants({ size: "sm" })}
                >
                  <ArrowRightIcon />
                  Review invitation
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
      {organizations.length > 0 && (
        <section aria-labelledby="your-organizations">
          <h3
            id="your-organizations"
            className="mb-2 font-mono text-xs tracking-widest text-muted-foreground"
          >
            YOUR ORGANIZATIONS
          </h3>
          <div className="flex flex-col gap-1">
            {organizations.map((organization) => (
              <Link
                key={organization.id}
                to="/$orgSlug/dashboard"
                params={{ orgSlug: organization.slug }}
                className={buttonVariants({
                  variant: "ghost",
                  className: "h-10 w-full justify-start gap-3 px-2",
                })}
              >
                <Building2Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left text-xs">
                  {organization.name}
                </span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {pending.length === 0 && organizations.length === 0 && (
        <div className="border-l-2 border-border pl-3">
          <p className="text-xs font-medium">No organization access yet</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Ask an administrator to invite this account, then return using the invitation link.
          </p>
        </div>
      )}
      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        Founding operator?{" "}
        <Link to="/create" className="text-foreground underline underline-offset-4">
          Create an organization
        </Link>
      </p>
    </div>
  );
}

function SwitchAccount({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(authErrorMessage(error, "Could not sign out. Try again."));
      queryClient.clear();
    },
  });
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <p className="break-all text-xs text-muted-foreground">Signed in as {email}.</p>
      <Button
        variant="link"
        className="self-start px-0"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Switch account
      </Button>
      {signOut.error && <ErrorNote title="Could not sign out" error={signOut.error} />}
    </div>
  );
}
