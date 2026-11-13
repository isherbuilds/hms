import { localDateTime } from "@hms/api/lib/business-date";
import { practitionerDisplayName } from "@hms/api/lib/labels";
import type { ResourceTarget } from "@hms/api/lib/theatre-holds";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import { FormControl, FormField, FormItem, FormLabel } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { nameSchema, reasonSchema } from "@/components/ipd-dialogs";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { OptionCombobox } from "@/components/option-combobox";
import { ErrorNote, LoadMore } from "@/components/page";
import { useCan } from "@/lib/membership";
import { formatDateTime, localInputValue, nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode } from "@/lib/orpc-error";

export type TheatreCase = Awaited<ReturnType<typeof orpc.theatre.schedule.call>>["cases"][number];

export type TheatreResources = Awaited<ReturnType<typeof orpc.theatre.resources.call>>;

type RoomKind = TheatreResources["rooms"][number]["kind"];

export type BlockTarget = ResourceTarget & { name: string };

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  operating_theatre: "Operating theatre",
  procedure_room: "Procedure room",
};

const MINUTE_MS = 60_000;

/** Refusals (a clash, a stale case, a past start) stay in the dialog, which keeps its inputs. */
function useRefusal() {
  const [refusal, setRefusal] = useState<string | null>(null);

  const showsInline = (error: Error) =>
    hasErrorCode(error, "CONFLICT") || hasErrorCode(error, "BAD_REQUEST");

  const onError = (error: Error) => {
    if (showsInline(error)) setRefusal(errorMessage(error));
  };

  return { refusal, onError, showsInline };
}

function Refusal({ title, refusal }: { title: string; refusal: string | null }) {
  return refusal === null ? null : <ErrorNote title={title} detail={refusal} />;
}

function minutes(label: string, max: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, `Enter ${label} in whole minutes`)
    .refine((value) => Number(value) <= max, `Keep ${label} to ${max} minutes or less`);
}

const caseFields = {
  practitionerId: z.string().min(1, "Choose the consultant"),
  procedureItemId: z.string().min(1, "Choose the procedure"),
  date: z.string().min(1, "Choose the day"),
  startTime: z.string().min(1, "Choose the start time"),
  duration: minutes("the duration", 24 * 60).refine((value) => Number(value) > 0, {
    message: "Enter how long the case takes",
  }),
  prepMinutes: minutes("preparation", 240),
  cleanupMinutes: minutes("clean-up", 240),
  roomId: z.string(),
  equipmentIds: z.array(z.string()),
  notes: z.string().trim().max(500, "Keep notes under 500 characters"),
};

const bookSchema = z.object({
  patient: z
    .custom<SelectedPatient | null>()
    .refine((patient): patient is SelectedPatient => patient !== null, "Choose the Patient"),
  ...caseFields,
});

const changeSchema = z.object(caseFields);

type CaseValues = z.output<typeof changeSchema>;

function casePayload(value: CaseValues, timeZone: string) {
  const plannedStartAt = localDateTime(`${value.date}T${value.startTime}`, timeZone);

  return {
    practitionerId: value.practitionerId,
    procedureItemId: value.procedureItemId,
    plannedStartAt,
    plannedEndAt: new Date(plannedStartAt.getTime() + Number(value.duration) * MINUTE_MS),
    prepMinutes: Number(value.prepMinutes),
    cleanupMinutes: Number(value.cleanupMinutes),
    roomId: value.roomId || undefined,
    equipmentIds: value.equipmentIds,
    notes: value.notes || undefined,
  };
}

export const resourcesQuery = (orgSlug: string) =>
  orpc.theatre.resources.queryOptions({ input: { orgSlug } });

const proceduresQuery = (orgSlug: string) =>
  orpc.catalog.list.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      category: "procedure" as const,
      activeOnly: true,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** Everything but the Patient: what a desk sets when booking and when changing a case. */
function CaseFields({
  orgSlug,
  current,
}: {
  orgSlug: string;
  /** The case being changed: its own room, units and procedure stay choosable. */
  current?: TheatreCase;
}) {
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const resources = useQuery(resourcesQuery(orgSlug));
  const procedures = useInfiniteQuery(proceduresQuery(orgSlug));
  const loaded = procedures.data?.pages.flatMap((page) => page.items) ?? [];

  const procedureOptions = loaded.map((item) => ({ value: item.id, label: item.name }));

  if (current && !loaded.some((item) => item.id === current.procedureItemId)) {
    procedureOptions.unshift({ value: current.procedureItemId, label: current.procedureName });
  }

  const rooms = (resources.data?.rooms ?? []).filter(
    (room) => room.active || room.id === current?.roomId,
  );

  const units = (resources.data?.equipment ?? []).filter(
    (unit) => unit.active || current?.equipment.some((used) => used.id === unit.id),
  );

  return (
    <>
      <ControlledField
        name="procedureItemId"
        label="Procedure"
        render={(field) => (
          <FormControl>
            <OptionCombobox
              options={procedureOptions}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              disabled={procedures.isPending}
              placeholder="Search procedures"
            />
          </FormControl>
        )}
      />
      <LoadMore query={procedures} shown={loaded.length} />
      <ControlledField
        name="practitionerId"
        label="Consultant"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={practitioners.isPending}>
              <option value="">Choose a consultant</option>
              {(practitioners.data ?? []).map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner.name)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField name="date" label="Day" type="date" className="tabular-nums" />
        <TextField name="startTime" label="Starts" type="time" className="tabular-nums" />
        <TextField name="duration" label="Minutes" inputMode="numeric" className="tabular-nums" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="prepMinutes"
          label="Prep before (minutes)"
          inputMode="numeric"
          className="tabular-nums"
        />
        <TextField
          name="cleanupMinutes"
          label="Clean-up after (minutes)"
          inputMode="numeric"
          className="tabular-nums"
        />
      </div>
      <ControlledField
        name="roomId"
        label="Room (optional)"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={resources.isPending}>
              <option value="">No room yet</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      {units.length > 0 ? (
        <FormField
          name="equipmentIds"
          render={({ field }) => {
            const chosen: string[] = field.value;

            return (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2">Equipment (optional)</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {units.map((unit) => (
                    <label key={unit.id} className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={chosen.includes(unit.id)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked ? [...chosen, unit.id] : chosen.filter((id) => id !== unit.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {unit.name} <span className="text-muted-foreground">{unit.kind}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }}
        />
      ) : null}
      <TextField name="notes" label="Notes (optional)" multiline rows={2} />
    </>
  );
}

export function BookCaseDialog({
  orgSlug,
  day,
  onClose,
}: {
  orgSlug: string;
  /** The schedule's day, `YYYY-MM-DD`. */
  day: string;
  onClose: () => void;
}) {
  const { timeZone, today } = useOrgDateTime();
  const refusal = useRefusal();
  const soon = nextHalfHour(timeZone);

  return (
    <FormDialog
      title="Book a case"
      description="This saves a draft. A draft does not hold the room, equipment or consultant until it is confirmed."
      submitLabel="Save draft"
      schema={bookSchema}
      defaultValues={{
        patient: null,
        practitionerId: "",
        procedureItemId: "",
        date: day === today ? soon.slice(0, 10) : day,
        startTime: day === today ? soon.slice(11) : "09:00",
        duration: "60",
        prepMinutes: "0",
        cleanupMinutes: "0",
        roomId: "",
        equipmentIds: [],
        notes: "",
      }}
      success="Case saved as a draft"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={(value) =>
        orpc.theatre.draftCase.call({
          orgSlug,
          patientId: value.patient.id,
          ...casePayload(value, timeZone),
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
      <CaseFields orgSlug={orgSlug} />
      <Refusal title="The case could not be saved" refusal={refusal.refusal} />
    </FormDialog>
  );
}

export function ChangeCaseDialog({
  orgSlug,
  theatreCase,
  onClose,
}: {
  orgSlug: string;
  /** Captured when the dialog opened; its revision proves the edit is current. */
  theatreCase: TheatreCase;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const refusal = useRefusal();
  const start = localInputValue(theatreCase.plannedStartAt, timeZone);
  const confirmed = theatreCase.status === "confirmed";

  return (
    <FormDialog
      title="Change case"
      description={
        confirmed
          ? "The booking only moves if the room, equipment and consultant are all free at the new time. Otherwise it stays as it is."
          : "The case stays unconfirmed until you confirm it."
      }
      submitLabel="Save changes"
      schema={changeSchema}
      defaultValues={{
        practitionerId: theatreCase.practitionerId,
        procedureItemId: theatreCase.procedureItemId,
        date: start.slice(0, 10),
        startTime: start.slice(11),
        duration: String(
          (theatreCase.plannedEndAt.getTime() - theatreCase.plannedStartAt.getTime()) / MINUTE_MS,
        ),
        prepMinutes: String(theatreCase.prepMinutes),
        cleanupMinutes: String(theatreCase.cleanupMinutes),
        roomId: theatreCase.roomId ?? "",
        equipmentIds: theatreCase.equipment.map((unit) => unit.id),
        notes: theatreCase.notes ?? "",
      }}
      success="Case changed"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={(value) =>
        orpc.theatre.updateCase.call({
          orgSlug,
          caseId: theatreCase.id,
          expectedRevision: theatreCase.revision,
          bedReservationId: theatreCase.bedReservationId ?? undefined,
          ...casePayload(value, timeZone),
        })
      }
    >
      <CaseFields orgSlug={orgSlug} current={theatreCase} />
      <Refusal
        title={confirmed ? "The booking did not move" : "The case could not be changed"}
        refusal={refusal.refusal}
      />
    </FormDialog>
  );
}

export function ConfirmCaseDialog({
  orgSlug,
  theatreCase,
  onClose,
}: {
  orgSlug: string;
  theatreCase: TheatreCase;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const refusal = useRefusal();
  // Offered only once the case has a room.
  const held = [theatreCase.roomName, ...theatreCase.equipment.map((unit) => unit.name)].join(", ");

  return (
    <FormDialog
      title="Confirm case"
      description={`Holds ${held} from ${formatDateTime(theatreCase.bufferedStartAt, timeZone)} to ${formatDateTime(theatreCase.bufferedEndAt, timeZone)}, and the consultant for the case itself, if all are free.`}
      submitLabel="Confirm case"
      schema={z.object({})}
      defaultValues={{}}
      success="Case confirmed"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={() =>
        orpc.theatre.confirmCase.call({
          orgSlug,
          caseId: theatreCase.id,
          expectedRevision: theatreCase.revision,
        })
      }
    >
      <Refusal title="The case was not confirmed" refusal={refusal.refusal} />
    </FormDialog>
  );
}

const linkSchema = z.object({ admissionId: z.string().min(1, "Choose the Admission") });

const currentAdmissionsQuery = (orgSlug: string) =>
  orpc.ipd.list.infiniteOptions({
    input: (cursor: { admittedAt: Date; id: string } | undefined) => ({
      orgSlug,
      state: "current" as const,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export function LinkAdmissionDialog({
  orgSlug,
  theatreCase,
  onClose,
}: {
  orgSlug: string;
  theatreCase: TheatreCase;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const refusal = useRefusal();
  const admissions = useInfiniteQuery(currentAdmissionsQuery(orgSlug));

  const own = (admissions.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (admission) => admission.patientId === theatreCase.patientId,
  );

  const searching = admissions.isPending || (own.length === 0 && admissions.hasNextPage);

  return (
    <FormDialog
      title="Link admission"
      description={
        <>
          The stay <span className="capitalize">{theatreCase.patientName}</span> (
          <span className="font-mono">{theatreCase.mrn}</span>) is in for this case.
        </>
      }
      submitLabel="Link admission"
      schema={linkSchema}
      // Mounted per open, after the list loads, so the only stay is chosen for the desk.
      key={own[0]?.id ?? "none"}
      defaultValues={{ admissionId: own.length === 1 ? own[0]!.id : "" }}
      success="Admission linked"
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={({ admissionId }) =>
        orpc.theatre.attachCaseAdmission.call({
          orgSlug,
          caseId: theatreCase.id,
          expectedRevision: theatreCase.revision,
          admissionId,
        })
      }
    >
      <ControlledField
        name="admissionId"
        label="Admission"
        description={
          !searching && own.length === 0
            ? "The Patient is not admitted yet. Admit them from IPD, then link the stay here."
            : undefined
        }
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={own.length === 0}>
              <option value="">{searching ? "Looking for the stay…" : "No current stay"}</option>
              {own.map((admission) => (
                <option key={admission.id} value={admission.id}>
                  {admission.wardName && admission.bedLabel
                    ? `${admission.wardName} ${admission.bedLabel}, `
                    : ""}
                  admitted {formatDateTime(admission.admittedAt, timeZone)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      {own.length === 0 && admissions.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-start"
          disabled={admissions.isFetchingNextPage}
          onClick={() => void admissions.fetchNextPage()}
        >
          Look through more admissions
        </Button>
      ) : null}
      <Refusal title="The admission was not linked" refusal={refusal.refusal} />
    </FormDialog>
  );
}

export function CancelCaseDialog({
  orgSlug,
  theatreCase,
  onClose,
}: {
  orgSlug: string;
  theatreCase: TheatreCase;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Cancel case"
      description={
        theatreCase.status === "confirmed"
          ? "The room, equipment and consultant are free again at that time."
          : "The case leaves the schedule."
      }
      submitLabel="Cancel case"
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      success="Case cancelled"
      onClose={onClose}
      run={({ reason }) =>
        orpc.theatre.cancelCase.call({
          orgSlug,
          caseId: theatreCase.id,
          expectedRevision: theatreCase.revision,
          reason,
        })
      }
    >
      <TextField name="reason" label="Reason" autoFocus />
    </FormDialog>
  );
}

const roomSchema = nameSchema.extend({
  kind: z.enum(["operating_theatre", "procedure_room"] satisfies RoomKind[]),
});

export function RoomDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  return (
    <FormDialog
      title="Add room"
      description="Cases are booked into a room."
      submitLabel="Add room"
      schema={roomSchema}
      defaultValues={{ name: "", kind: "operating_theatre" }}
      success="Room added"
      onClose={onClose}
      run={(value) => orpc.theatre.createRoom.call({ orgSlug, ...value })}
    >
      <TextField name="name" label="Name" autoFocus />
      <ControlledField
        name="kind"
        label="Kind"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              {Object.entries(ROOM_KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
    </FormDialog>
  );
}

const equipmentSchema = nameSchema.extend({
  kind: z.string().trim().min(1, "Say what kind of unit it is").max(200),
});

export function EquipmentDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  return (
    <FormDialog
      title="Add equipment"
      description="Each unit is booked on its own, so name the one on the floor."
      submitLabel="Add equipment"
      schema={equipmentSchema}
      defaultValues={{ name: "", kind: "" }}
      success="Equipment added"
      onClose={onClose}
      run={(value) => orpc.theatre.createEquipment.call({ orgSlug, ...value })}
    >
      <TextField name="name" label="Name" autoFocus description="For example C-arm 2" />
      <TextField name="kind" label="Kind" description="For example C-arm" />
    </FormDialog>
  );
}

const blockSchema = z
  .object({
    startsAt: z.string().min(1, "Choose when the block starts"),
    endsAt: z.string().min(1, "Choose when the block ends"),
    reason: z.string().trim().min(1, "Give a reason").max(500, "Keep it under 500 characters"),
    disrupt: z.boolean(),
    disruptReason: z.string().trim().max(500, "Keep it under 500 characters"),
  })
  .superRefine((value, context) => {
    // Wall-clock inputs share one shape, so they compare as strings.
    if (value.endsAt <= value.startsAt) {
      context.addIssue({ code: "custom", path: ["endsAt"], message: "End after it starts" });
    }

    if (value.disrupt && !value.disruptReason) {
      context.addIssue({
        code: "custom",
        path: ["disruptReason"],
        message: "Give a reason to move the cases",
      });
    }
  });

function DisruptOption({ orgSlug, refusal }: { orgSlug: string; refusal: string | null }) {
  const canOverride = useCan(orgSlug, { theatre: ["override"] });
  const disrupt = useWatch<{ disrupt: boolean }, "disrupt">({ name: "disrupt" });

  if (refusal === null) return null;

  return (
    <>
      <ErrorNote
        title={refusal}
        detail={canOverride ? undefined : "Choose another time, or ask an administrator."}
      />
      {canOverride ? (
        <>
          <FormField
            name="disrupt"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel>Block anyway and mark the cases for rescheduling</FormLabel>
              </FormItem>
            )}
          />
          {disrupt ? (
            <TextField
              name="disruptReason"
              label="Reason to move the cases"
              autoFocus
              description="The Patients' cases show as needing rescheduling, with this reason."
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function BlockDialog({
  orgSlug,
  target,
  onClose,
}: {
  orgSlug: string;
  target: BlockTarget;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const refusal = useRefusal();
  const start = nextHalfHour(timeZone);

  return (
    <FormDialog
      title={`Block ${target.name}`}
      description="Nothing can be confirmed on it while it is blocked."
      submitLabel="Block"
      schema={blockSchema}
      defaultValues={{
        startsAt: start,
        endsAt: localInputValue(
          new Date(localDateTime(start, timeZone).getTime() + 60 * MINUTE_MS),
          timeZone,
        ),
        reason: "",
        disrupt: false,
        disruptReason: "",
      }}
      success={`${target.name} blocked`}
      onClose={onClose}
      onError={refusal.onError}
      showsInline={refusal.showsInline}
      run={(value) =>
        orpc.theatre.blockResource.call({
          orgSlug,
          ...("roomId" in target ? { roomId: target.roomId } : { equipmentId: target.equipmentId }),
          startsAt: localDateTime(value.startsAt, timeZone),
          endsAt: localDateTime(value.endsAt, timeZone),
          reason: value.reason,
          disrupt: value.disrupt ? { reason: value.disruptReason } : undefined,
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="startsAt" label="From" type="datetime-local" className="tabular-nums" />
        <TextField name="endsAt" label="Until" type="datetime-local" className="tabular-nums" />
      </div>
      <TextField name="reason" label="Reason" description="For example Servicing" />
      <DisruptOption orgSlug={orgSlug} refusal={refusal.refusal} />
    </FormDialog>
  );
}
