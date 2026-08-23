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
import { Input } from "@hms/ui/components/input";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toastOpdConflict } from "@/lib/opd-operational-query";
import { localInputValue, nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

export function CheckInOpdAppointmentDialog({
  orgSlug,
  appointmentId,
  callerName,
  callerPhone,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  /** Who the booking was taken for, echoed so the desk matches the right person. */
  callerName?: string | null;
  callerPhone?: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<SelectedPatient>();
  const checkIn = useMutation(
    orpc.opd.checkIn.mutationOptions({
      onSuccess: async ({ appointment }) => {
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "checkIn");
        toast.success(`Checked in · Token ${appointment.tokenNumber}`);
        onClose();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const caller = [callerName, callerPhone].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Check in appointment</DialogTitle>
          <DialogDescription>
            {caller ? `Booked for ${caller}. ` : ""}
            Find or register the patient, then create today's token.
          </DialogDescription>
        </DialogHeader>
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="bg-muted/40 px-3 py-2">
              <p className="font-medium">{selected.name}</p>
              <p className="text-muted-foreground">{selected.mrn}</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSelected(undefined)}>
                Change patient
              </Button>
              <Button
                disabled={checkIn.isPending}
                onClick={() => checkIn.mutate({ orgSlug, appointmentId, patientId: selected.id })}
              >
                Check in
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <OpdPatientSearch
              orgSlug={orgSlug}
              initialQuery={callerPhone ?? undefined}
              onSelect={setSelected}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const rescheduleSchema = z.object({
  scheduledFor: z.string().min(1, "Choose a date and time"),
});

export function RescheduleOpdAppointmentDialog({
  orgSlug,
  appointmentId,
  scheduledFor,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  /** The current slot, so the dialog opens on what is being moved. */
  scheduledFor?: Date | string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const form = useZodForm(rescheduleSchema, {
    defaultValues: {
      scheduledFor: scheduledFor
        ? localInputValue(new Date(scheduledFor), timeZone)
        : nextHalfHour(timeZone),
    },
  });
  const reschedule = useMutation(
    orpc.opd.reschedule.mutationOptions({
      onSuccess: async () => {
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, "reschedule");
        toast.success("Appointment rescheduled");
        onClose();
      },
      onError: (error) => {
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId, "reschedule")) return;
        toast.error(error.message);
      },
    }),
  );
  const submit = form.handleSubmit((values) =>
    reschedule.mutate({ orgSlug, appointmentId, scheduledLocal: values.scheduledFor }),
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>Times are shown in {timeZone}.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="scheduledFor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date and time</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="datetime-local"
                      autoFocus
                      disabled={reschedule.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={reschedule.isPending}
                onClick={onClose}
              >
                Keep current time
              </Button>
              <SubmitButton isSubmitting={reschedule.isPending}>Reschedule</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
