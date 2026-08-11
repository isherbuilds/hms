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
} from "@hms/ui/components/form";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

const ACTIVE_STATUSES = ["waiting", "in_consult"] as const;
const ALL_STATUSES = ["waiting", "in_consult", "completed", "cancelled"] as const;
type VisitStatus = (typeof ALL_STATUSES)[number];

const SELECT_CLASS =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30";

const STATUS_LABELS: Record<VisitStatus, string> = {
  waiting: "Waiting",
  in_consult: "In consult",
  completed: "Completed",
  cancelled: "Cancelled",
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(1, "Enter a cancellation reason").max(500),
});

export const Route = createFileRoute("/org/$orgSlug/front-desk/queue")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void Promise.all([
      queryClient.prefetchQuery(
        orpc.visit.queue.queryOptions({ input: { orgSlug, statuses: [...ACTIVE_STATUSES] } }),
      ),
      queryClient.prefetchQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: QueueRoute,
});

function QueueRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const [departmentId, setDepartmentId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [cancellingVisitId, setCancellingVisitId] = useState<string | null>(null);
  const statuses = includeClosed ? [...ALL_STATUSES] : [...ACTIVE_STATUSES];

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const queue = useQuery(
    orpc.visit.queue.queryOptions({
      input: {
        orgSlug,
        departmentId: departmentId || undefined,
        practitionerId: practitionerId || undefined,
        statuses,
      },
    }),
  );

  const transition = useMutation(
    orpc.visit.transition.mutationOptions({
      onSuccess: (visit) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.visit.queue.key({ input: { orgSlug } }),
        });
        toast.success(
          visit.status === "in_consult"
            ? "Consultation started"
            : visit.status === "completed"
              ? "Visit completed"
              : "Visit cancelled",
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <>
      <PageHeader title="Queue" description="Today's outpatient queue" />
      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-52 flex-col gap-1.5 text-xs font-medium">
            Department
            <select
              className={SELECT_CLASS}
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                if (
                  practitionerId &&
                  practitioners.data?.find((item) => item.id === practitionerId)?.departmentId !==
                    event.target.value
                ) {
                  setPractitionerId("");
                }
              }}
            >
              <option value="">All departments</option>
              {(departments.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-52 flex-col gap-1.5 text-xs font-medium">
            Practitioner
            <select
              className={SELECT_CLASS}
              value={practitionerId}
              onChange={(event) => setPractitionerId(event.target.value)}
            >
              <option value="">All practitioners</option>
              {(practitioners.data ?? [])
                .filter((item) => !departmentId || item.departmentId === departmentId)
                .map((practitioner) => (
                  <option key={practitioner.id} value={practitioner.id}>
                    {practitioner.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex h-8 items-center gap-2 text-xs font-medium">
            <Checkbox checked={includeClosed} onCheckedChange={setIncludeClosed} />
            Include completed and cancelled
          </label>
        </div>

        {queue.isPending ? (
          <div
            className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground"
            aria-busy
          >
            Loading queue…
          </div>
        ) : queue.isError ? (
          <ErrorNote title="Could not load queue" detail={queue.error.message} />
        ) : queue.data.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No visits match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Practitioner</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.data.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell>
                      <Link
                        to="/org/$orgSlug/front-desk/visits/$visitId"
                        params={{ orgSlug, visitId: visit.id }}
                        className="text-lg font-semibold tabular-nums underline-offset-4 hover:underline"
                      >
                        {visit.tokenNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/org/$orgSlug/front-desk/visits/$visitId"
                        params={{ orgSlug, visitId: visit.id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {visit.patientName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{visit.patientMrn}</p>
                    </TableCell>
                    <TableCell>{visit.practitionerName}</TableCell>
                    <TableCell>{visit.departmentName}</TableCell>
                    <TableCell>
                      <VisitStatusBadge status={visit.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {timeFormatter.format(new Date(visit.createdAt))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {visit.status === "waiting" ? (
                          <>
                            <Button
                              size="xs"
                              disabled={transition.isPending}
                              onClick={() =>
                                transition.mutate({ orgSlug, visitId: visit.id, to: "in_consult" })
                              }
                            >
                              Start consult
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={transition.isPending}
                              onClick={() => setCancellingVisitId(visit.id)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : visit.status === "in_consult" ? (
                          <Button
                            size="xs"
                            disabled={transition.isPending}
                            onClick={() =>
                              transition.mutate({ orgSlug, visitId: visit.id, to: "completed" })
                            }
                          >
                            Complete
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>

      {cancellingVisitId ? (
        <CancelVisitDialog
          orgSlug={orgSlug}
          visitId={cancellingVisitId}
          onClose={() => setCancellingVisitId(null)}
        />
      ) : null}
    </>
  );
}

function VisitStatusBadge({ status }: { status: string }) {
  const variant =
    status === "waiting"
      ? "secondary"
      : status === "in_consult"
        ? "default"
        : status === "cancelled"
          ? "destructive"
          : "muted";
  return <Badge variant={variant}>{STATUS_LABELS[status as VisitStatus] ?? status}</Badge>;
}

function CancelVisitDialog({
  orgSlug,
  visitId,
  onClose,
}: {
  orgSlug: string;
  visitId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });
  const cancel = useMutation(
    orpc.visit.transition.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.visit.queue.key({ input: { orgSlug } }),
        });
        toast.success("Visit cancelled");
        onClose();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit(({ cancelReason }) => {
    cancel.mutate({ orgSlug, visitId, to: "cancelled", cancelReason });
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel visit</DialogTitle>
          <DialogDescription>
            The reason is recorded on the visit and its pending charges.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="cancelReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} autoFocus disabled={cancel.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={cancel.isPending} onClick={onClose}>
                Keep visit
              </Button>
              <SubmitButton isSubmitting={cancel.isPending}>Cancel visit</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
