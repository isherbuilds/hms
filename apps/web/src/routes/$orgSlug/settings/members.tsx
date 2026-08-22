import { ORG_ROLES, parseRoles } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { Empty, EmptyHeader } from "@hms/ui/components/empty";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CopyIcon, MoreHorizontalIcon, SearchIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageBody, PageHeader } from "@/components/page";
import { useConfirm } from "@/components/confirm-dialog";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";

const MEMBER_PAGE_LIMIT = 100;

export const Route = createFileRoute("/$orgSlug/settings/members")({
  head: () => ({ meta: [{ title: "Members · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.prefetchQuery(
      orpc.member.list.queryOptions({ input: { orgSlug, limit: MEMBER_PAGE_LIMIT } }),
    );
  },
  component: MembersRoute,
});

/** A role is a comma-joined union, so it renders as one badge per role. */
function RoleBadge({ role }: { role: string }) {
  const roles = parseRoles(role);
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((one) => (
        <Badge key={one} variant={one === "owner" ? "default" : "muted"}>
          {one}
        </Badge>
      ))}
    </span>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  role: z.enum(ORG_ROLES),
});

function InviteDialog({
  open,
  onOpenChange,
  orgSlug,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgSlug: string;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(inviteSchema, {
    defaultValues: { email: "", role: "member" },
  });
  const [lastLink, setLastLink] = useState<string | null>(null);

  const invite = useMutation(
    orpc.member.invite.mutationOptions({
      onSuccess: (result) => {
        form.reset();
        setLastLink(result.url);
        toast.success(`Invitation sent to ${result.email}`);
        // Returned, so the form stays pending until the member list shows the
        // invitation instead of settling before it exists.
        return queryClient.invalidateQueries({
          queryKey: orpc.member.list.key({ input: { orgSlug } }),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = form.handleSubmit((values) => invite.mutate({ orgSlug, ...values }));

  // `lastLink` is a single-use credential for one address — it must never
  // survive into the next invitation.
  const change = (next: boolean) => {
    if (!next) {
      form.reset();
      setLastLink(null);
    }
    onOpenChange(next);
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite someone to this organization</DialogTitle>
            <DialogDescription>
              Sign-up is disabled, so the person needs an account first — have your administrator
              run the create-user script — then invite them here with the role you pick. Roles can
              be changed later.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="person@example.com"
                        disabled={invite.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <div role="group" aria-label="Role" className="flex gap-1">
                      {ORG_ROLES.map((option) => (
                        <Button
                          key={option}
                          type="button"
                          variant={field.value === option ? "secondary" : "ghost"}
                          size="sm"
                          aria-pressed={field.value === option}
                          onClick={() => field.onChange(option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  </FormItem>
                )}
              />

              {lastLink && (
                <div className="flex min-w-0 items-center gap-2 bg-muted p-2">
                  <p className="min-w-0 flex-1 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground">
                    {lastLink}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      navigator.clipboard.writeText(lastLink);
                      toast.success("Invitation link copied");
                    }}
                  >
                    <CopyIcon />
                    Copy link
                  </Button>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => change(false)}>
                  Done
                </Button>
                <Button type="submit" disabled={invite.isPending}>
                  {invite.isPending ? "Sending…" : "Send invitation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

function MembersRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const queryClient = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Deferred so fast typing coalesces requests without bridging cached rows
  // when the organization route changes.
  const q = useDeferredValue(search.trim());
  const members = useQuery(
    orpc.member.list.queryOptions({
      input: { orgSlug, limit: MEMBER_PAGE_LIMIT, ...(q ? { q } : {}) },
    }),
  );

  // Role changes, removals and revocations are audited server-side, so the
  // audit trail on the neighbouring screen is stale the moment one succeeds.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.member.list.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.audit.list.key({ input: { orgSlug } }),
      }),
    ]);
  const onError = (error: Error) => toast.error(error.message);

  const updateRole = useMutation(
    orpc.member.updateRole.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("Role updated");
      },
      onError,
    }),
  );
  const removeMember = useMutation(
    orpc.member.remove.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("Member removed");
      },
      onError,
    }),
  );
  const revoke = useMutation(
    orpc.member.revokeInvitation.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("Invitation revoked");
      },
      onError,
    }),
  );

  const people = members.data?.members ?? [];
  const invitations = members.data?.invitations ?? [];
  const truncated = people.length === MEMBER_PAGE_LIMIT;

  return (
    <>
      <PageHeader
        title="Members"
        description={
          (truncated
            ? `first ${MEMBER_PAGE_LIMIT} people — search to narrow`
            : `${people.length} ${people.length === 1 ? "person" : "people"}`) +
          (invitations.length > 0 ? ` · ${invitations.length} invited` : "")
        }
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlusIcon />
            Invite
          </Button>
        }
      />

      <PageBody>
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search members"
            placeholder="Search by name or email"
            className="pl-7"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {members.isPending ? null : members.isError ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <p className="text-sm font-medium">Could not load members</p>
              <p className="text-xs text-muted-foreground">{members.error.message}</p>
            </EmptyHeader>
            <Button variant="outline" onClick={() => members.refetch()}>
              Try again
            </Button>
          </Empty>
        ) : people.length === 0 && invitations.length === 0 && q ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <SearchIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No one matches “{q}”</p>
              <p className="text-xs text-muted-foreground">
                Search covers member names, emails, and invited addresses.
              </p>
            </EmptyHeader>
          </Empty>
        ) : people.length === 0 && invitations.length === 0 ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <UsersIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You are the only one here</p>
              <p className="text-xs text-muted-foreground">
                Accounts are created by an administrator. Invite a colleague to get them into this
                organization.
              </p>
            </EmptyHeader>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlusIcon />
              Invite someone
            </Button>
          </Empty>
        ) : (
          <div className="ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{person.name}</div>
                          <div className="truncate text-muted-foreground">{person.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={person.role} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">active</TableCell>
                    <TableCell>
                      <ClientOnly fallback={null}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            aria-label={`Actions for ${person.name || person.email}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Change role</DropdownMenuLabel>
                              {ORG_ROLES.map((option) => (
                                <DropdownMenuItem
                                  key={option}
                                  disabled={
                                    parseRoles(person.role).includes(option) || updateRole.isPending
                                  }
                                  onClick={() =>
                                    updateRole.mutate({
                                      orgSlug,
                                      memberId: person.id,
                                      role: option,
                                    })
                                  }
                                >
                                  {option}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={removeMember.isPending}
                              onClick={() =>
                                confirm({
                                  title: "Remove from organization?",
                                  description: `${person.name || person.email} loses access to this organization immediately. Their audit history is kept.`,
                                  confirmLabel: "Remove",
                                  run: () => removeMember.mutate({ orgSlug, memberId: person.id }),
                                })
                              }
                            >
                              Remove from organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ClientOnly>
                    </TableCell>
                  </TableRow>
                ))}

                {invitations.map((invitation) => (
                  <TableRow key={invitation.id} className="text-muted-foreground">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{invitation.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={invitation.role ?? "member"} />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline">invited</Badge>
                        expires {formatDate(invitation.expiresAt, timeZone)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() =>
                          confirm({
                            title: "Revoke this invitation?",
                            description: `The link sent to ${invitation.email} stops working. You can invite them again afterwards.`,
                            confirmLabel: "Revoke",
                            run: () => revoke.mutate({ orgSlug, invitationId: invitation.id }),
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} orgSlug={orgSlug} />
      {confirmDialog}
    </>
  );
}
