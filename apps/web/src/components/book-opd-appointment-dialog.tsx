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
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  OpdCareTeamFields,
  OpdPatientPicker,
  type SelectedPatient,
  usePatientMatches,
} from "@/components/new-opd-walk-in-dialog";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toastOpdConflict } from "@/lib/opd-operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

const bookingSchema = z.object({
  callerName: z.string().trim().min(1, "Enter the caller's name").max(200),
  callerPhone: z.string().trim().min(4, "Enter at least 4 characters").max(20),
  departmentId: z.string().min(1, "Choose a department"),
  practitionerId: z.string().min(1, "Choose a practitioner"),
  kind: z.enum(["consultation", "procedure"]),
  scheduledFor: z.string().min(1, "Choose a date and time"),
});

/** An instant as the org-local `datetime-local` input value. */
function localInputValue(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function nextHalfHour(timeZone: string): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);
  return localInputValue(date, timeZone);
}

export function BookOpdAppointmentDialog({
  orgSlug,
  onClose,
}: {
  orgSlug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { timeZone } = useOrgDateTime();
  const form = useZodForm(bookingSchema, {
    defaultValues: {
      callerName: "",
      callerPhone: "",
      departmentId: "",
      practitionerId: "",
      kind: "consultation",
      scheduledFor: nextHalfHour(timeZone),
    },
  });
  // The caller stays a caller — a parent books for a child — so linking a
  // patient never overwrites the caller fields; it only pre-answers "who is
  // this for" so check-in can skip the search.
  const [linked, setLinked] = useState<SelectedPatient>();
  const callerName = form.watch("callerName");
  const callerPhone = form.watch("callerPhone");
  const { matches } = usePatientMatches(
    orgSlug,
    linked ? "" : callerPhone.trim().length >= 4 ? callerPhone : callerName,
  );
  const book = useMutation(
    orpc.opd.book.mutationOptions({
      onSuccess: async (appointment) => {
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
        toast.success("Appointment booked");
        onClose();
        await navigate({
          to: "/$orgSlug/opd/$appointmentId",
          params: { orgSlug, appointmentId: appointment.id },
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit((values) =>
    book.mutate({
      orgSlug,
      ...values,
      patientId: linked?.id ?? null,
      scheduledLocal: values.scheduledFor,
    }),
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Book OPD appointment</DialogTitle>
          <DialogDescription>
            A patient record is not required until check-in. Times are shown in {timeZone}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="callerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Caller name</FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus disabled={book.isPending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="callerPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="tel" disabled={book.isPending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {linked ? (
              <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
                <div>
                  <p className="font-medium">{linked.name}</p>
                  <p className="text-muted-foreground">{linked.mrn} · linked patient</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setLinked(undefined)}>
                  Unlink
                </Button>
              </div>
            ) : matches.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-muted-foreground">
                  Existing patients — link one to skip the search at check-in
                </p>
                <ul className="flex max-h-40 flex-col overflow-y-auto ring-1 ring-border">
                  {matches.slice(0, 5).map((match) => (
                    <li key={match.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setLinked({ id: match.id, name: match.name, mrn: match.mrn })
                        }
                        className="flex w-full items-baseline gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
                      >
                        <span className="font-medium">{match.name}</span>
                        <span className="text-muted-foreground">
                          {match.mrn} · {match.phone}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <FormField
              control={form.control}
              name="scheduledFor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date and time</FormLabel>
                  <FormControl>
                    <Input {...field} type="datetime-local" disabled={book.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <OpdCareTeamFields orgSlug={orgSlug} disabled={book.isPending} />
            </div>
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kind</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={book.isPending}>
                      <option value="consultation">Consultation</option>
                      <option value="procedure">Procedure</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={book.isPending} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={book.isPending}>Book appointment</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

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
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
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
          <OpdPatientPicker
            orgSlug={orgSlug}
            initialQuery={callerPhone ?? undefined}
            onSelect={setSelected}
            onClose={onClose}
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
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId);
        toast.success("Appointment rescheduled");
        onClose();
      },
      onError: (error) => {
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId)) return;
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
