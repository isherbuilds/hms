import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { useState } from "react";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { useOpdCheckIn } from "@/components/opd-appointment";
import { localInputValue, nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { closeOnConflict } from "@/lib/orpc-error";

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
  const checkIn = useOpdCheckIn();
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
            Find or register the patient to check them in.
          </DialogDescription>
        </DialogHeader>
        <OpdPatientSearch
          orgSlug={orgSlug}
          initialQuery={callerPhone ?? undefined}
          selected={selected}
          onChange={(patient) => setSelected(patient ?? undefined)}
        />
        <DialogFooter>
          <Button
            disabled={!selected || checkIn.isPending}
            onClick={() => {
              if (!selected) return;
              void checkIn
                .mutateAsync({ orgSlug, appointmentId, patientId: selected.id })
                .then(onClose)
                .catch(closeOnConflict(onClose));
            }}
          >
            Check in
          </Button>
        </DialogFooter>
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
  const { timeZone } = useOrgDateTime();

  return (
    <FormDialog
      title="Reschedule appointment"
      description={`Times are shown in ${timeZone}.`}
      submitLabel="Reschedule"
      schema={rescheduleSchema}
      defaultValues={{
        scheduledFor: scheduledFor
          ? localInputValue(new Date(scheduledFor), timeZone)
          : nextHalfHour(timeZone),
      }}
      success="Appointment rescheduled"
      onClose={onClose}
      run={({ scheduledFor }) =>
        orpc.opd.reschedule.call({ orgSlug, appointmentId, scheduledLocal: scheduledFor })
      }
    >
      <TextField
        name="scheduledFor"
        label="Date and time"
        type="datetime-local"
        className="tabular-nums"
        autoFocus
      />
    </FormDialog>
  );
}
