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
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toastOpdConflict } from "@/lib/opd-operational-query";
import { orpc } from "@/lib/orpc";

/**
 * Shared OPD status vocabulary for the day view, its panel, and the record
 * page. Staff copy, not the stored value.
 */
export const OPD_STATUS_LABELS = {
  booked: "Booked",
  checked_in: "Checked In",
  cancelled: "Cancelled",
  no_show: "No show",
} as const;

export type OpdAppointmentStatus = keyof typeof OPD_STATUS_LABELS;

export function OpdAppointmentStatusBadge({ status }: { status: OpdAppointmentStatus }) {
  const variant =
    status === "checked_in" ? "secondary" : status === "cancelled" ? "destructive" : "muted";
  return <Badge variant={variant}>{OPD_STATUS_LABELS[status]}</Badge>;
}

/**
 * The two routine status transitions shared by the day and detail screens.
 */
export function useOpdStatusActions(orgSlug: string) {
  const queryClient = useQueryClient();

  const checkIn = useMutation(
    orpc.opd.checkIn.mutationOptions({
      onSuccess: ({ appointment }) => {
        toast.success(`Checked in · Token ${appointment.tokenNumber}`);
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "checkIn");
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId, "checkIn"))
          return;
        toast.error(error.message);
      },
    }),
  );
  const markNoShow = useMutation(
    orpc.opd.markNoShow.mutationOptions({
      onSuccess: (appointment) => {
        toast.success("Marked as no show");
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "noShow");
      },
      onError: (error, variables) => {
        if (toastOpdConflict(queryClient, error, orgSlug, variables.appointmentId, "noShow"))
          return;
        toast.error(error.message);
      },
    }),
  );

  return { checkIn, markNoShow };
}

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(1, "Enter a cancellation reason").max(500),
});

export function CancelOpdAppointmentDialog({
  orgSlug,
  appointmentId,
  onCancelled,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  /** Runs only when the appointment was really cancelled, before `onClose`. */
  onCancelled?: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });
  const cancel = useMutation(
    orpc.opd.cancel.mutationOptions({
      onSuccess: async () => {
        // Awaited so the dialog closes onto a day that no longer lists this
        // appointment, rather than onto the row it just cancelled.
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, "cancel");
        toast.success("OPD appointment cancelled");
        onCancelled?.();
        onClose();
      },
      onError: (error) => {
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId, "cancel")) return;
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
            Any issued invoice and payments remain unchanged. An administrator issues credit notes
            or refunds from Billing.{" "}
            <Link
              className="font-medium text-foreground underline underline-offset-4"
              to="/$orgSlug/opd/$appointmentId/billing"
              params={{ orgSlug, appointmentId }}
            >
              Open billing
            </Link>
            .
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
