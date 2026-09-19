import { ORG_ROLES, ROLE_LABELS, parseRoles } from "@hms/auth/access";
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
import { Form } from "@hms/ui/components/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CopyIcon, MoreHorizontalIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useConfirm } from "@/components/confirm-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import {
  ListState,
  ListToolbar,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { useCan } from "@/lib/membership";

import { SettingsTabs } from "./route";

const MEMBER_PAGE_LIMIT = 100;

export const Route = createFileRoute("/$orgSlug/settings/members")({
  head: () => ({ meta: [{ title: "Members · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient
      .query(orpc.member.list.queryOptions({ input: { orgSlug, limit: MEMBER_PAGE_LIMIT } }))
      .catch(() => {});
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
          {ROLE_LABELS[one]}
        </Badge>
      ))}
    </span>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  role: z.enum(ORG_ROLES, { error: "Select a role" }),
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
  const form = useZodForm(inviteSchema, {
    defaultValues: { email: "" },
  });

  const [lastLink, setLastLink] = useState<string | null>(null);

  const invite = useMutation(
    orpc.member.invite.mutationOptions({
      onSuccess: (result) => {
        form.reset();
        setLastLink(result.url);
        toast.success(`Invitation created for ${result.email}`);
      },
    }),
  );

  // `lastLink` is a single-use credential for one address — it must never survive
  // into the next invitation, so it clears the moment a new one is submitted.
  const submit = form.handleSubmit((values) => {
    setLastLink(null);
    invite.mutate({ orgSlug, ...values });
  });

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
              Nothing is emailed: share the link yourself. It lets the invited email create an
              account or sign in, then join. Roles can be changed later.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-3">
              <TextField
                name="email"
                label="Email address"
                type="email"
                placeholder="person@example.com"
                disabled={invite.isPending}
              />

              <ControlledField
                name="role"
                label="Role"
                render={(field) => (
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
                        {ROLE_LABELS[option]}
                      </Button>
                    ))}
                  </div>
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
                    onClick={() =>
                      navigator.clipboard.writeText(lastLink).then(
                        () => toast.success("Invitation link copied"),
                        () => toast.error("Could not copy the link; select it and copy by hand"),
                      )
                    }
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
                  {invite.isPending ? "Creating…" : "Create invitation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

function InviteAction({ orgSlug, compact = false }: { orgSlug: string; compact?: boolean }) {
  const canInvite = useCan(orgSlug, { invitation: ["create"] });
  const [open, setOpen] = useState(false);

  if (!canInvite) return null;

  return (
    <>
      <Button size={compact ? "xs" : undefined} onClick={() => setOpen(true)}>
        {compact ? "Invite someone" : "Invite"}
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} orgSlug={orgSlug} />
    </>
  );
}

function MemberResults({ orgSlug, q }: { orgSlug: string; q: string }) {
  const { timeZone } = useOrgDateTime();
  const [confirm, confirmDialog] = useConfirm();

  // `q` stays off the input when empty, so the query key matches the unfiltered roster.
  const listInput = q
    ? { orgSlug, limit: MEMBER_PAGE_LIMIT, q }
    : { orgSlug, limit: MEMBER_PAGE_LIMIT };

  const members = useQuery(orpc.member.list.queryOptions({ input: listInput }));

  // The roster is readable org-wide; only its actions need the grant.
  const canManage = useCan(orgSlug, { member: ["update", "delete"] });
  const canRevoke = useCan(orgSlug, { invitation: ["cancel"] });

  const updateRole = useMutation(
    orpc.member.updateRole.mutationOptions({
      onSuccess: () => toast.success("Role updated"),
    }),
  );

  const removeMember = useMutation(
    orpc.member.remove.mutationOptions({
      onSuccess: () => toast.success("Member removed"),
    }),
  );

  const revoke = useMutation(
    orpc.member.revokeInvitation.mutationOptions({
      onSuccess: () => toast.success("Invitation canceled"),
    }),
  );

  const people = members.data?.members ?? [];
  const invitations = members.data?.invitations ?? [];

  return (
    <>
      <Panel
        label="People"
        action={
          <span className="shrink-0 tabular-nums">
            {people.length === MEMBER_PAGE_LIMIT
              ? `first ${MEMBER_PAGE_LIMIT} — search to narrow`
              : people.length}
            {invitations.length > 0 ? ` · ${invitations.length} invited` : ""}
          </span>
        }
      >
        <ListState
          query={members}
          errorTitle="Could not load members"
          isEmpty={people.length === 0 && invitations.length === 0}
          empty={
            q ? (
              <p className="max-w-sm">
                Nobody matches “{q}”. Search covers names, email addresses and invitations.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <UsersIcon className="size-5 text-muted-foreground" />
                <p className="max-w-sm">
                  You are the only one here. Invite someone and share the link; they create their
                  account from it.
                </p>
                <InviteAction orgSlug={orgSlug} compact />
              </div>
            )
          }
        >
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
                    <div className="min-w-0">
                      <div className="truncate font-medium">{person.name}</div>
                      <div className="truncate text-muted-foreground">{person.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={person.role} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">active</TableCell>
                  <TableCell className="text-right">
                    <ClientOnly fallback={null}>
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-xs" />}
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
                                  {ROLE_LABELS[option]}
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
                      ) : null}
                    </ClientOnly>
                  </TableCell>
                </TableRow>
              ))}

              {invitations.map((invitation) => (
                <TableRow key={invitation.id} className="text-muted-foreground">
                  <TableCell>
                    <div className="truncate">{invitation.email}</div>
                  </TableCell>
                  <TableCell>
                    {invitation.role ? <RoleBadge role={invitation.role} /> : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Badge variant="outline">invited</Badge>
                      expires {formatDate(invitation.expiresAt, timeZone)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="flex justify-end gap-1">
                      {/* Rows arrive only for members with the invite grant. */}
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          navigator.clipboard.writeText(invitation.url).then(
                            () => toast.success("Invitation link copied"),
                            () => toast.error("Could not copy the link"),
                          )
                        }
                      >
                        <CopyIcon />
                        Copy link
                      </Button>
                      {canRevoke ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={revoke.isPending}
                          onClick={() =>
                            confirm({
                              title: "Cancel this invitation?",
                              description: `The link for ${invitation.email} stops working. You can invite them again afterwards.`,
                              confirmLabel: "Cancel invitation",
                              run: () => revoke.mutate({ orgSlug, invitationId: invitation.id }),
                            })
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListState>
      </Panel>
      {confirmDialog}
    </>
  );
}

function MemberDirectory({ orgSlug }: { orgSlug: string }) {
  const [q, setQ] = useState("");

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search members"
          placeholder="Search by name or email"
          onQueryChange={setQ}
        />
      </ListToolbar>
      <MemberResults orgSlug={orgSlug} q={q} />
    </PageBody>
  );
}

function MembersRoute() {
  const { orgSlug } = Route.useParams();

  return (
    <>
      <PageHeader title="Members" action={<InviteAction orgSlug={orgSlug} />} />
      <SettingsTabs orgSlug={orgSlug} />
      <MemberDirectory key={orgSlug} orgSlug={orgSlug} />
    </>
  );
}
