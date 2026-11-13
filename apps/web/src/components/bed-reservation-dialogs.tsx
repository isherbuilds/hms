import { localDateTime } from "@hms/api/lib/business-date";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { reasonSchema } from "@/components/ipd-dialogs";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { ErrorNote } from "@/components/page";
import { formatDateTime, localInputValue, nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

export type Reservation = Awaited<
  ReturnType<typeof orpc.ipd.listBedReservations.call>
>["items"][number];

const HOUR_MS = 60 * 60 * 1_000;

// Wall-clock inputs share one `YYYY-MM-DDTHH:mm` shape, so they compare as strings.
const windowFields = {
  plannedArrivalAt: z.string().min(1, "Choose the planned arrival"),
  plannedDepartureAt: z.string().min(1, "Choose the planned departure"),
  holdUntil: z.string(),
};

function requireOrderedWindow(
  value: { plannedArrivalAt: string; plannedDepartureAt: string; holdUntil: string },
  context: z.RefinementCtx,
) {
  if (value.plannedDepartureAt <= value.plannedArrivalAt) {
    context.addIssue({
      code: "custom",
      path: ["plannedDepartureAt"],
      message: "Departure must be after arrival",
    });
  }

  if (
    value.holdUntil &&
    (value.holdUntil <= value.plannedArrivalAt || value.holdUntil > value.plannedDepartureAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["holdUntil"],
      message: "Hold until a time after arrival and no later than departure",
    });
  }
}

function WindowFields({ holdDescription }: { holdDescription: string }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="plannedArrivalAt"
          label="Planned arrival"
          type="datetime-local"
          className="tabular-nums"
        />
        <TextField
          name="plannedDepartureAt"
          label="Planned departure"
          type="datetime-local"
          className="tabular-nums"
        />
      </div>
      <TextField
        name="holdUntil"
        label="Hold until"
        type="datetime-local"
        className="tabular-nums"
        description={holdDescription}
      />
    </>
  );
}

/** Capacity refusals (occupied, blocked, overlapping hold) stay in the dialog to be fixed
 * there; a reservation changed on another screen closes it, since its revision is stale. */
function useRefusal(onClose: () => void) {
  const [refusal, setRefusal] = useState<string | null>(null);

  const showsInline = (error: Error) =>
    hasErrorCode(error, "CONFLICT") && errorReason(error) !== "stale_record";

  const onError = (error: Error) => {
    if (showsInline(error)) setRefusal(errorMessage(error));
    else if (hasErrorCode(error, "CONFLICT")) onClose();
  };

  return { refusal, onError, showsInline };
}

function Refusal({ refusal }: { refusal: string | null }) {
  return refusal === null ? null : <ErrorNote title="The bed could not be held" detail={refusal} />;
}

/** Beds a hold can take now: active, empty, not blocked, of the requested type. */
function useHoldableBeds(orgSlug: string, categoryName: string) {
  const { timeZone } = useOrgDateTime();
  const board = useQuery(orpc.ipd.bedBoard.queryOptions({ input: { orgSlug } }));

  const beds = (board.data?.beds ?? [])
    .filter((bed) => bed.status === "available" && bed.categoryName === categoryName)
    .map((bed) => ({
      id: bed.id,
      // Another hold may overlap these dates; the server decides, but staff see it first.
      label:
        bed.holds.length > 0
          ? `${bed.wardName} ${bed.label} · held from ${formatDateTime(bed.holds[0]!.plannedArrivalAt, timeZone)}`
          : `${bed.wardName} ${bed.label}`,
    }));

  return { beds, isPending: board.isPending, isSuccess: board.isSuccess };
}

const requestSchema = z
  .object({
    patient: z
      .custom<SelectedPatient | null>()
      .refine((patient): patient is SelectedPatient => patient !== null, "Choose the Patient"),
    categoryId: z.string().min(1, "Choose the bed type"),
    bedId: z.string(),
    ...windowFields,
  })
  .superRefine(requireOrderedWindow);

function TypeAndBedFields({ orgSlug }: { orgSlug: string }) {
  const facility = useQuery(orpc.ipd.facility.queryOptions({ input: { orgSlug } }));
  const { setValue } = useFormContext<{ categoryId: string; bedId: string }>();
  const categoryId = useWatch<{ categoryId: string }, "categoryId">({ name: "categoryId" });
  const wardNames = new Map((facility.data?.wards ?? []).map((ward) => [ward.id, ward.name]));

  const beds = (facility.data?.beds ?? []).filter(
    (bed) => bed.active && bed.categoryId === categoryId,
  );

  return (
    <>
      <ControlledField
        name="categoryId"
        label="Bed type"
        render={(field) => (
          <FormControl>
            <NativeSelect
              {...field}
              disabled={facility.isPending}
              onChange={(event) => {
                field.onChange(event);
                setValue("bedId", "");
              }}
            >
              <option value="">Choose a bed type</option>
              {(facility.data?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <ControlledField
        name="bedId"
        label="Preferred bed (optional)"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={categoryId === ""}>
              <option value="">Any bed of this type</option>
              {beds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {wardNames.get(bed.wardId)} {bed.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
    </>
  );
}

export function RequestBedDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const { timeZone } = useOrgDateTime();

  return (
    <FormDialog
      title="Reserve a bed"
      description="This puts the Patient on the waiting list. No bed is promised until one is held for them."
      submitLabel="Add to waiting list"
      schema={requestSchema}
      defaultValues={{
        patient: null,
        categoryId: "",
        bedId: "",
        plannedArrivalAt: nextHalfHour(timeZone),
        plannedDepartureAt: "",
        holdUntil: "",
      }}
      success="Added to the waiting list"
      onClose={onClose}
      run={(value) =>
        orpc.ipd.requestBed.call({
          orgSlug,
          patientId: value.patient.id,
          categoryId: value.categoryId,
          bedId: value.bedId || undefined,
          plannedArrivalAt: localDateTime(value.plannedArrivalAt, timeZone),
          plannedDepartureAt: localDateTime(value.plannedDepartureAt, timeZone),
          holdUntil: value.holdUntil ? localDateTime(value.holdUntil, timeZone) : undefined,
        })
      }
    >
      <ControlledField
        name="patient"
        label="Patient"
        render={(field) => (
          <OpdPatientSearch orgSlug={orgSlug} selected={field.value} onChange={field.onChange} />
        )}
      />
      <TypeAndBedFields orgSlug={orgSlug} />
      <WindowFields holdDescription="Optional. If the Patient has not arrived by then, the request lapses." />
    </FormDialog>
  );
}

// A live hold time is kept; otherwise six hours after arrival, never past departure.
function suggestedHoldUntil(reservation: Reservation, now: number): Date {
  if (reservation.holdUntil && reservation.holdUntil.getTime() > now) return reservation.holdUntil;

  const from = Math.max(reservation.plannedArrivalAt.getTime(), now);

  return new Date(Math.min(from + 6 * HOUR_MS, reservation.plannedDepartureAt.getTime()));
}

const holdSchema = z.object({
  bedId: z.string().min(1, "Choose a bed"),
  holdUntil: z.string().min(1, "Choose how long to hold the bed"),
});

export function HoldBedDialog({
  orgSlug,
  reservation,
  onClose,
}: {
  orgSlug: string;
  reservation: Reservation;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const holdable = useHoldableBeds(orgSlug, reservation.categoryName);
  const refusal = useRefusal(onClose);

  const preferred = holdable.beds.some((bed) => bed.id === reservation.bedId)
    ? reservation.bedId!
    : "";

  return (
    <FormDialog
      // The form reads its defaults once: remount when the beds arrive to preselect the preferred one.
      key={holdable.isSuccess ? "beds" : "loading"}
      title="Hold a bed"
      description={
        <>
          For <span className="capitalize">{reservation.patientName}</span>, arriving{" "}
          {formatDateTime(reservation.plannedArrivalAt, timeZone)}. Only a free{" "}
          {reservation.categoryName} bed can be held.
        </>
      }
      submitLabel="Hold bed"
      schema={holdSchema}
      defaultValues={{
        bedId: preferred,
        holdUntil: localInputValue(suggestedHoldUntil(reservation, Date.now()), timeZone),
      }}
      success="Bed held"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={(value) =>
        orpc.ipd.confirmBedReservation.call({
          orgSlug,
          reservationId: reservation.id,
          expectedRevision: reservation.revision,
          bedId: value.bedId,
          holdUntil: localDateTime(value.holdUntil, timeZone),
        })
      }
    >
      <ControlledField
        name="bedId"
        label="Bed"
        description={
          holdable.isSuccess && holdable.beds.length === 0
            ? `No ${reservation.categoryName} bed is free right now.`
            : undefined
        }
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={holdable.isPending}>
              <option value="">Choose a free bed</option>
              {holdable.beds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <TextField
        name="holdUntil"
        label="Hold until"
        type="datetime-local"
        className="tabular-nums"
        description="If the Patient has not arrived by then, the bed is free again."
      />
      <Refusal refusal={refusal.refusal} />
    </FormDialog>
  );
}

// A held bed always needs a future hold time; a request's deadline is optional.
function rescheduleSchema(held: boolean, nowInput: string) {
  return z
    .object({
      ...windowFields,
      holdUntil: held
        ? z
            .string()
            .min(1, "Choose how long to hold the bed")
            .refine((value) => value > nowInput, "Hold until a future time")
        : z.string(),
      bedId: z.string(),
    })
    .superRefine(requireOrderedWindow);
}

export function ChangeDatesDialog({
  orgSlug,
  reservation,
  onClose,
}: {
  orgSlug: string;
  reservation: Reservation;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const holdable = useHoldableBeds(orgSlug, reservation.categoryName);
  const refusal = useRefusal(onClose);
  const held = reservation.status === "confirmed";
  const arrival = localInputValue(reservation.plannedArrivalAt, timeZone);
  const others = holdable.beds.filter((bed) => bed.id !== reservation.bedId);

  const now = Date.now();

  // A lapsed hold time is replaced with a suggestion, never carried into the new window.
  const holdUntil = held
    ? localInputValue(suggestedHoldUntil(reservation, now), timeZone)
    : reservation.holdUntil && reservation.holdUntil.getTime() > now
      ? localInputValue(reservation.holdUntil, timeZone)
      : "";

  return (
    <FormDialog
      title="Change dates"
      description={
        held
          ? "The bed stays held only if it is still free for the new dates."
          : "The request stays on the waiting list."
      }
      submitLabel="Save dates"
      schema={rescheduleSchema(held, localInputValue(new Date(now), timeZone))}
      defaultValues={{
        plannedArrivalAt: arrival,
        plannedDepartureAt: localInputValue(reservation.plannedDepartureAt, timeZone),
        holdUntil,
        bedId: "",
      }}
      success="Dates changed"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={(value) =>
        orpc.ipd.rescheduleBedReservation.call({
          orgSlug,
          reservationId: reservation.id,
          expectedRevision: reservation.revision,
          // An untouched arrival is sent exactly, so a late Patient's hold can be extended.
          plannedArrivalAt:
            value.plannedArrivalAt === arrival
              ? reservation.plannedArrivalAt
              : localDateTime(value.plannedArrivalAt, timeZone),
          plannedDepartureAt: localDateTime(value.plannedDepartureAt, timeZone),
          // A blank hold time clears a request's deadline; a held bed always has one.
          holdUntil: value.holdUntil ? localDateTime(value.holdUntil, timeZone) : null,
          bedId: value.bedId || undefined,
        })
      }
    >
      <WindowFields
        holdDescription={
          held
            ? "If the Patient has not arrived by then, the bed is free again."
            : "Optional. If the Patient has not arrived by then, the request lapses."
        }
      />
      <ControlledField
        name="bedId"
        label="Bed"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={holdable.isPending}>
              <option value="">
                {reservation.bedLabel
                  ? `Keep ${reservation.wardName} ${reservation.bedLabel}`
                  : "Any bed of this type"}
              </option>
              {others.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <Refusal refusal={refusal.refusal} />
    </FormDialog>
  );
}

export function CancelReservationDialog({
  orgSlug,
  reservation,
  onClose,
}: {
  orgSlug: string;
  reservation: Reservation;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Cancel reservation"
      description={
        reservation.bedLabel && reservation.status === "confirmed"
          ? `${reservation.wardName} ${reservation.bedLabel} is no longer held.`
          : "The Patient leaves the waiting list."
      }
      submitLabel="Cancel reservation"
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      success="Reservation cancelled"
      onClose={onClose}
      run={({ reason }) =>
        orpc.ipd.cancelBedReservation.call({
          orgSlug,
          reservationId: reservation.id,
          expectedRevision: reservation.revision,
          reason,
        })
      }
    >
      <TextField name="reason" label="Reason" autoFocus />
    </FormDialog>
  );
}
