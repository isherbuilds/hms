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
  RegisteredFormField,
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
import { useOpdCheckIn } from "@/components/opd-appointment";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { useOpdErrorToast } from "@/lib/opd-error";
import { localInputValue, nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { hasErrorCode } from "@/lib/orpc-error";
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
  callerName?: string | null;
  callerPhone?: string | null;
  onClose: () => void;
}) {
  const checkIn = useOpdCheckIn(orgSlug);
  const [selected, setSelected] = useState<SelectedPatient>();
  const caller = [callerName, callerPhone].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Check in appointment</DialogTitle>
          <DialogDescription>
            {caller ? (
              <>
                Booked for <span className="capitalize">{caller}</span>.{" "}
              </>
            ) : null}
            Find or register the patient, then create today's token.
          </DialogDescription>
        </DialogHeader>
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="bg-muted/40 px-3 py-2">
              <p className="font-medium capitalize">{selected.name}</p>
              <p className="text-muted-foreground">{selected.mrn}</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSelected(undefined)}>
                Change patient
              </Button>
              <Button
                disabled={checkIn.isPending}
                onClick={() => {
                  void checkIn
                    .mutateAsync({
                      orgSlug,
                      appointmentId,
                      patientId: selected.id,
                    })
                    .then(onClose)
                    .catch((error) => {
                      if (hasErrorCode(error, "CONFLICT")) onClose();
                    });
                }}
              >
                Check in
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <OpdPatientSearch
            orgSlug={orgSlug}
            initialQuery={callerPhone ?? undefined}
            onSelect={setSelected}
          />
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
  scheduledFor?: Date | string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const onOpdError = useOpdErrorToast(orgSlug);
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
        if (hasErrorCode(error, "CONFLICT")) onClose();
        return onOpdError(appointmentId, "reschedule", error);
      },
    }),
  );
  const submit = form.handleSubmit((values) =>
    reschedule.mutate({
      orgSlug,
      appointmentId,
      scheduledLocal: values.scheduledFor,
    }),
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
            <RegisteredFormField
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
              <SubmitButton isSubmitting={reschedule.isPending}>Reschedule</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
