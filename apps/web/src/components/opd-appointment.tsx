import type { AppRouter } from "@hms/api/routers/index";
import { Badge } from "@hms/ui/components/badge";
import type { RouterClient } from "@orpc/server";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import type { Column } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

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

type OpdDayRow = Awaited<ReturnType<RouterClient<AppRouter>["opd"]["day"]>>["items"][number];

/**
 * The queue's shared columns around one screen-specific column. The name columns take
 * fixed shares of the width, so a wide screen shows names in full; identifiers never
 * truncate (docs/design.md §8).
 */
export function opdQueueColumns(
  middle: Column<OpdDayRow>,
): [Column<OpdDayRow>, ...Column<OpdDayRow>[]] {
  return [
    {
      head: "Patient",
      cell: (appointment) => {
        const name = appointment.patientName ?? appointment.callerName ?? "Unnamed caller";

        return (
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="truncate capitalize" title={name}>
              {name}
            </span>
            <span className="shrink-0 font-mono font-normal text-muted-foreground">
              {appointment.patientMrn ?? appointment.callerPhone ?? "No phone"}
            </span>
          </span>
        );
      },
      className: "w-1/3 max-w-0 xl:w-1/4",
    },
    {
      head: "Token",
      cell: (appointment) =>
        appointment.tokenNumber === null ? (
          <span className="text-muted-foreground">·</span>
        ) : (
          <span className="font-mono font-medium tabular-nums">{appointment.tokenNumber}</span>
        ),
      className: "w-16",
      mobile: "title",
    },
    middle,
    {
      head: "Practitioner",
      cell: (appointment) => (
        <span className="capitalize" title={practitionerDisplayName(appointment.practitionerName)}>
          {practitionerDisplayName(appointment.practitionerName)}
        </span>
      ),
      // The cell truncates, not an inner block, so the compact row keeps it on one line.
      className: "w-1/5 max-w-0 truncate xl:w-1/6",
    },
    {
      head: "Status",
      cell: (appointment) => <OpdAppointmentStatusBadge status={appointment.status} />,
      mobile: "title",
    },
  ];
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
  return (
    <FormDialog
      title="Cancel OPD appointment"
      description={
        <>
          Any issued invoice and payments remain unchanged. An administrator issues credit notes or
          refunds from Billing.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            to="/$orgSlug/opd/$appointmentId/billing"
            params={{ orgSlug, appointmentId }}
          >
            Open billing
          </Link>
          .
        </>
      }
      submitLabel="Cancel appointment"
      schema={cancelSchema}
      defaultValues={{ cancelReason: "" }}
      success="OPD appointment cancelled"
      onClose={onClose}
      run={({ cancelReason }) =>
        orpc.opd.cancel.call({ orgSlug, appointmentId, reason: cancelReason })
      }
    >
      <TextField name="cancelReason" label="Reason" multiline rows={3} autoFocus />
    </FormDialog>
  );
}
