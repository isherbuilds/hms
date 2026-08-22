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
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toastOpdConflict } from "@/lib/opd-operational-query";
import { orpc } from "@/lib/orpc";

/**
 * The pieces the queue board and one appointment's own page both need. They were
 * duplicated verbatim in both routes, which is how the two screens ended up
 * able to disagree about what a status is called or what a refused cancel
 * means — so they live here once instead.
 */

const OPD_STATUS_LABELS = {
  booked: "Booked",
  waiting: "Waiting",
  in_consult: "In consult",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
  left_unseen: "Left unseen",
} as const;

type OpdAppointmentStatus = keyof typeof OPD_STATUS_LABELS;

export function OpdAppointmentStatusBadge({ status }: { status: OpdAppointmentStatus }) {
  const variant =
    status === "waiting"
      ? "secondary"
      : status === "in_consult"
        ? "default"
        : status === "cancelled"
          ? "destructive"
          : "muted";
  return <Badge variant={variant}>{OPD_STATUS_LABELS[status]}</Badge>;
}

/**
 * The four status transitions both the queue board and the appointment page
 * fire, defined once so their wording and race handling cannot drift apart.
 * Each screen composes its own "something is changing" flag from what this
 * returns.
 */
export function useOpdStatusActions(orgSlug: string) {
  const queryClient = useQueryClient();

  const startConsultation = useMutation(
    orpc.opd.startConsultation.mutationOptions({
      onSuccess: (appointment) => {
        toast.success("Consultation started");
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );
  const complete = useMutation(
    orpc.opd.complete.mutationOptions({
      onSuccess: (appointment) => {
        toast.success("OPD appointment completed");
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );
  const checkIn = useMutation(
    orpc.opd.checkIn.mutationOptions({
      onSuccess: ({ appointment }) => {
        toast.success(`Checked in · Token ${appointment.tokenNumber}`);
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );
  const markNoShow = useMutation(
    orpc.opd.markNoShow.mutationOptions({
      onSuccess: (appointment) => {
        toast.success("Marked as no show");
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );

  return { startConsultation, complete, checkIn, markNoShow };
}

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(1, "Enter a cancellation reason").max(500),
});

export function CancelOpdAppointmentDialog({
  orgSlug,
  appointmentId,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });
  const cancel = useMutation(
    orpc.opd.cancel.mutationOptions({
      onSuccess: async () => {
        // Awaited so the dialog closes onto a queue that no longer lists this
        // appointment, rather than onto the row it just cancelled.
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId);
        toast.success("OPD appointment cancelled");
        onClose();
      },
      onError: (error) => {
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );
  const submit = form.handleSubmit(({ cancelReason }) => {
    cancel.mutate({ orgSlug, appointmentId, reason: cancelReason });
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel OPD appointment</DialogTitle>
          <DialogDescription>
            The reason is recorded on the appointment and its pending charges.
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
                Keep appointment
              </Button>
              <SubmitButton isSubmitting={cancel.isPending}>Cancel appointment</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const leftUnseenSchema = z.object({
  reason: z.string().trim().min(1, "Enter what happened").max(500),
});

export function MarkLeftUnseenOpdAppointmentDialog({
  orgSlug,
  appointmentId,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(leftUnseenSchema, { defaultValues: { reason: "" } });
  const markLeftUnseen = useMutation(
    orpc.opd.markLeftUnseen.mutationOptions({
      onSuccess: async () => {
        // Awaited so the dialog closes onto a queue that no longer lists this
        // appointment, rather than onto the row it just closed out.
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId);
        toast.success("Marked as left unseen");
        onClose();
      },
      onError: (error) => {
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId)) return;
        toast.error(error.message);
      },
    }),
  );
  const submit = form.handleSubmit(({ reason }) => {
    markLeftUnseen.mutate({ orgSlug, appointmentId, reason });
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark left unseen</DialogTitle>
          <DialogDescription>
            The patient left before the consult. The reason is recorded on the appointment and its
            pending charges are voided.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} autoFocus disabled={markLeftUnseen.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={markLeftUnseen.isPending}
                onClick={onClose}
              >
                Keep waiting
              </Button>
              <SubmitButton isSubmitting={markLeftUnseen.isPending}>Mark left unseen</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
