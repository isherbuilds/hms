import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
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
  RegisteredFormField,
} from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
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
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError } from "@/lib/orpc-error";
import { PAYER_TYPE_LABELS, PAYER_TYPES, type PayerType } from "@/lib/payer";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

type Payer = {
  id: string;
  name: string;
  type: PayerType;
  active: boolean;
};

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Keep the name under 200 characters"),
  type: z.enum(PAYER_TYPES),
  active: z.boolean(),
});

type PayerFormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: PayerFormValues = { name: "", type: "insurer", active: true };

export const Route = createFileRoute("/$orgSlug/settings/payers")({
  head: () => ({ meta: [{ title: "Payers · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // Reading payers is org-wide (the registration picker needs it); this page only
    // edits them, so the tab strip gates it on `update` too.
    await requireOrgPermission(queryClient, orgSlug, { payer: ["update"] }, "/$orgSlug/settings");
    await queryClient.prefetchQuery(orpc.payer.list.queryOptions({ input: { orgSlug } }));
  },
  component: PayersRoute,
});

function PayersRoute() {
  const { orgSlug } = Route.useParams();
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const canCreate = authorize(roles, { payer: ["create"] });
  const canUpdate = authorize(roles, { payer: ["update"] });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Payer | null>(null);
  const payers = useQuery(orpc.payer.list.queryOptions({ input: { orgSlug } }));
  const rows = payers.data ?? [];

  return (
    <>
      <PageHeader
        title="Payers"
        action={
          canCreate ? <Button onClick={() => setCreateOpen(true)}>New payer</Button> : undefined
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <Panel grow>
          <ListState
            query={payers}
            errorTitle="Could not load payers"
            isEmpty={rows.length === 0}
            empty="No payers yet."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  {canUpdate ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((payer) => (
                  <TableRow key={payer.id}>
                    <TableCell className="font-medium">{payer.name}</TableCell>
                    <TableCell>{PAYER_TYPE_LABELS[payer.type]}</TableCell>
                    <TableCell>
                      <Badge variant={payer.active ? "secondary" : "muted"}>
                        {payer.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canUpdate ? (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="xs" onClick={() => setEditing(payer)}>
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>

      {canCreate ? (
        <PayerDialog
          mode="create"
          orgSlug={orgSlug}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      ) : null}
      {canUpdate && editing ? (
        <PayerDialog
          key={editing.id}
          mode="edit"
          orgSlug={orgSlug}
          payer={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

type PayerDialogProps =
  | {
      mode: "create";
      orgSlug: string;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
  | {
      mode: "edit";
      orgSlug: string;
      payer: Payer;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };

function PayerDialog(props: PayerDialogProps) {
  const { mode, orgSlug, open, onOpenChange } = props;
  const payer = mode === "edit" ? props.payer : null;

  const form = useZodForm(formSchema, {
    defaultValues: payer
      ? { name: payer.name, type: payer.type, active: payer.active }
      : EMPTY_VALUES,
  });

  const closeAfterSuccess = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    form.reset(payer ? undefined : EMPTY_VALUES);
  };

  const handleError = (error: Error) =>
    applyOrpcFieldError(form, error, {
      duplicate: { field: "name", message: "Name already in use" },
    });

  const create = useMutation(
    orpc.payer.create.mutationOptions({
      onSuccess: () => closeAfterSuccess("Payer created"),
      onError: handleError,
    }),
  );

  const update = useMutation(
    orpc.payer.update.mutationOptions({
      onSuccess: () => closeAfterSuccess("Payer updated"),
      onError: handleError,
    }),
  );

  const isPending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit((values) => {
    if (payer) {
      update.mutate({ orgSlug, payerId: payer.id, ...values });
    } else {
      create.mutate({ orgSlug, name: values.name, type: values.type });
    }
  });

  const changeOpen = (next: boolean) => {
    if (!next && !isPending) {
      form.reset(payer ? undefined : EMPTY_VALUES);
      onOpenChange(false);
    } else if (next) {
      onOpenChange(true);
    }
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{payer ? "Edit payer" : "New payer"}</DialogTitle>
            <DialogDescription>
              {payer
                ? "Update the payer name, type, or availability."
                : "Add an organization that can sponsor patient care."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="name" label="Name" disabled={isPending} />
                <RegisteredFormField
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={isPending}>
                          {PAYER_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {PAYER_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {payer ? (
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormLabel>Active</FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => changeOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <SubmitButton isSubmitting={isPending}>
                  {payer ? "Save changes" : "Create payer"}
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
