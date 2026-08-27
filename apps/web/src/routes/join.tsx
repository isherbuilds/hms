import { Button, buttonVariants } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, Building2Icon, LoaderIcon, MailIcon } from "lucide-react";
import { useState } from "react";

import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/join")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    typeof search.invitation === "string" ? { invitation: search.invitation } : {},
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: JoinOrganizationRoute,
});

function JoinOrganizationRoute() {
  const { invitation: highlightedId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizations = authClient.useListOrganizations();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const invitations = useQuery({
    queryKey: ["auth", "user-invitations"],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listUserInvitations();
      if (error) throw new Error(error.message || "Invitations could not be loaded.");
      return data ?? [];
    },
  });

  const pending = invitations.data ?? [];
  const orderedInvitations = highlightedId
    ? [...pending].sort(
        (left, right) => Number(right.id === highlightedId) - Number(left.id === highlightedId),
      )
    : pending;
  const highlightedMissing = Boolean(
    highlightedId && !invitations.isPending && !pending.some(({ id }) => id === highlightedId),
  );

  const acceptInvitation = async (invitationId: string, organizationId: string) => {
    setAcceptingId(invitationId);
    setActionError(null);
    try {
      const { error } = await authClient.organization.acceptInvitation({ invitationId });
      if (error) {
        setActionError(error.message || "This invitation could not be accepted.");
        return;
      }
      const [{ data: joined }] = await Promise.all([
        authClient.organization.getFullOrganization({ query: { organizationId } }),
        queryClient.invalidateQueries({ queryKey: ["auth", "user-invitations"] }),
      ]);
      if (!joined) {
        setActionError("You joined, but the organization could not be opened. Choose it below.");
        await organizations.refetch();
        return;
      }
      await navigate({ to: "/$orgSlug/onboarding", params: { orgSlug: joined.slug } });
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "This invitation could not be accepted.",
      );
    } finally {
      setAcceptingId(null);
    }
  };

  const mine = organizations.data ?? [];
  const loading = organizations.isPending || invitations.isPending;

  return (
    <OrganizationEntryLayout
      eyebrow="OPEN ORGANIZATION"
      title="Continue where your hospital works."
      description="Accept an invitation or open an organization already connected to this account. The organization stays explicit in every tab's URL."
      aside={null}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-sm font-medium">Choose where to continue</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Invitations appear first; existing organizations stay one click away.
          </p>
        </div>

        {loading ? null : (
          <div className="flex flex-col gap-4">
            {orderedInvitations.length > 0 && (
              <section aria-labelledby="pending-invitations">
                <h3
                  id="pending-invitations"
                  className="mb-2 font-mono text-xs tracking-widest text-muted-foreground"
                >
                  INVITATIONS
                </h3>
                <div className="divide-y divide-border border-y border-border">
                  {orderedInvitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className={cn(
                        "flex items-center gap-3 py-3",
                        invitation.id === highlightedId && "border-l-2 border-foreground pl-3",
                      )}
                    >
                      <MailIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="truncate text-xs font-medium">
                          {invitation.organizationName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Invited as {invitation.role}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={acceptingId !== null}
                        onClick={() =>
                          void acceptInvitation(invitation.id, invitation.organizationId)
                        }
                      >
                        {acceptingId === invitation.id ? (
                          <LoaderIcon className="animate-spin" />
                        ) : (
                          <ArrowRightIcon />
                        )}
                        {acceptingId === invitation.id ? "Joining…" : "Join"}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {mine.length > 0 && (
              <section aria-labelledby="your-organizations">
                <h3
                  id="your-organizations"
                  className="mb-2 font-mono text-xs tracking-widest text-muted-foreground"
                >
                  YOUR ORGANIZATIONS
                </h3>
                <div className="flex flex-col gap-1">
                  {mine.map((organization) => (
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

            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              Founding operator?{" "}
              <Link to="/create" className="text-foreground underline underline-offset-4">
                Create an organization
              </Link>
            </p>

            {orderedInvitations.length === 0 && mine.length === 0 && !highlightedMissing && (
              <div className="border-l-2 border-border pl-3">
                <p className="text-xs font-medium">No organization access yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Ask an administrator to invite this account, then return using the invitation
                  link.
                </p>
              </div>
            )}
          </div>
        )}

        {(actionError || invitations.error || organizations.error || highlightedMissing) && (
          <ErrorNote
            title={
              actionError ??
              (invitations.error instanceof Error ? invitations.error.message : undefined) ??
              organizations.error?.message ??
              "This invitation is no longer available. Ask the sender for a new link."
            }
          />
        )}
      </div>
    </OrganizationEntryLayout>
  );
}
