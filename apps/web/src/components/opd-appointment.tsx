import { Badge } from "@hms/ui/components/badge";
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
  RegisteredFormField,
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
import { useOpdErrorToast } from "@/lib/opd-error";
import { hasErrorCode } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

// Staff copy, not the stored value.
const OPD_STATUS_LABELS = {
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

// On its own so a list row can take check-in without also observing no-show.
export function useOpdCheckIn(orgSlug: string) {
  const queryClient = useQueryClient();
  const onOpdError = useOpdErrorToast(orgSlug);

  return useMutation(
    orpc.opd.checkIn.mutationOptions({
      onSuccess: ({ appointment }) => {
        toast.success(`Checked in · Token ${appointment.tokenNumber}`);
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "checkIn");
      },
      onError: (error, variables) => onOpdError(variables.appointmentId, "checkIn", error),
    }),
  );
}

export function useOpdStatusActions(orgSlug: string) {
  const queryClient = useQueryClient();
  const onOpdError = useOpdErrorToast(orgSlug);

  const checkIn = useOpdCheckIn(orgSlug);
  const markNoShow = useMutation(
    orpc.opd.markNoShow.mutationOptions({
      onSuccess: (appointment) => {
        toast.success("Marked as no show");
        return invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "noShow");
      },
      onError: (error, variables) => onOpdError(variables.appointmentId, "noShow", error),
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
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const onOpdError = useOpdErrorToast(orgSlug);
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });
  const cancel = useMutation(
    orpc.opd.cancel.mutationOptions({
      onSuccess: async () => {
        // Awaited so the dialog closes onto a day that no longer lists this appointment.
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, "cancel");
        toast.success("OPD appointment cancelled");
        onClose();
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) onClose();
        return onOpdError(appointmentId, "cancel", error);
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
            <RegisteredFormField
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
              <SubmitButton isSubmitting={cancel.isPending}>Cancel appointment</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
