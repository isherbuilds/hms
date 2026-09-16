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
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { closeOnConflict } from "@/lib/orpc-error";

// Staff copy, not the stored value.
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

// On its own so a list row can take check-in without also observing no-show.
export function useOpdCheckIn() {
  return useMutation(
    orpc.opd.checkIn.mutationOptions({
      onSuccess: ({ appointment }) => {
        toast.success(`Checked in · Token ${appointment.tokenNumber}`);
      },
    }),
  );
}

export function useOpdStatusActions() {
  const checkIn = useOpdCheckIn();

  const markNoShow = useMutation(
    orpc.opd.markNoShow.mutationOptions({
      onSuccess: () => {
        toast.success("Marked as no show");
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
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  onClose: () => void;
}) {
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });

  const cancel = useMutation(
    orpc.opd.cancel.mutationOptions({
      onSuccess: () => {
        onClose();
        toast.success("OPD appointment cancelled");
      },
      onError: closeOnConflict(onClose),
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
